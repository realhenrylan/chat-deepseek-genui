import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * 阶段 1 e2e：在真实 Edge / Chrome 中加载 dist 构建目录，验证内容脚本在
 * https://chat.deepseek.com/* 上注入，并按错误来源归因后判定：
 *
 *   - 扩展（脚本 URL 为 chrome-extension://browser-extension://，或 [dsgenui] 日志前缀）→ 测试失败；
 *   - 站点（脚本 URL 为 http(s) 页面/资源地址）→ 真实网页模式仅记录，不计为扩展问题；
 *   - 无法归因（缺少脚本 URL、也无扩展日志前缀）→ 单列记录，不武断认定为网站错误。
 *
 * 结论口径（收窄）：只能表述为“未发现可归因于扩展的错误”。仅凭 [dsgenui] 前缀
 * 无法证明其余错误属于网站，来源判断的补强随阶段 2 扩展代码增多后继续完善。
 *
 * - 默认拦截导航并返回本地模拟页面，保证测试稳定、不依赖网络；模拟页无任何页面脚本
 *   与子资源，浏览器内唯一运行的脚本即被测扩展，故此模式下三类桶中的错误都判定失败；
 * - REAL_SITE=1 时不拦截，访问真实网页取证（另需网络可用）；
 * - HEADED=1 强制有头模式（无头若不支持扩展加载则用它复跑取证）。
 */

const DIST = join(process.cwd(), 'dist');
const REAL_SITE = process.env.REAL_SITE === '1';
const MARKER = 'data-genui-ext-loaded';
const EXT_PREFIX = '[dsgenui]';

const CHANNELS = [
  { label: 'Edge', channel: 'msedge' },
  { label: 'Chrome', channel: 'chrome' },
] as const;

const MOCK_HTML =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<title>GenUI 模拟页面</title></head>' +
  '<body><main><p>本地模拟页面：用于验证内容脚本注入，不访问真实站点。</p></main></body></html>';

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

for (const { label, channel } of CHANNELS) {
  test(`阶段 1 · ${label} 加载构建目录并注入内容脚本`, async () => {
    const { context, page, profileDir } = await launchWithExtension(channel);
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

    try {
      await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });

      // 内容脚本在目标域注入并写入标记；标记值应为32位扩展 id（a-p 字符集）。
      const marker = page.locator(`html[${MARKER}]`);
      await expect(marker).toHaveAttribute(MARKER, /^[a-p]{32}$/, { timeout: 30_000 });

      if (!REAL_SITE) {
        // 模拟页无页面脚本、无子资源，唯一在运行的脚本是被测扩展：
        // 任何桶中的错误都只可能由扩展引起（含扩展发起的网络请求），一律判定失败。
        const all = [...buckets.extension, ...buckets.site, ...buckets.unattributed];
        expect(all, '模拟页中出现错误（唯一脚本即被测扩展，全部归因于扩展）').toEqual([]);
      } else {
        // 真实网页：仅可归因于扩展的错误判定失败；站点来源与无法归因者记录，
        // 后者不认定为网站（来源判断待阶段 2+ 补强）。
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
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });
}
