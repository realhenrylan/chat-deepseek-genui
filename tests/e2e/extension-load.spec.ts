import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * e2e：在真实 Edge / Chrome 中加载 dist 构建目录。
 *
 * 阶段 1（注入与错误归因）：
 *   - 扩展（脚本 URL 为 chrome-extension://browser-extension://，或 [dsgenui] 日志前缀）→ 测试失败；
 *   - 站点（脚本 URL 为 http(s) 页面/资源地址）→ 真实网页模式仅记录，不计为扩展问题；
 *   - 无法归因（缺少脚本 URL、也无扩展日志前缀）→ 单列记录，不武断认定为网站错误。
 *   结论口径（收窄）：只能表述为“未发现可归因于扩展的错误”。
 *
 * 阶段 2（完整呈现链路）：
 *   - 默认拦截导航并返回本地模拟页面（结构忠实复刻阶段 0 取证的 DOM）：
 *     2 个合法 genui 块、1 个 json 标签块、1 个非法 JSON 块、1 个用户消息内的
 *     genui 块、普通 Markdown 段落——验证挂载、隔离、回退与「查看原始 JSON」切换；
 *   - REAL_SITE=1 时模拟页断言跳过，改为向真实 origin 注入结构忠实的合成消息，
 *     验证识别与挂载链路（合成结构验证，非站点原生 genui 输出——后者需登录态与
 *     真实模型回复，见阶段 2 手动验证记录）；
 *   - HEADED=1 强制有头模式。
 *
 * 模拟页无任何页面脚本与子资源，浏览器内唯一运行的脚本即被测扩展，
 * 故该模式下三类桶中的错误都判定失败。
 */

const DIST = join(process.cwd(), 'dist');
const REAL_SITE = process.env.REAL_SITE === '1';
const MARKER = 'data-genui-ext-loaded';
const EXT_PREFIX = '[dsgenui]';

const CHANNELS = [
  { label: 'Edge', channel: 'msedge' },
  { label: 'Chrome', channel: 'chrome' },
] as const;

/** 真实取证的代码块结构（阶段 0 §3.3）：banner 链 + 语言标签 span.d813de27 + pre>span。 */
function bannerHtml(label: string): string {
  return (
    '<div class="md-code-block-banner-wrap">' +
    '<div class="md-code-block-banner md-code-block-banner-lite">' +
    '<div class="_121d384"><div class="d2a24f03">' +
    `<span class="d813de27">${label}</span>` +
    '</div></div></div></div>'
  );
}

function codeBlockHtml(id: string, label: string, raw: string): string {
  return (
    `<div class="md-code-block md-code-block-light" id="${id}">` +
    bannerHtml(label) +
    `<pre><span>${raw}</span></pre></div>`
  );
}

const VALID_RAW_1 = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"透明增强测试"}]}';
const VALID_RAW_2 = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"第二张卡片"}]}';
const USER_RAW = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"用户消息中的块"}]}';
const INVALID_RAW = '{"type":"genui",';

const MOCK_HTML =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<title>GenUI 模拟页面</title></head><body><main>' +
  '<p>本地模拟页面：用于验证内容脚本注入与阶段 2 呈现链路，不访问真实站点。</p>' +
  // 用户消息：其中的 genui 块绝不能被处理。
  '<div class="ds-message" id="e2e-user"><p>用户消息</p>' +
  codeBlockHtml('e2e-user-block', 'genui', USER_RAW) +
  '</div>' +
  // AI 回复 1：普通段落 + 合法块 + json 标签块（跳过）+ 非法 JSON 块（回退）。
  '<div class="ds-assistant-message-main-content" id="e2e-a1">' +
  '<p class="ds-markdown-paragraph">普通 Markdown 段落，提到 genui 一词也不应被处理。</p>' +
  codeBlockHtml('e2e-block-1', 'genui', VALID_RAW_1) +
  codeBlockHtml('e2e-block-json', 'json', VALID_RAW_1) +
  codeBlockHtml('e2e-block-bad', 'genui', INVALID_RAW) +
  '</div>' +
  // AI 回复 2：第二个合法块，验证多块独立呈现。
  '<div class="ds-assistant-message-main-content" id="e2e-a2">' +
  codeBlockHtml('e2e-block-2', 'genui', VALID_RAW_2) +
  '</div>' +
  '</main></body></html>';

/**
 * 真实网页模式：在 document-start 安装的注入器——body 一出现即写入结构忠实的
 * 合成 AI 回复（先断开 Observer 再插入，避免自触发）。这保证合成消息早于
 * document_idle 的内容脚本存在，无需测试钩子即可验证识别与挂载。
 */
const SYNTHETIC_INJECTOR = `
(() => {
  const json = ${JSON.stringify(VALID_RAW_1)};
  const html =
    '<div class="ds-assistant-message-main-content" id="e2e-real-msg">' +
    '<p>合成结构验证消息（非真实模型输出）。</p>' +
    '<div class="md-code-block md-code-block-light" id="e2e-real-block">' +
    ${JSON.stringify(bannerHtml('genui'))} +
    '<pre><span>' + json + '</span></pre></div></div>';
  const observer = new MutationObserver(() => {
    if (document.body) {
      observer.disconnect();
      document.body.insertAdjacentHTML('beforeend', html);
    }
  });
  observer.observe(document, { childList: true, subtree: true });
})();
`;

type Attribution = 'extension' | 'site' | 'unattributed';

/** 从脚本 URL 与错误文本两条线索归因；线索不足时明确归为 unattributed，不猜。 */
function classify(scriptUrl: string, text: string): Attribution {
  if (/(?:chrome|browser)-extension:\/\//.test(scriptUrl + ' ' + text)) return 'extension';
  if (text.includes(EXT_PREFIX)) return 'extension';
  if (/^https?:\/\//.test(scriptUrl)) return 'site';
  return 'unattributed';
}

/** pageerror 没有 location，只能从堆栈里取首个脚本 URL。 */
function stackScriptUrl(stack: string | undefined): string {
  return stack?.match(/(?:chrome|browser)-extension:\/\/\S+|https?:\/\/\S+/)?.[0] ?? '';
}

/** 按归因收集页面错误；每个测试在导航前调用一次。 */
function watchErrors(page: Page): Record<Attribution, string[]> {
  const buckets: Record<Attribution, string[]> = { extension: [], site: [], unattributed: [] };
  page.on('pageerror', (error) => {
    const url = stackScriptUrl(error.stack);
    buckets[classify(url, error.message)].push(
      `pageerror: ${error.message}${url ? `（堆栈脚本: ${url}）` : '（堆栈无脚本 URL）'}`,
    );
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const url = message.location().url;
    buckets[classify(url, message.text())].push(
      `console.error: ${message.text()}${url ? `（脚本: ${url}）` : '（无脚本 URL）'}`,
    );
  });
  return buckets;
}

/** 真实网页口径：仅可归因于扩展的错误判定失败，其余记录、不武断归因。 */
function expectNoExtensionErrors(buckets: Record<Attribution, string[]>, label: string): void {
  expect(buckets.extension, '可归因于扩展的错误').toEqual([]);
  if (buckets.site.length > 0) {
    console.log(`[${label}] 归因为站点的错误（记录，不计为扩展问题）：`, buckets.site);
  }
  if (buckets.unattributed.length > 0) {
    console.log(
      `[${label}] 无法归因的错误（记录，不认定为网站、也不认定为扩展，来源判断待补强）：`,
      buckets.unattributed,
    );
  }
}

interface Launched {
  context: BrowserContext;
  page: Page;
  profileDir: string;
}

async function launchWithExtension(channel: string): Promise<Launched> {
  if (!existsSync(join(DIST, 'manifest.json'))) {
    throw new Error(`缺少 ${join(DIST, 'manifest.json')}，请先运行 npm run build`);
  }
  const profileDir = mkdtempSync(join(tmpdir(), `dsgenui-${channel}-`));
  const context = await chromium.launchPersistentContext(profileDir, {
    channel,
    headless: process.env.HEADED !== '1',
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--enable-unsafe-extension-testing',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  if (!REAL_SITE) {
    await context.route('https://chat.deepseek.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: MOCK_HTML,
      }),
    );
  }
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page, profileDir };
}

/** 打开目标页并等待内容脚本写入注入标记（32 位扩展 id）。 */
async function gotoAndAwaitMarker(page: Page): Promise<void> {
  await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`html[${MARKER}]`)).toHaveAttribute(MARKER, /^[a-p]{32}$/, {
    timeout: 30_000,
  });
}

for (const { label, channel } of CHANNELS) {
  test(`阶段 1 · ${label} 加载构建目录并注入内容脚本`, async () => {
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await gotoAndAwaitMarker(page);

      if (!REAL_SITE) {
        // 模拟页无页面脚本、无子资源，唯一在运行的脚本是被测扩展：
        // 任何桶中的错误都只可能由扩展引起（含扩展发起的网络请求），一律判定失败。
        const all = [...buckets.extension, ...buckets.site, ...buckets.unattributed];
        expect(all, '模拟页中出现错误（唯一脚本即被测扩展，全部归因于扩展）').toEqual([]);
      } else {
        expectNoExtensionErrors(buckets, label);
      }
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test(`阶段 2 · ${label} 模拟页完整呈现链路`, async () => {
    test.skip(REAL_SITE, '模拟页断言仅在拦截模式执行；真实网页用合成结构测试覆盖');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await gotoAndAwaitMarker(page);

      // 恰好 2 个卡片：仅 2 个合法 genui 块被挂载（json 标签、非法块、用户消息块均不挂）。
      const hosts = page.locator('.genui-card-host');
      await expect(hosts).toHaveCount(2);
      // 卡片插在原块紧前位置（局部挂载）。
      await expect(page.locator('.genui-card-host + #e2e-block-1')).toHaveCount(1);
      await expect(page.locator('.genui-card-host + #e2e-block-2')).toHaveCount(1);

      // Shadow DOM 内渲染出协议文本（CSS 选择器穿透 open shadow root）。
      await expect(page.locator('.genui-card-root').nth(0)).toContainText('透明增强测试');
      await expect(page.locator('.genui-card-root').nth(1)).toContainText('第二张卡片');

      // 合法块：原块隐藏并标记 mounted。
      await expect(page.locator('#e2e-block-1')).toHaveCSS('display', 'none');
      await expect(page.locator('#e2e-block-1')).toHaveAttribute('data-genui-state', 'mounted');
      await expect(page.locator('#e2e-block-2')).toHaveAttribute('data-genui-state', 'mounted');

      // 非法 JSON 块：安全回退，原块可见、标记 failed + invalid-json。
      await expect(page.locator('#e2e-block-bad')).toBeVisible();
      await expect(page.locator('#e2e-block-bad')).toHaveAttribute('data-genui-state', 'failed');
      await expect(page.locator('#e2e-block-bad')).toHaveAttribute(
        'data-genui-reason',
        'invalid-json',
      );

      // 普通 Markdown、json 标签块、用户消息内的 genui 块完全不受影响。
      for (const selector of ['#e2e-block-json', '#e2e-user-block']) {
        await expect(page.locator(selector)).toBeVisible();
        expect(
          await page.locator(selector).getAttribute('data-genui-state'),
          `${selector} 不应有挂载状态`,
        ).toBeNull();
      }

      // 「查看原始 JSON」切换：原块恢复可见、卡片保持可见（入口可再次收起），文案互换。
      const toggle = hosts.nth(0).locator('button.genui-card-toggle');
      await expect(toggle).toHaveText('查看原始 JSON');
      await toggle.click();
      await expect(page.locator('#e2e-block-1')).toBeVisible();
      await expect(hosts.nth(0)).toBeVisible();
      await expect(toggle).toHaveText('收起原始 JSON');
      await toggle.click();
      await expect(page.locator('#e2e-block-1')).toBeHidden();
      await expect(toggle).toHaveText('查看原始 JSON');

      // 模拟页唯一脚本即被测扩展：任何错误都判定失败。
      const all = [...buckets.extension, ...buckets.site, ...buckets.unattributed];
      expect(all, '模拟页中出现错误（唯一脚本即被测扩展，全部归因于扩展）').toEqual([]);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test(`阶段 2 · ${label} 真实网页合成结构最小案例`, async () => {
    test.skip(!REAL_SITE, '仅 REAL_SITE=1 时执行');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      // document-start 注入合成消息，保证早于 document_idle 的内容脚本。
      await context.addInitScript(SYNTHETIC_INJECTOR);
      await gotoAndAwaitMarker(page);

      // 识别 + 挂载成功：1 个卡片，原块隐藏。
      await expect(page.locator('.genui-card-host')).toHaveCount(1, { timeout: 30_000 });
      await expect(page.locator('.genui-card-root').first()).toContainText('透明增强测试');
      await expect(page.locator('#e2e-real-block')).toHaveCSS('display', 'none');
      await expect(page.locator('#e2e-real-block')).toHaveAttribute(
        'data-genui-state',
        'mounted',
      );

      // 真实网页：仅扩展可归因错误判定失败；同时记录合成结构验证的口径。
      console.log(`[${label}] 真实网页合成结构验证（非站点原生 genui 输出）`);
      expectNoExtensionErrors(buckets, label);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });
}
