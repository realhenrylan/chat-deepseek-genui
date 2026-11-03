import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { GENUI_PROMPT_TEXT } from '../../src/content/prompt';

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
 * 阶段 3（动态生命周期与可关闭增强）：
 *   - 模拟页验证生成活跃时暂缓/撤下卡片、稳定后挂载、消息改写与节点替换清理；
 *   - 验证本地开关、页面原生输入/滚动/Markdown/复制事件；
 *   - REAL_SITE=1 在真实 origin 上使用合成回复 DOM 验证生命周期与回退，不读取聊天内容；
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
    `<div role="button" tabindex="0" class="e2e-native-copy" id="${id}-copy">复制</div>` +
    `<pre><span>${raw}</span></pre></div>`
  );
}

const VALID_RAW_1 = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"透明增强测试"}]}';
const VALID_RAW_2 = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"第二张卡片"}]}';
const USER_RAW = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"用户消息中的块"}]}';
const INVALID_RAW = '{"type":"genui",';
const SORT_VALID_RAW = JSON.stringify({
  type: 'genui',
  version: 3,
  title: '价格排序',
  state: [],
  derived: [],
  elements: [
    {
      kind: 'table',
      title: '价格表',
      sortable: true,
      initialSort: { key: 'price', dir: 'asc' },
      columns: [
        { key: 'price', label: '价格', numeric: true },
        { key: 'name', label: '名称' },
      ],
      rows: [
        { cells: { price: 30, name: '丙' } },
        { cells: { price: 10, name: '甲' } },
      ],
    },
  ],
});
const SORT_INVALID_RAW = SORT_VALID_RAW.replace('"dir":"asc"', '"direction":"asc"');
const INTERACTIVE_RAW = JSON.stringify({
  type: 'genui',
  version: 2,
  title: '本地预算计算',
  state: [
    { id: 'budget', label: '总预算', kind: 'number', initial: 100, min: 0, max: 200, step: 10, unit: '元' },
    { id: 'spent', label: '已支出', kind: 'number', initial: 40, min: 0, max: 100, step: 10, unit: '元' },
    { id: 'category', label: '类别', kind: 'select', initial: 'food', options: [
      { label: '餐饮', value: 'food' }, { label: '交通', value: 'transport' },
    ] },
  ],
  derived: [{
    id: 'balance', label: '余额', unit: '元',
    expression: { op: 'subtract', left: { op: 'state', id: 'budget' }, right: { op: 'state', id: 'spent' } },
  }],
  elements: [
    { kind: 'slider', bind: 'budget' },
    { kind: 'number-input', bind: 'spent' },
    { kind: 'select', bind: 'category' },
    { kind: 'value', label: '当前类别', source: { kind: 'state', id: 'category' } },
    { kind: 'value', label: '当前余额', source: { kind: 'derived', id: 'balance' } },
  ],
});
const PROTOTYPE_RAW = JSON.stringify({
  type: 'genui',
  version: 2,
  title: '原型同名 ID',
  state: [
    { id: 'constructor', label: '数量', kind: 'number', initial: 42, min: 0, max: 100, step: 1 },
  ],
  derived: [{
    id: 'toString',
    label: '翻倍',
    expression: {
      op: 'add',
      left: { op: 'state', id: 'constructor' },
      right: { op: 'state', id: 'constructor' },
    },
  }],
  elements: [
    { kind: 'number-input', bind: 'constructor' },
    { kind: 'value', label: '派生结果', source: { kind: 'derived', id: 'toString' } },
  ],
});
const BIG_RANGE_RAW = JSON.stringify({
  type: 'genui',
  version: 2,
  title: '大范围步长',
  state: [{
    id: 'distance',
    label: '距离',
    kind: 'number',
    initial: 1_000_000_000,
    min: 0,
    max: 1_000_000_000_000,
    step: 1,
    unit: '米',
  }],
  derived: [{
    id: 'plusOne',
    label: '加一',
    unit: '米',
    expression: {
      op: 'add',
      left: { op: 'state', id: 'distance' },
      right: { op: 'const', value: 1 },
    },
  }],
  elements: [
    { kind: 'number-input', bind: 'distance' },
    { kind: 'value', label: '派生结果', source: { kind: 'derived', id: 'plusOne' } },
  ],
});

const V3_COMPOSITE_RAW = JSON.stringify({
  type: 'genui',
  version: 3,
  title: 'v3 组合验收',
  state: [{ id: 'amount', label: '金额', kind: 'number', initial: 10, min: 0, max: 100, step: 1, unit: '元' }],
  derived: [
    {
      id: 'doubled',
      label: '双倍',
      expression: { op: 'multiply', left: { op: 'state', id: 'amount' }, right: { op: 'const', value: 2 } },
    },
  ],
  elements: [
    { kind: 'slider', bind: 'amount' },
    { kind: 'note', tone: 'warn', text: '金额超过 15 元', visibleIf: { op: 'num-gt', left: { op: 'state', id: 'amount' }, right: { op: 'const', value: 15 } } },
    {
      kind: 'columns',
      columns: [
        [{ kind: 'value', label: '双倍金额', source: { kind: 'derived', id: 'doubled' }, unit: '元' }],
        [{ kind: 'text', value: '调整金额后图表与表格同步更新。' }],
      ],
    },
    {
      kind: 'chart',
      chartType: 'bar',
      title: '金额条形图',
      items: [{ label: '当前金额', value: { op: 'state', id: 'amount' } }],
    },
    {
      kind: 'table',
      title: '金额明细',
      sortable: true,
      initialSort: { key: 'value', dir: 'desc' },
      columns: [
        { key: 'name', label: '项目' },
        { key: 'value', label: '数值', numeric: true, unit: '元' },
      ],
      rows: [
        { cells: { name: '当前金额', value: { op: 'state', id: 'amount' } } },
        { cells: { name: '双倍金额', value: { op: 'derived', id: 'doubled' } } },
      ],
    },
  ],
});

const MOCK_HTML =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<title>GenUI 模拟页面</title></head><body><main>' +
  '<p>本地模拟页面：用于验证内容脚本注入与阶段 2 呈现链路，不访问真实站点。</p>' +
  '<textarea id="e2e-input" name="search" aria-label="消息输入框"></textarea>' +
  '<p id="e2e-plain">普通 Markdown 仍是原生内容。<a id="e2e-link" href="#e2e-link-target">普通链接</a></p>' +
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
  codeBlockHtml('e2e-block-sort', 'genui', SORT_INVALID_RAW) +
  '</div>' +
  // AI 回复 2：第二个合法块，验证多块独立呈现。
  '<div class="ds-assistant-message-main-content" id="e2e-a2">' +
  codeBlockHtml('e2e-block-2', 'genui', VALID_RAW_2) +
  '</div><div id="e2e-link-target">链接目标</div><div style="height:1800px"></div>' +
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

const INTERACTIVE_SYNTHETIC_INJECTOR = `
(() => {
  const raw = ${JSON.stringify(INTERACTIVE_RAW)};
  const inject = () => {
    if (!document.body || document.querySelector('#e2e-real-interactive-block')) return;
    const message = document.createElement('div');
    message.className = 'ds-assistant-message-main-content';
    message.id = 'e2e-real-interactive-message';
    const block = document.createElement('div');
    block.className = 'md-code-block md-code-block-light';
    block.id = 'e2e-real-interactive-block';
    block.innerHTML = '<div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>';
    const pre = document.createElement('pre');
    const content = document.createElement('span');
    content.textContent = raw;
    pre.append(content);
    block.append(pre);
    message.append(block);
    document.body.append(message);
  };
  const observer = new MutationObserver(inject);
  observer.observe(document, { childList: true, subtree: true });
  inject();
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

interface ViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
}

interface ToggleBounds {
  panel: ViewportRect;
  host: ViewportRect;
  viewportWidth: number;
  viewportHeight: number;
}

/** 读取 shadow DOM 中说明面板与浮标宿主的视口矩形（只通过公开 DOM 观测）。 */
async function readToggleBounds(page: Page): Promise<ToggleBounds> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-genui-control]');
    const panel = host?.shadowRoot?.querySelector('.panel');
    if (!host || !panel) throw new Error('未找到 GenUI 浮标或说明面板');
    const toRect = (element: Element): ViewportRect => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
      };
    };
    return {
      panel: toRect(panel),
      host: toRect(host),
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    };
  });
}

/** 说明面板与浮标都应完整留在视口内（容忍 0.5px 子像素取整）。 */
function expectToggleInsideViewport(bounds: ToggleBounds): void {
  const targets = [
    { name: '说明面板', rect: bounds.panel },
    { name: '浮标', rect: bounds.host },
  ];
  for (const { name, rect } of targets) {
    expect(rect.left, `${name}左缘不应超出视口`).toBeGreaterThanOrEqual(-0.5);
    expect(rect.top, `${name}上缘不应超出视口`).toBeGreaterThanOrEqual(-0.5);
    expect(rect.right, `${name}右缘不应超出视口`).toBeLessThanOrEqual(bounds.viewportWidth + 0.5);
    expect(rect.bottom, `${name}下缘不应超出视口`).toBeLessThanOrEqual(bounds.viewportHeight + 0.5);
  }
  expect(bounds.panel.width, '窄视口下说明面板仍应保留可读宽度').toBeGreaterThanOrEqual(200);
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

  test(`阶段 3b · ${label} 排序字段错误的状态、修复草稿与恢复`, async () => {
    test.skip(REAL_SITE, '模拟页交互断言仅在拦截模式执行');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await gotoAndAwaitMarker(page);
      const block = page.locator('#e2e-block-sort');
      await block.scrollIntoViewIfNeeded();
      await expect(block).toHaveAttribute('data-genui-state', 'failed');
      await expect(block).toHaveAttribute('data-genui-reason', 'schema-violation');
      await expect(block).toHaveAttribute('data-genui-status', 'invalid');

      const panel = page.locator('#e2e-block-sort + .genui-status-host');
      await expect(panel).toHaveCount(1);
      await expect(panel).toContainText('initialSort');
      await expect(panel).toContainText('direction');

      const input = page.locator('#e2e-input');
      const repair = panel.locator('[data-genui-action="repair"]');
      await repair.click();
      await expect(input).toHaveValue(/elements\[0\]\.initialSort\.direction/);
      const firstDraft = await input.inputValue();

      // 重复点击不重复追加，也不自动发送。
      await repair.click();
      await expect(input).toHaveValue(firstDraft);

      // 原始内容仍在，可用修复后的合法 v3 文档重新挂载。
      await block.locator('pre span').evaluate((el, raw) => {
        el.textContent = raw;
      }, SORT_VALID_RAW);
      await expect(block).toHaveAttribute('data-genui-state', 'mounted', { timeout: 8000 });
      await expect(page.locator('.genui-card-host + #e2e-block-sort')).toHaveCount(1);
      await expect(page.locator('#e2e-block-sort + .genui-status-host')).toHaveCount(0);
      // 页面增强器可能继续往草稿追加说明，不要求整段相等；但修复内容仍只出现一次。
      const finalDraft = await input.inputValue();
      expect(finalDraft).toContain('elements[0].initialSort.direction');
      // 修复请求中「错误摘要」和「错误路径」各引用一次；重复点击后仍是 2 次，没有整段重复追加。
      expect(finalDraft.match(/elements\[0\]\.initialSort\.direction/g)?.length ?? 0).toBe(2);

      const all = [...buckets.extension, ...buckets.site, ...buckets.unattributed];
      expect(all, '模拟页中出现错误（唯一脚本即被测扩展，全部归因于扩展）').toEqual([]);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test(`阶段 3 · ${label} 生成等待、开关和原生交互`, async () => {
    test.skip(REAL_SITE, '模拟页交互断言仅在拦截模式执行');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: 'https://chat.deepseek.com',
      });
      await gotoAndAwaitMarker(page);
      await expect(page.locator('.genui-card-host')).toHaveCount(2);

      const control = page.locator('[data-genui-control]');
      const controlButton = control.locator('button').first();
      await expect(control).toContainText('GenUI 已开启');

      // 输入、滚动与普通 Markdown 的事件仍由页面正常处理。
      await page.locator('#e2e-input').fill('保留的输入草稿');
      // 默认增强会在停止输入后追加可见说明；此处只验证用户原文仍在开头。
      await expect(page.locator('#e2e-input')).toHaveValue(/^保留的输入草稿/);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await page.locator('#e2e-link').click();
      await expect(page).toHaveURL(/#e2e-link-target$/);
      await expect(page.locator('#e2e-plain')).toContainText('普通 Markdown 仍是原生内容');

      // 查看原文后，代码块原有复制控件仍可收到事件并复制原始文本。
      const rawToggle = page.locator('.genui-card-host').first().locator('button.genui-card-toggle');
      await rawToggle.click();
      const copyControl = page.locator('#e2e-block-1-copy');
      await expect(copyControl).toBeVisible();
      await page.locator('#e2e-block-1').evaluate((block) => {
        const copy = block.querySelector('.e2e-native-copy');
        copy?.addEventListener('click', () => {
          const text = block.querySelector('pre')?.textContent ?? '';
          void navigator.clipboard.writeText(text);
        });
      });
      await copyControl.click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(VALID_RAW_1);

      // 关闭时立即恢复原始块；设置保存在本地，重新加载后仍为关闭状态。
      await controlButton.click();
      await expect(page.locator('.genui-card-host')).toHaveCount(0);
      await expect(page.locator('#e2e-block-1')).toBeVisible();
      await expect(page.locator('#e2e-block-1')).not.toHaveAttribute('data-genui-state', 'mounted');
      await page.waitForTimeout(100);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(`html[${MARKER}]`)).toHaveAttribute(MARKER, /^[a-p]{32}$/);
      await expect(page.locator('[data-genui-control]')).toContainText('GenUI 已关闭');
      await expect(page.locator('.genui-card-host')).toHaveCount(0);

      // 重新开启后，已完成的回复重新经过稳定检测并挂载。
      await page.locator('[data-genui-control]').locator('button').first().click();
      await expect(page.locator('.genui-card-host')).toHaveCount(2);

      const all = [...buckets.extension, ...buckets.site, ...buckets.unattributed];
      expect(all, '模拟页中出现错误（唯一脚本即被测扩展，全部归因于扩展）').toEqual([]);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test(`阶段 4 · ${label} 控件即时计算、隔离与无额外请求`, async () => {
    test.skip(REAL_SITE, '阶段 4 的控件自动化使用本地合成页面；不依赖真实会话内容');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await gotoAndAwaitMarker(page);
      await page.locator('#e2e-input').fill('保留的本地草稿');

      // 在两条独立回复中追加相同的合成 v2 文档，验证状态不跨卡片共享。
      await page.evaluate((raw) => {
        for (const id of ['e2e-interactive-1', 'e2e-interactive-2']) {
          const message = document.createElement('div');
          message.className = 'ds-assistant-message-main-content';
          message.id = `${id}-message`;
          const block = document.createElement('div');
          block.className = 'md-code-block md-code-block-light';
          block.id = id;
          block.innerHTML = '<div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>';
          const pre = document.createElement('pre');
          const content = document.createElement('span');
          content.textContent = raw;
          pre.append(content);
          block.append(pre);
          message.append(block);
          document.body.append(message);
        }
      }, INTERACTIVE_RAW);

      const hosts = page.locator('.genui-card-host');
      await expect(hosts).toHaveCount(4);
      const first = hosts.nth(2);
      const second = hosts.nth(3);
      await expect(first).toContainText('本地预算计算');
      await expect(first.locator('.genui-value-output').nth(1)).toHaveText('60 元');
      await expect(second.locator('.genui-value-output').nth(1)).toHaveText('60 元');

      const interactionRequests: string[] = [];
      page.on('request', (request) => interactionRequests.push(request.url()));

      const slider = first.locator('input[type="range"]');
      await slider.focus();
      await slider.press('ArrowRight');
      await expect(first.locator('.genui-control-current')).toHaveText('110 元');
      await expect(first.locator('.genui-value-output').nth(1)).toHaveText('70 元');
      await expect(second.locator('.genui-value-output').nth(1)).toHaveText('60 元');

      const numberInput = first.locator('input[type="number"]');
      await numberInput.fill('60');
      await expect(first.locator('.genui-value-output').nth(1)).toHaveText('50 元');
      await numberInput.fill('');
      await expect(first.locator('[role="status"]')).toContainText('请输入有限数字');
      await expect(first.locator('.genui-value-output').nth(1)).toHaveText('50 元');
      await numberInput.fill('500');
      await expect(first.locator('[role="status"]')).toContainText('之间的值');
      await expect(first.locator('.genui-value-output').nth(1)).toHaveText('50 元');

      await first.locator('select').selectOption('transport');
      await expect(first.locator('.genui-value-output').first()).toHaveText('交通');
      await expect(second.locator('.genui-value-output').first()).toHaveText('餐饮');

      await first.locator('.genui-card-reset').click();
      await expect(first.locator('input[type="range"]')).toHaveValue('100');
      await expect(first.locator('input[type="number"]')).toHaveValue('40');
      await expect(first.locator('select')).toHaveValue('food');
      await expect(first.locator('.genui-value-output').nth(1)).toHaveText('60 元');
      // 默认增强已生效：草稿保留在开头，可见说明追加在其后。
      await expect(page.locator('#e2e-input')).toHaveValue(
        `保留的本地草稿\n\n${GENUI_PROMPT_TEXT}`,
      );
      expect(interactionRequests, '控件操作期间不得产生网络请求').toEqual([]);

      const all = [...buckets.extension, ...buckets.site, ...buckets.unattributed];
      expect(all, '模拟页中出现错误（唯一脚本即被测扩展，全部归因于扩展）').toEqual([]);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test(`阶段 4 P2 回归 · ${label} 原型同名 ID 与大步数步长`, async () => {
    test.skip(REAL_SITE, 'P2 控件回归使用本地合成页面；不依赖真实会话内容');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await gotoAndAwaitMarker(page);
      await page.evaluate((documents) => {
        for (const { id, raw } of documents) {
          const message = document.createElement('div');
          message.className = 'ds-assistant-message-main-content';
          message.id = `${id}-message`;
          const block = document.createElement('div');
          block.className = 'md-code-block md-code-block-light';
          block.id = id;
          block.innerHTML = '<div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>';
          const pre = document.createElement('pre');
          const content = document.createElement('span');
          content.textContent = raw;
          pre.append(content);
          block.append(pre);
          message.append(block);
          document.body.append(message);
        }
      }, [
        { id: 'e2e-prototype-id', raw: PROTOTYPE_RAW },
        { id: 'e2e-big-range', raw: BIG_RANGE_RAW },
      ]);

      const hosts = page.locator('.genui-card-host');
      await expect(hosts).toHaveCount(4);
      const prototypeCard = hosts.nth(2);
      const bigRangeCard = hosts.nth(3);
      await expect(prototypeCard).toContainText('原型同名 ID');
      await expect(bigRangeCard).toContainText('大范围步长');

      const prototypeInput = prototypeCard.locator('input[type="number"]');
      const prototypeOutput = prototypeCard.locator('.genui-value-output');
      await expect(prototypeInput).toHaveValue('42');
      await expect(prototypeCard.locator('[role="status"]')).toHaveCount(0);
      await expect(prototypeOutput).toHaveText('84');

      await prototypeInput.fill('50');
      await expect(prototypeOutput).toHaveText('100');
      await prototypeInput.fill('150');
      await expect(prototypeCard.locator('[role="status"]')).toContainText('之间的值');
      await expect(prototypeOutput).toHaveText('100');
      await prototypeInput.fill('60');
      await expect(prototypeCard.locator('[role="status"]')).toHaveCount(0);
      await expect(prototypeOutput).toHaveText('120');

      const bigRangeInput = bigRangeCard.locator('input[type="number"]');
      const bigRangeOutput = bigRangeCard.locator('.genui-value-output');
      await expect(bigRangeInput).toHaveValue('1000000000');
      await expect(bigRangeOutput).toHaveText('1000000001 米');
      await expect(bigRangeInput).toHaveValue('1000000000');
      await prototypeCard.locator('.genui-card-reset').click();
      await expect(prototypeInput).toHaveValue('42');
      await expect(prototypeOutput).toHaveText('84');
      await expect(bigRangeInput).toHaveValue('1000000000');
      await expect(bigRangeOutput).toHaveText('1000000001 米');

      await bigRangeInput.fill('1000000000.5');
      await expect(bigRangeCard.locator('[role="status"]')).toContainText('1 为步长');
      await expect(bigRangeOutput).toHaveText('1000000001 米');
      await bigRangeInput.fill('1000000001');
      await expect(bigRangeCard.locator('[role="status"]')).toHaveCount(0);
      await expect(bigRangeOutput).toHaveText('1000000002 米');
      await bigRangeInput.fill('1000000000000');
      // 输入本身合法（等于状态上限），但派生结果 1e12+1 超出严格计算上限；
      // 显示舍入不能让错误消失。
      await expect(bigRangeInput).not.toHaveAttribute('aria-invalid', 'true');
      await expect(bigRangeInput).toHaveValue('1000000000000');
      await expect(bigRangeCard.locator('[role="status"]')).toContainText('结果超出可计算范围');
      await expect(bigRangeOutput).toHaveCount(0);
      await expect(prototypeInput).toHaveValue('42');
      await expect(prototypeOutput).toHaveText('84');

      expectNoExtensionErrors(buckets, `${label} 阶段 4 P2 回归`);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test(`阶段 5 · ${label} 组合卡片图表/表格/条件联动`, async () => {
    test.skip(REAL_SITE, 'v3 组合验收使用本地合成页面');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await gotoAndAwaitMarker(page);
      await page.evaluate((raw) => {
        const message = document.createElement('div');
        message.className = 'ds-assistant-message-main-content';
        const block = document.createElement('div');
        block.className = 'md-code-block md-code-block-light';
        block.innerHTML = '<div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>';
        const pre = document.createElement('pre');
        const content = document.createElement('span');
        content.textContent = raw;
        pre.append(content);
        block.append(pre);
        message.append(block);
        document.body.append(message);
      }, V3_COMPOSITE_RAW);

      const hosts = page.locator('.genui-card-host');
      await expect(hosts).toHaveCount(3);
      const card = hosts.last();
      await expect(card).toContainText('v3 组合验收');
      await expect(card.locator('.genui-note')).toHaveCount(0);
      await expect(card.locator('.genui-chart')).toHaveCount(1);
      await expect(card.locator('.genui-table')).toHaveCount(1);
      await expect(card.locator('.genui-columns')).toHaveAttribute('data-columns', '2');

      const slider = card.locator('input[type="range"]');
      await slider.fill('20');
      await expect(card.locator('.genui-note')).toContainText('金额超过 15 元');
      await expect(card.locator('.genui-bar-value')).toHaveText('20');
      await expect(card.locator('.genui-table')).toContainText('当前金额20 元');
      await expect(card.locator('.genui-table')).toContainText('双倍金额40 元');
      await expect(card.locator('.genui-table-count')).toHaveText('显示 2 / 2 行');

      await card.locator('.genui-card-reset').click();
      await expect(slider).toHaveValue('10');
      await expect(card.locator('.genui-note')).toHaveCount(0);
      await expect(card.locator('.genui-bar-value')).toHaveText('10');

      expectNoExtensionErrors(buckets, `${label} 阶段 5 组合卡片`);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test(`阶段 6 · ${label} 主题跟随、展开保留状态与继续讨论`, async () => {
    test.skip(REAL_SITE, '阶段 6 使用本地合成页面覆盖主题/展开/继续讨论断言');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await gotoAndAwaitMarker(page);

      // 注入一张 v2 交互卡片（阶段 4 同款文档）与一张 v1 静态卡片，构成阶段 6 验收面。
      await page.evaluate(
        (raws: { interactive: string; static: string }) => {
          const container = document.createElement('div');
          container.className = 'ds-assistant-message-main-content';
          container.id = 'e2e-stage6';
          const makeBlock = (raw: string) => {
            const block = document.createElement('div');
            block.className = 'md-code-block md-code-block-light';
            block.innerHTML =
              '<div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>';
            const pre = document.createElement('pre');
            const content = document.createElement('span');
            content.textContent = raw;
            pre.append(content);
            block.append(pre);
            container.append(block);
          };
          makeBlock(raws.interactive);
          makeBlock(raws.static);
          document.body.append(container);
        },
        { interactive: INTERACTIVE_RAW, static: VALID_RAW_2 },
      );

      const message = page.locator('#e2e-stage6');
      const hosts = message.locator('.genui-card-host');
      await expect(hosts).toHaveCount(2);
      const card = hosts.nth(0);
      await expect(card).toContainText('本地预算计算');

      // —— 主题跟随：真实取证标记（body class + data-ds-dark-theme）→ 卡片与开关同步。
      const root = card.locator('.genui-card-root');
      await expect(root).toHaveAttribute('data-site-theme', 'light');
      await expect(page.locator('[data-genui-control]')).toHaveAttribute('data-site-theme', 'light');

      await page.evaluate(() => {
        document.body.classList.add('dark');
        document.body.setAttribute('data-ds-dark-theme', 'dark');
      });
      await expect(root).toHaveAttribute('data-site-theme', 'dark');
      await expect(page.locator('[data-genui-control]')).toHaveAttribute('data-site-theme', 'dark');

      await page.evaluate(() => {
        document.body.classList.remove('dark');
        document.body.classList.add('light');
        document.body.removeAttribute('data-ds-dark-theme');
      });
      await expect(root).toHaveAttribute('data-site-theme', 'light');

      // —— 展开/收起：默认展开；收起隐藏体与脚注、状态不丢失；展开恢复当前值。
      const expand = card.locator('button.genui-card-expand');
      await expect(expand).toHaveText('收起界面');
      await expect(expand).toHaveAttribute('aria-expanded', 'true');
      await expect(expand).toHaveAttribute('aria-controls', /.+/);

      const slider = card.locator('input[type="range"]');
      await slider.fill('0');
      await expect(card.locator('.genui-value-output').nth(1)).toHaveText('-40 元');

      await expand.click();
      await expect(expand).toHaveText('展开查看');
      await expect(expand).toHaveAttribute('aria-expanded', 'false');
      await expect(card.locator('.genui-card-body')).toBeHidden();
      await expect(card.locator('.genui-card-footer')).toBeHidden();

      await expand.click();
      await expect(expand).toHaveText('收起界面');
      await expect(card.locator('.genui-card-body')).toBeVisible();
      // 展开恢复后现场仍在：用户改过的滑块值与派生输出保留（不重渲染、不重置）。
      await expect(slider).toHaveValue('0');
      await expect(card.locator('.genui-value-output').nth(1)).toHaveText('-40 元');

      // —— 继续讨论：用户主动触发、当前条件与结果带入输入框、不自动发送。
      const input = page.locator('#e2e-input');
      await expect(input).toHaveValue('');

      await card.locator('button.genui-card-followup').click();
      await expect(input).toHaveValue(/继续讨论「本地预算计算」/);
      await expect(input).toHaveValue(/总预算：0 元/);
      await expect(input).toHaveValue(/请基于以上当前条件与结果继续讨论/);

      // 已有草稿：追加在草稿之后，原草稿一字不动；反馈明确告知发送由用户完成。
      await input.fill('用户手动草稿');
      await card.locator('button.genui-card-followup').click();
      await expect(input).toHaveValue(/^用户手动草稿\n\n继续讨论「本地预算计算」/);
      await expect(card.locator('.genui-card-followup-feedback')).toContainText('草稿已保留');
      const withDraft = await input.inputValue();

      // 重复点击不重复追加（去重）。
      await card.locator('button.genui-card-followup').click();
      await expect(input).toHaveValue(withDraft);

      // v1 静态卡片没有「继续讨论」入口。
      await expect(hosts.nth(1).locator('button.genui-card-followup')).toHaveCount(0);
      // 输入框仍在、没有被清空，也没有发送动作可触发发送。
      await expect(input).not.toHaveValue('');

      const all = [...buckets.extension, ...buckets.site, ...buckets.unattributed];
      expect(all, '模拟页中出现错误（唯一脚本即被测扩展，全部归因于扩展）').toEqual([]);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test(`阶段 3 · ${label} 流式期间不挂载，消息重写和替换可清理`, async () => {
    test.skip(REAL_SITE, '模拟页动态生命周期断言仅在拦截模式执行');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await gotoAndAwaitMarker(page);
      await expect(page.locator('.genui-card-host')).toHaveCount(2);

      await page.evaluate(({ partial, blockHtml }) => {
        const stop = document.createElement('div');
        stop.id = 'e2e-stop';
        stop.setAttribute('role', 'button');
        stop.setAttribute('aria-label', '停止生成');
        document.body.append(stop);
        const message = document.createElement('div');
        message.id = 'e2e-stream-message';
        message.className = 'ds-assistant-message-main-content';
        message.innerHTML = blockHtml.replace('__PARTIAL__', partial);
        document.body.append(message);
      }, {
        partial: '{"type":"genui",',
        blockHtml:
          '<div class="md-code-block" id="e2e-stream-block">' +
          '<div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>' +
          '<pre><span>__PARTIAL__</span></pre></div>',
      });

      await page.waitForTimeout(850);
      await expect(page.locator('#e2e-stream-block')).not.toHaveAttribute('data-genui-state', 'mounted');
      await expect(page.locator('#e2e-stream-block')).not.toHaveAttribute('data-genui-state', 'failed');
      await expect(page.locator('.genui-card-host')).toHaveCount(0);

      await page.locator('#e2e-stream-block pre span').evaluate((node, value) => {
        node.textContent = value;
      }, VALID_RAW_2);
      await page.waitForTimeout(850);
      await expect(page.locator('#e2e-stream-block')).not.toHaveAttribute('data-genui-state', 'mounted');
      await expect(page.locator('.genui-card-host')).toHaveCount(0);

      await page.locator('#e2e-stop').evaluate((node) => node.remove());
      await expect(page.locator('#e2e-stream-block')).toHaveAttribute('data-genui-state', 'mounted');
      await expect(page.locator('.genui-card-host')).toHaveCount(3);

      // 重新生成沿用同一节点时先卸载旧卡片；稳定后只保留一个新卡片。
      await page.evaluate(() => {
        const stop = document.createElement('div');
        stop.id = 'e2e-stop-regen';
        stop.setAttribute('role', 'button');
        stop.setAttribute('aria-label', '停止生成');
        document.body.append(stop);
        const block = document.querySelector('#e2e-block-1 pre span');
        if (block) block.textContent = '{"type":"genui",';
      });
      await expect(page.locator('.genui-card-host')).toHaveCount(0);
      await expect(page.locator('#e2e-block-1')).toBeVisible();
      await expect(page.locator('#e2e-block-1')).not.toHaveAttribute('data-genui-state', 'mounted');
      await page.locator('#e2e-block-1 pre span').evaluate((node, value) => {
        node.textContent = value;
      }, VALID_RAW_2);
      await page.locator('#e2e-stop-regen').evaluate((node) => node.remove());
      await expect(page.locator('#e2e-block-1')).toHaveAttribute('data-genui-state', 'mounted');
      await expect(page.locator('.genui-card-host')).toHaveCount(3);

      // 会话列表替换回复容器后，旧卡片 host 和 React 根均被清理。
      await page.locator('#e2e-a1').evaluate((node) => node.remove());
      await expect(page.locator('.genui-card-host')).toHaveCount(2);
      await expect(page.locator('#e2e-block-1')).toHaveCount(0);
      await page.locator('#e2e-stream-message').evaluate((node) => node.remove());
      await expect(page.locator('.genui-card-host')).toHaveCount(1);
      expectNoExtensionErrors(buckets, label);
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

  test(`阶段 3 · ${label} 真实网页 origin 的生命周期与回退`, async () => {
    test.skip(!REAL_SITE, '仅 REAL_SITE=1 时执行');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await context.addInitScript(SYNTHETIC_INJECTOR);
      await gotoAndAwaitMarker(page);
      await expect(page.locator('.genui-card-host')).toHaveCount(1, { timeout: 30_000 });
      await expect(page.locator('#e2e-real-block')).toHaveAttribute('data-genui-state', 'mounted');

      // 使用真实站点 origin，但以合成结构触发流式等待，不使用真实会话内容。
      await page.evaluate(() => {
        const stop = document.createElement('div');
        stop.id = 'e2e-real-stop';
        stop.setAttribute('role', 'button');
        stop.setAttribute('aria-label', '停止生成');
        document.body.append(stop);
        const message = document.createElement('div');
        message.className = 'ds-assistant-message-main-content';
        message.id = 'e2e-real-stream';
        message.innerHTML =
          '<div class="md-code-block" id="e2e-real-stream-block">' +
          '<div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>' +
          '<pre><span>{"type":"genui",</span></pre></div>';
        document.body.append(message);
      });
      await page.waitForTimeout(850);
      await expect(page.locator('#e2e-real-stream-block')).not.toHaveAttribute(
        'data-genui-state',
        'failed',
      );
      await expect(page.locator('#e2e-real-stream-block')).not.toHaveAttribute(
        'data-genui-state',
        'mounted',
      );

      await page.locator('#e2e-real-stream-block pre span').evaluate((node, value) => {
        node.textContent = value;
      }, VALID_RAW_2);
      await page.locator('#e2e-real-stop').evaluate((node) => node.remove());
      await expect(page.locator('#e2e-real-stream-block')).toHaveAttribute(
        'data-genui-state',
        'mounted',
        { timeout: 10_000 },
      );
      await expect(page.locator('.genui-card-host')).toHaveCount(2);

      const control = page.locator('[data-genui-control]');
      await expect(control).toContainText('GenUI 已开启');
      await control.locator('button').first().click();
      await expect(page.locator('.genui-card-host')).toHaveCount(0);
      await expect(page.locator('#e2e-real-block')).toBeVisible();
      await expect(page.locator('#e2e-real-stream-block')).toBeVisible();

      console.log(`[${label}] 真实站点 origin 生命周期验证（合成回复 DOM，不含真实聊天内容）`);
      expectNoExtensionErrors(buckets, label);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test(`阶段 4 · ${label} 真实 origin 的合成界面本地计算`, async () => {
    test.skip(!REAL_SITE, '仅 REAL_SITE=1 时执行；界面和数值均为合成内容');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await context.addInitScript(INTERACTIVE_SYNTHETIC_INJECTOR);
      await gotoAndAwaitMarker(page);
      const block = page.locator('#e2e-real-interactive-block');
      const host = block.locator('xpath=preceding-sibling::*[1][@data-genui-host]');
      await expect(block).toHaveAttribute('data-genui-state', 'mounted', { timeout: 30_000 });
      await expect(host).toContainText('本地预算计算');
      await expect(host.locator('.genui-value-output').nth(1)).toHaveText('60 元');

      const interactionRequests: string[] = [];
      page.on('request', (request) => interactionRequests.push(request.url()));
      await host.locator('input[type="number"]').fill('50');
      await expect(host.locator('.genui-value-output').nth(1)).toHaveText('50 元');
      await host.locator('.genui-card-reset').click();
      await expect(host.locator('.genui-value-output').nth(1)).toHaveText('60 元');
      if (!REAL_SITE) {
        // 模拟页唯一脚本即被测扩展：控件操作期间不得有任何网络请求。
        expect(interactionRequests, '控件操作期间不得产生网络请求').toEqual([]);
      } else {
        // 真实 origin（P2 复核后的归因口径）：站点自身遥测/心跳会随时出现
        // （如 gator.volces.com），且本检查无法按请求 URL 区分「内容脚本发起的
        // https 请求」与站点请求。此处 URL 红线只能证明没有 chrome-extension://
        // 起源（扩展页面上下文）的请求；「内容脚本不发起网络请求」由
        // tests/unit/extension-static.test.ts 的源码静态不变量、manifest
        // （零 host_permissions、无后台）与构建期 dist 扫描共同保证。
        const extensionRequests = interactionRequests.filter((url) =>
          /^chrome-extension:\/\//.test(url),
        );
        expect(extensionRequests, '控件操作期间不得产生扩展起源的请求').toEqual([]);
        console.log(`[${label}] 站点自身请求（记录，归因站点）：`, interactionRequests);
      }

      console.log(`[${label}] 真实 origin 交互验证只使用合成 GenUI 数据，不读取会话内容`);
      expectNoExtensionErrors(buckets, label);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test(`阶段 7 · ${label} 默认增强可见追加、说明面板与关闭恢复`, async () => {
    test.skip(REAL_SITE, '阶段 7 自动断言使用模拟页；真实网页验收见验收记录');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await gotoAndAwaitMarker(page);
      const input = page.locator('#e2e-input');
      const control = page.locator('[data-genui-control]');
      const toggle = control.locator('button').first();
      const info = control.locator('button', { hasText: '查看增强说明' });

      await expect(toggle).toHaveText('GenUI 已开启');

      // 只有用户输入后、停止输入达到延迟，才把可见说明追加到草稿末尾。
      const original = '帮我做一份月度预算';
      await input.fill(original);
      await expect(input).toHaveValue(`${original}\n\n${GENUI_PROMPT_TEXT}`, {
        timeout: 5_000,
      });
      await expect(input).toHaveValue(/〔GenUI 增强说明结束〕$/);

      // 说明面板逐字展示真正参与对话的追加文本，并说明不会自动发送。
      await info.click();
      const panel = control.locator('#genui-panel');
      await expect(panel).toBeVisible();
      expect(await panel.locator('pre').textContent()).toBe(GENUI_PROMPT_TEXT);
      await expect(panel.locator('.status')).toHaveText(/已追加到当前草稿/);
      await expect(panel).toContainText('不会自动发送消息');
      await panel.locator('button').click();
      await expect(panel).toBeHidden();

      // 关闭增强：移除自动追加的说明，草稿原文保留；不触发发送。
      await toggle.click();
      await expect(input).toHaveValue(original);
      await expect(toggle).toHaveText('GenUI 已关闭');

      // 重新开启后，现有草稿在停止输入后再次得到可见说明。
      await toggle.click();
      await expect(input).toHaveValue(`${original}\n\n${GENUI_PROMPT_TEXT}`, {
        timeout: 5_000,
      });

      const all = [...buckets.extension, ...buckets.site, ...buckets.unattributed];
      expect(all, '模拟页中出现错误（唯一脚本即被测扩展，全部归因于扩展）').toEqual([]);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test(`阶段 7b · ${label} 窄视口下说明面板不超出屏幕`, async () => {
    test.skip(REAL_SITE, '阶段 7b 自动断言使用模拟页；真实网页验收见验收记录');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      // 回归：420px 宽时宿主曾宽 462.86px、说明面板左缘 -54.86px（左侧被裁掉）。
      await page.setViewportSize({ width: 420, height: 900 });
      await gotoAndAwaitMarker(page);
      const control = page.locator('[data-genui-control]');
      const info = control.locator('button', { hasText: '查看增强说明' });
      const panel = control.locator('#genui-panel');

      await expect(panel).toBeHidden();
      await info.click();
      await expect(panel).toBeVisible();

      expectToggleInsideViewport(await readToggleBounds(page));

      await panel.locator('button').click();
      await expect(panel).toBeHidden();

      const all = [...buckets.extension, ...buckets.site, ...buckets.unattributed];
      expect(all, '模拟页中出现错误（唯一脚本即被测扩展，全部归因于扩展）').toEqual([]);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test(`阶段 7c · ${label} 拖动到屏幕下方后打开说明面板不超出屏幕`, async () => {
    test.skip(REAL_SITE, '阶段 7c 自动断言使用模拟页；真实网页验收见验收记录');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await gotoAndAwaitMarker(page);
      const control = page.locator('[data-genui-control]');
      const toggle = control.locator('button').first();
      const info = control.locator('button', { hasText: '查看增强说明' });
      const panel = control.locator('#genui-panel');
      const viewport = page.viewportSize();
      if (!viewport) throw new Error('缺少视口尺寸');
      const box = await toggle.boundingBox();
      if (!box) throw new Error('缺少浮标位置');

      // 关闭态宿主只有按钮列高，可拖到接近屏幕底部；展开面板后必须自动回夹。
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(viewport.width - 80, viewport.height - 8, { steps: 8 });
      await page.mouse.up();

      await info.click();
      await expect(panel).toBeVisible();
      expectToggleInsideViewport(await readToggleBounds(page));

      await panel.locator('button').click();
      await expect(panel).toBeHidden();

      const all = [...buckets.extension, ...buckets.site, ...buckets.unattributed];
      expect(all, '模拟页中出现错误（唯一脚本即被测扩展，全部归因于扩展）').toEqual([]);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });
}
