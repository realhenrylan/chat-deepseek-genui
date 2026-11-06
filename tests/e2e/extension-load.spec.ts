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
const ISSUE16_RAW = JSON.stringify({
  type: 'genui', version: 3, title: '图表表格验收',
  state: [{ id: 'amount', label: '数值', kind: 'number', initial: 10, min: 0, max: 100, step: 1 }],
  derived: [],
  elements: [
    { kind: 'slider', bind: 'amount' },
    { kind: 'chart', chartType: 'bar', title: '柱状', items: [{ label: '当前', value: { op: 'state', id: 'amount' } }, { label: '负数', value: { op: 'const', value: -20 } }] },
    { kind: 'chart', chartType: 'pie', title: '占比', items: [{ label: '当前', value: { op: 'state', id: 'amount' } }, { label: '其他', value: { op: 'const', value: 20 } }, { label: '零', value: { op: 'const', value: 0 } }] },
    { kind: 'chart', chartType: 'line', title: '趋势', xLabel: '周期', yLabel: '金额（元）', series: [
      { label: '现值', points: [{ x: 0, y: { op: 'state', id: 'amount' } }, { x: 1, y: { op: 'const', value: 20 } }] },
      { label: '历史', color: '#c2413a', points: [{ x: 0, y: { op: 'const', value: 5 } }, { x: 1, y: { op: 'const', value: 15 } }] },
    ] },
    { kind: 'table', title: '候选比较', sortable: true, selectable: true,
      columns: [{ key: 'id', label: '候选名称' }, { key: 'value', label: '金额', numeric: true, unit: '元' }, { key: 'note', label: '说明' }, { key: 'extra', label: '完整资料' }],
      rows: [{ cells: { id: '非常长的中文名称用于检查横向滚动时固定列仍完整可读', value: { op: 'state', id: 'amount' }, note: '甲', extra: '完整资料甲' } },
        { cells: { id: '候选乙', value: 25, note: '乙', extra: '完整资料乙' } }] },
    { kind: 'table', title: '纯数值', columns: [{ key: 'x', label: 'X', numeric: true }, { key: 'y', label: 'Y', numeric: true }], rows: [{ cells: { x: 1, y: 2 } }] },
  ],
});
const RESPONSIVE_LAYOUT_RAW = JSON.stringify({
  type: 'genui',
  version: 5,
  title: '自适应与防溢出测试',
  state: [
    {
      id: 'longField',
      label: '超长中文标签'.repeat(20), // 120 字符（协议上限）
      kind: 'number',
      initial: 1000000000000,
      min: 0,
      max: 1000000000000,
      step: 1000000,
      unit: '千瓦时·每周期人次测试单位二十字', // 20 字符（协议上限）
    },
    { id: 'paramA', label: '参数 A', kind: 'number', initial: 10, min: 0, max: 100, step: 1 },
    { id: 'paramB', label: '参数 B', kind: 'number', initial: 20, min: 0, max: 100, step: 1 },
    { id: 'inputNum', label: '数字输入', kind: 'number', initial: 50, min: 0, max: 100, step: 1 },
    { id: 'col3_1', label: '三列 1', kind: 'number', initial: 1, min: 0, max: 10, step: 1 },
    { id: 'col3_2', label: '三列 2', kind: 'number', initial: 2, min: 0, max: 10, step: 1 },
    { id: 'col3_3', label: '三列 3', kind: 'number', initial: 3, min: 0, max: 10, step: 1 },
  ],
  derived: [],
  models: [
    {
      kind: 'budget',
      id: 'monthly',
      label: '月度收支',
      unit: '元',
      precision: 0,
      income: { op: 'const', value: 10000 },
      expenses: [{ label: '固定支出', amount: { op: 'const', value: 4000 } }],
    },
  ],
  elements: [
    {
      kind: 'section',
      title: '两列与嵌套两列',
      children: [
        {
          kind: 'columns',
          columns: [
            [
              {
                kind: 'columns',
                columns: [
                  [{ kind: 'slider', bind: 'paramA' }],
                  [{ kind: 'slider', bind: 'paramB' }],
                ],
              },
              { kind: 'number-input', bind: 'inputNum' },
            ],
            [
              {
                kind: 'value',
                label: '主要结果',
                source: { kind: 'model', model: 'monthly', key: 'balance' },
                unit: '元',
                emphasis: 'primary',
              },
            ],
          ],
        },
      ],
    },
    {
      kind: 'section',
      title: '三列布局',
      children: [
        {
          kind: 'columns',
          columns: [
            [{ kind: 'slider', bind: 'col3_1' }],
            [{ kind: 'slider', bind: 'col3_2' }],
            [{ kind: 'slider', bind: 'col3_3' }],
          ],
        },
      ],
    },
    {
      kind: 'section',
      title: '超长内容与宽表',
      children: [
        { kind: 'slider', bind: 'longField' },
        {
          kind: 'table',
          title: '方案对比表',
          sortable: true,
          columns: [
            { key: 'name', label: '方案名称' },
            { key: 'cost', label: '预计成本', numeric: true },
            { key: 'score', label: '综合评分', numeric: true },
          ],
          rows: [
            { cells: { name: '方案 A', cost: 1200, score: 85 } },
            { cells: { name: '方案 B', cost: 800, score: 92 } },
            { cells: { name: '方案 C', cost: 1500, score: 78 } },
            { cells: { name: '方案 D', cost: 950, score: 88 } },
          ],
        },
        {
          kind: 'chart',
          chartType: 'bar',
          title: '收支对比',
          legend: true,
          source: { model: 'monthly' },
        },
        {
          kind: 'explain',
          model: 'monthly',
          title: '计算依据与诊断',
        },
      ],
    },
  ],
});
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
// 阶段 4 补充：长标签、20 字符单位、触屏目标与键盘/AX 检查共用一份文档。
const LONG_UNIT = '这是一个正好二十个字符的超长计量单位名称';
const CONTROL_A11Y_RAW = JSON.stringify({
  type: 'genui',
  version: 2,
  title: '控件可达性',
  state: [
    { id: 'budget', label: '每月家庭固定生活支出预算合计', kind: 'number', initial: 100, min: 0, max: 200, step: 10, unit: '元' },
    { id: 'spent', label: '已支出', kind: 'number', initial: 40, min: 0, max: 100, step: 10, unit: LONG_UNIT },
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
// 阶段 6 的候选表：筛选、排序与选中项都需要进入继续讨论摘要。
const TABLE_RAW = JSON.stringify({
  type: 'genui',
  version: 3,
  title: '选购比较',
  state: [
    { id: 'budget', label: '预算', kind: 'number', initial: 6000, min: 0, max: 20000, step: 100, unit: '元' },
  ],
  derived: [],
  elements: [
    {
      kind: 'table',
      title: '候选方案',
      sortable: true,
      selectable: true,
      columns: [
        { key: 'name', label: '方案' },
        { key: 'price', label: '价格', numeric: true, unit: '元' },
        { key: 'weight', label: '重量', numeric: true, unit: 'kg' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        { cells: { name: 'A', price: 4800, weight: 1.4, status: '在售' } },
        { cells: { name: 'C', price: 5200, weight: 1.3, status: '在售' } },
      ],
    },
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

interface LaunchOptions {
  viewport?: { width: number; height: number };
  hasTouch?: boolean;
}

async function launchWithExtension(
  channel: string,
  options: LaunchOptions = {},
): Promise<Launched> {
  if (!existsSync(join(DIST, 'manifest.json'))) {
    throw new Error(`缺少 ${join(DIST, 'manifest.json')}，请先运行 npm run build`);
  }
  const profileDir = mkdtempSync(join(tmpdir(), `dsgenui-${channel}-`));
  const context = await chromium.launchPersistentContext(profileDir, {
    channel,
    headless: process.env.HEADED !== '1',
    viewport: options.viewport,
    hasTouch: options.hasTouch,
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

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Chromium 的 color-mix 计算值可能是 color(srgb …)，两种写法都解析。 */
function parseCssColor(value: string): RgbaColor {
  const rgb = value.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const parts = rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }
  const srgb = value.match(/color\(srgb ([^)]+)\)/);
  if (srgb) {
    const parts = srgb[1].split(/[ /]+/).filter(Boolean).map(Number);
    return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: parts[3] ?? 1 };
  }
  const oklab = value.match(/oklab\(([^)]+)\)/);
  if (oklab) {
    const parts = oklab[1].split(/[ /]+/).filter(Boolean).map(Number);
    const [lightness, aAxis, bAxis] = parts;
    const l = (lightness + 0.3963377774 * aAxis + 0.2158037573 * bAxis) ** 3;
    const m = (lightness - 0.1055613458 * aAxis - 0.0638541728 * bAxis) ** 3;
    const s = (lightness - 0.0894841775 * aAxis - 1.291485548 * bAxis) ** 3;
    const linear = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    const encode = (channel: number) => {
      const clamped = Math.min(1, Math.max(0, channel));
      return clamped <= 0.0031308
        ? clamped * 12.92
        : 1.055 * clamped ** (1 / 2.4) - 0.055;
    };
    return {
      r: encode(linear[0]) * 255,
      g: encode(linear[1]) * 255,
      b: encode(linear[2]) * 255,
      a: parts[3] ?? 1,
    };
  }
  throw new Error(`无法解析颜色：${value}`);
}

function compositeOver(fg: RgbaColor, bg: RgbaColor): RgbaColor {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function relativeLuminance(color: RgbaColor): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(fg: RgbaColor, bg: RgbaColor): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
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
  test(`Issue 16 · ${label} 图表与比较表主题、宽度及状态`, async () => {
    test.skip(REAL_SITE, '使用本地模拟页');
    const { context, page, profileDir } = await launchWithExtension(channel);
    try {
      await context.addInitScript((raw) => {
        const insert = () => {
          const message = document.createElement('div');
          message.id = 'issue16-message';
          message.className = 'ds-assistant-message-main-content';
          message.setAttribute('data-virtual-list-item-key', 'issue16');
          const block = document.createElement('div');
          block.className = 'md-code-block md-code-block-light';
          block.innerHTML = '<div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>';
          const pre = document.createElement('pre');
          const span = document.createElement('span');
          span.textContent = raw;
          pre.append(span); block.append(pre); message.append(block); document.body.append(message);
        };
        if (document.body) insert();
        else new MutationObserver((_, observer) => { if (document.body) { observer.disconnect(); insert(); } }).observe(document, { childList: true, subtree: true });
      }, ISSUE16_RAW);
      await gotoAndAwaitMarker(page);
      const card = page.locator('#issue16-message .genui-card-host');
      await expect(card).toHaveCount(1);
      const tables = card.locator('.genui-table');
      await expect(tables).toHaveCount(2);
      await expect(tables.nth(1).locator('.genui-table-identifier')).toHaveCount(0);
      await expect(card.locator('.genui-line-path')).toHaveCount(2);
      await expect(card.locator('.genui-line-path').nth(1)).toHaveAttribute('stroke', '#c2413a');
      await expect(card.locator('.genui-line-path').nth(1)).toHaveAttribute('stroke-dasharray', '8 4');
      await card.locator('.genui-chart-data summary').nth(2).click();
      await expect(card.locator('.genui-chart-data table').nth(2)).toContainText('10');
      await card.locator('input[type="range"]').focus();
      await card.locator('input[type="range"]').press('ArrowRight');
      await expect(card.locator('.genui-chart-data table').nth(2)).toContainText('11');
      await expect(card.locator('.genui-bar-value').first()).toHaveText('11');
      await expect(tables.first()).toContainText('11 元');
      await card.locator('.genui-table-filter input').fill('候选');
      await tables.first().getByRole('button', { name: /金额/ }).click();
      await card.locator('.genui-table-select-input').first().check();
      for (const width of [360, 560, 720]) {
        for (const theme of ['light', 'dark']) {
          const metrics = await page.evaluate(({ width, theme }) => {
            const message = document.querySelector<HTMLElement>('#issue16-message')!;
            message.style.width = `${width}px`;
            const shadow = message.querySelector<HTMLElement>('.genui-card-host')!.shadowRoot!;
            shadow.querySelector('.genui-card-root')!.setAttribute('data-site-theme', theme);
            const card = shadow.querySelector<HTMLElement>('.genui-card')!;
            const scroll = shadow.querySelector<HTMLElement>('.genui-table-scroll')!;
            const sticky = scroll.querySelector<HTMLElement>('tbody .genui-table-identifier')!;
            scroll.scrollLeft = scroll.scrollWidth;
            return { overflow: card.scrollWidth > card.clientWidth + 1, stickyWidth: sticky.getBoundingClientRect().width, viewport: scroll.clientWidth, scrollLeft: scroll.scrollLeft, left: sticky.getBoundingClientRect().left - scroll.getBoundingClientRect().left, position: getComputedStyle(sticky).position, background: getComputedStyle(sticky).backgroundColor, line: getComputedStyle(shadow.querySelector('.genui-line-path')!).stroke, bar: getComputedStyle(shadow.querySelector('.genui-bar-fill')!).backgroundColor, pie: getComputedStyle(shadow.querySelector('.genui-pie-chart path')!).fill };
          }, { width, theme });
          expect(metrics.overflow).toBe(false);
          expect(metrics.position).toBe('sticky');
          if (width === 360) expect(metrics.scrollLeft).toBeGreaterThan(0);
          if (metrics.scrollLeft > 0) expect(metrics.left).toBeLessThan(3);
          expect(metrics.stickyWidth).toBeLessThan(metrics.viewport * 0.5);
          expect(metrics.background).not.toBe('rgba(0, 0, 0, 0)');
          expect(metrics.line).toBe(theme === 'light' ? 'rgb(77, 107, 254)' : 'rgb(124, 154, 255)');
          expect(metrics.bar).toBe(metrics.line);
          expect(metrics.pie).toBe(metrics.line);
          await expect(card.locator('.genui-table-filter input')).toHaveValue('候选');
          await expect(card.locator('.genui-table-select-input:checked')).toHaveCount(1);
          await expect(tables.first().locator('th[aria-sort="ascending"]')).toHaveCount(1);
        }
      }
      await page.evaluate(() => {
        document.body.style.zoom = '2';
        document.querySelector<HTMLElement>('#issue16-message')!.style.width = '360px';
      });
      await expect(tables.first().locator('th')).toHaveCount(5);
      await expect(tables.first()).toContainText('完整资料乙');
      await expect(card.locator('.genui-table-filter input')).toHaveValue('候选');
      const scroll = card.locator('.genui-table-scroll').first();
      await scroll.evaluate((element) => { element.scrollLeft = 0; });
      await scroll.focus();
      await scroll.press('ArrowRight');
      await expect(scroll).toBeFocused();
      await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });
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

      // 原始 JSON 入口收在默认收起的「界面详情」里：先展开详情，再切换原块与文案。
      const disclosure = hosts.nth(0).locator('summary.genui-card-details-summary');
      const detailsPanel = hosts.nth(0).locator('details.genui-card-details');
      await expect(disclosure).toHaveText('界面详情');
      await expect(detailsPanel).not.toHaveAttribute('open', '');
      await expect(hosts.nth(0).locator('button.genui-card-toggle')).toBeHidden();
      await disclosure.click();
      await expect(detailsPanel).toHaveAttribute('open', '');

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

      // 查看原文前先展开「界面详情」，代码块原有复制控件仍可收到事件并复制原始文本。
      await page
        .locator('.genui-card-host')
        .first()
        .locator('summary.genui-card-details-summary')
        .click();
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

  test(`阶段 4 补充 · ${label} 键盘、无障碍树、触屏目标与长单位`, async () => {
    test.skip(REAL_SITE, '阶段 4 补充用例使用本地合成页面；不依赖真实会话内容');
    const { context, page, profileDir } = await launchWithExtension(channel, {
      viewport: { width: 390, height: 900 },
      hasTouch: true,
    });
    const buckets = watchErrors(page);

    try {
      await gotoAndAwaitMarker(page);
      await page.evaluate((raw) => {
        const message = document.createElement('div');
        message.className = 'ds-assistant-message-main-content';
        message.id = 'e2e-control-a11y-message';
        const block = document.createElement('div');
        block.className = 'md-code-block md-code-block-light';
        block.id = 'e2e-control-a11y';
        block.innerHTML = '<div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>';
        const pre = document.createElement('pre');
        const content = document.createElement('span');
        content.textContent = raw;
        pre.append(content);
        block.append(pre);
        message.append(block);
        document.body.append(message);
      }, CONTROL_A11Y_RAW);

      const host = page.locator('.genui-card-host').last();
      await expect(host).toContainText('控件可达性');
      await page.setViewportSize({ width: 360, height: 900 });

      const slider = host.locator('input[type="range"]');
      const numberInput = host.locator('input[type="number"]');
      const select = host.locator('select');

      // 键盘焦点可见，range 的步进与 PageUp/PageDown/Home/End 语义保持原生行为。
      await slider.focus();
      expect(await slider.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
      expect(await slider.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('2px');
      await slider.press('ArrowRight');
      await expect(host.locator('.genui-control-current')).toHaveText('110 元');
      await slider.press('PageUp');
      await expect(host.locator('.genui-control-current')).toHaveText('130 元');
      await slider.press('PageDown');
      await expect(host.locator('.genui-control-current')).toHaveText('110 元');
      await slider.press('End');
      await expect(host.locator('.genui-control-current')).toHaveText('200 元');
      await slider.press('Home');
      await expect(host.locator('.genui-control-current')).toHaveText('0 元');
      expect(
        await slider.evaluate(
          (element) => (element.getRootNode() as ShadowRoot).activeElement === element,
        ),
      ).toBe(true);

      await numberInput.focus();
      await numberInput.press('ArrowUp');
      await expect(numberInput).toHaveValue('50');
      await expect(host.locator('.genui-input-error')).toHaveCount(0);

      await select.focus();
      await select.press('ArrowDown');
      await expect(select).toHaveValue('transport');

      const readColors = () =>
        host.evaluate((element) => {
          const shadow = element.shadowRoot as ShadowRoot;
          const card = shadow.querySelector('.genui-card')!;
          const input = shadow.querySelector('input[type="number"]')!;
          const slider = shadow.querySelector('input[type="range"]')!;
          const error = shadow.querySelector('.genui-input-error');
          const style = (node: Element) => getComputedStyle(node);
          return {
            page: style(document.body).backgroundColor,
            card: style(card).backgroundColor,
            border: style(input).borderColor,
            inputBg: style(input).backgroundColor,
            accent: style(slider).accentColor,
            error: error ? style(error).color : null,
          };
        });
      const ratios = (raw: Awaited<ReturnType<typeof readColors>>) => {
        const pageRaw = parseCssColor(raw.page);
        // 模拟页未声明背景时浏览器按白色画布合成。
        const page =
          pageRaw.a === 0 ? { r: 255, g: 255, b: 255, a: 1 } : compositeOver(pageRaw, { r: 255, g: 255, b: 255, a: 1 });
        const card = compositeOver(parseCssColor(raw.card), page);
        return {
          border: contrastRatio(compositeOver(parseCssColor(raw.border), card), card),
          focus: contrastRatio(compositeOver(parseCssColor(raw.accent), card), card),
          background: contrastRatio(compositeOver(parseCssColor(raw.inputBg), card), card),
          error: raw.error
            ? contrastRatio(compositeOver(parseCssColor(raw.error), card), card)
            : null,
        };
      };

      const lightNormal = ratios(await readColors());
      expect(lightNormal.border).toBeGreaterThanOrEqual(3);
      expect(lightNormal.focus).toBeGreaterThanOrEqual(3);

      await numberInput.fill('');
      await expect(host.locator('.genui-input-error')).toContainText('请输入有限数字');
      const lightInvalid = ratios(await readColors());
      expect(lightInvalid.border).toBeGreaterThanOrEqual(3);
      expect(lightInvalid.error).toBeGreaterThanOrEqual(4.5);

      await host.locator('.genui-card-reset').click();
      await page.evaluate(() => {
        document.body.classList.add('dark');
        document.body.style.background = '#1b1d22';
      });
      await expect(host.locator('.genui-card-root')).toHaveAttribute('data-site-theme', 'dark');
      await page.waitForTimeout(250);
      const darkNormal = ratios(await readColors());
      expect(darkNormal.border).toBeGreaterThanOrEqual(3);
      expect(darkNormal.focus).toBeGreaterThanOrEqual(3);

      await numberInput.fill('');
      await expect(host.locator('.genui-input-error')).toContainText('请输入有限数字');
      const darkInvalid = ratios(await readColors());
      expect(darkInvalid.border).toBeGreaterThanOrEqual(3);
      expect(darkInvalid.error).toBeGreaterThanOrEqual(4.5);

      // 原生 range 在 Chromium 中会忽略带单位的 aria-valuetext，单位必须出现在
      // 可访问性树的 description 中，而不是只依赖可见 output。
      const cdp = await context.newCDPSession(page);
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      const sliderNode = nodes.find(
        (node) =>
          node.role?.value === 'slider' &&
          node.name?.value === '每月家庭固定生活支出预算合计',
      );
      expect(sliderNode?.description?.value).toContain('单位：元');
      const numberNode = nodes.find(
        (node) => node.role?.value === 'spinbutton' && node.name?.value === '已支出',
      );
      expect(numberNode?.description?.value).toContain(LONG_UNIT);

      const metrics = await host.evaluate((element) => {
        const shadow = element.shadowRoot as ShadowRoot;
        const input = shadow.querySelector('input[type="number"]')!;
        const unit = shadow.querySelector('.genui-number-unit')!;
        const card = shadow.querySelector('.genui-card')!;
        const inputRect = input.getBoundingClientRect();
        const unitRect = unit.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        return {
          coarse: matchMedia('(pointer: coarse)').matches,
          inputHeight: inputRect.height,
          selectHeight: shadow.querySelector('select')!.getBoundingClientRect().height,
          sliderHeight: shadow.querySelector('input[type="range"]')!.getBoundingClientRect().height,
          inputWidth: inputRect.width,
          unitBelow: unitRect.top >= inputRect.bottom - 1,
          unitRight: unitRect.right,
          cardRight: cardRect.right,
          overflow: card.scrollWidth > card.clientWidth + 1,
        };
      });
      expect(metrics.coarse).toBe(true);
      expect(metrics.inputHeight).toBeGreaterThanOrEqual(44);
      expect(metrics.selectHeight).toBeGreaterThanOrEqual(44);
      expect(metrics.sliderHeight).toBeGreaterThanOrEqual(44);
      expect(metrics.inputWidth).toBeGreaterThanOrEqual(80);
      expect(metrics.unitBelow).toBe(true);
      expect(metrics.unitRight).toBeLessThanOrEqual(metrics.cardRight + 1);
      expect(metrics.overflow).toBe(false);

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
        (raws: { interactive: string; table: string; static: string }) => {
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
          makeBlock(raws.table);
          makeBlock(raws.static);
          document.body.append(container);
        },
        { interactive: INTERACTIVE_RAW, table: TABLE_RAW, static: VALID_RAW_2 },
      );

      const message = page.locator('#e2e-stage6');
      const hosts = message.locator('.genui-card-host');
      await expect(hosts).toHaveCount(3);
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
      // 页脚整体 display:none：详情里的原始 JSON 入口不在可见层，也不会进入 Tab 顺序。
      await expect(card.locator('button.genui-card-toggle')).toBeHidden();
      await expand.focus();
      await page.keyboard.press('Tab');
      await expect(expand).not.toBeFocused();

      await expand.click();
      await expect(expand).toHaveText('收起界面');
      await expect(card.locator('.genui-card-body')).toBeVisible();
      // 展开恢复后现场仍在：用户改过的滑块值与派生输出保留（不重渲染、不重置）。
      await expect(slider).toHaveValue('0');
      await expect(card.locator('.genui-value-output').nth(1)).toHaveText('-40 元');

      // —— 页脚层级：「继续讨论」直接可见，原始 JSON 与说明收进默认收起的「界面详情」。
      await expect(card.locator('.genui-card-actions')).toBeVisible();
      await expect(card.locator('button.genui-card-followup')).toBeVisible();
      await expect(card.locator('details.genui-card-details')).not.toHaveAttribute('open', '');
      await expect(card.locator('button.genui-card-toggle')).toBeHidden();
      // 真实键盘路径：聚焦 summary 按 Enter 展开，再按 Tab 进入原始 JSON 入口。
      const disclosure = card.locator('summary.genui-card-details-summary');
      await disclosure.focus();
      await page.keyboard.press('Enter');
      await expect(card.locator('details.genui-card-details')).toHaveAttribute('open', '');
      await expect(card.locator('button.genui-card-toggle')).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(card.locator('button.genui-card-toggle')).toBeFocused();
      // 空格收起、再按空格展开（原生 details 语义），焦点始终留在 summary 上。
      await disclosure.focus();
      await page.keyboard.press('Space');
      await expect(card.locator('details.genui-card-details')).not.toHaveAttribute('open', '');
      await page.keyboard.press('Space');
      await expect(card.locator('details.genui-card-details')).toHaveAttribute('open', '');
      // —— 表格筛选与选中：业务状态进入继续讨论摘要（issue #5 的真实流程）。
      const input = page.locator('#e2e-input');
      await expect(input).toHaveValue('');
      const tableCard = hosts.nth(1);
      await expect(tableCard).toContainText('选购比较');
      await tableCard.locator('.genui-table-filter input').fill('在售');
      await expect(tableCard.locator('.genui-table-count')).toHaveText('显示 2 / 2 行');
      const radios = tableCard.locator('input[type="radio"]');
      await expect(radios).toHaveCount(2);
      await radios.nth(1).check();
      await expect(tableCard.locator('.genui-table-selection')).toContainText('已选候选项：C');

      await tableCard.locator('button.genui-card-followup').click();
      const tablePreview = tableCard.locator('textarea.genui-followup-text');
      await expect(tablePreview).toHaveValue(/继续讨论「选购比较」/);
      await expect(tablePreview).toHaveValue(/筛选「在售」/);
      await expect(tablePreview).toHaveValue(/显示 2 \/ 2 行/);
      await expect(tablePreview).toHaveValue(/- 已选：C — 价格 5200 元；重量 1.3 kg/);
      await expect(tablePreview).toHaveValue(/- 对比：A — 价格 4800 元；重量 1.4 kg/);
      await expect(input).toHaveValue('');
      await tableCard.locator('button.genui-followup-apply').click();
      await expect(input).toHaveValue(/继续讨论「选购比较」/);
      await expect(input).toHaveValue(/已选：C/);
      await input.fill('');

      // —— 继续讨论：先预览冻结的快照，用户确认后才写入输入框，不自动发送。
      await card.locator('button.genui-card-followup').click();
      const preview = card.locator('section.genui-followup');
      const previewText = card.locator('textarea.genui-followup-text');
      await expect(preview).toBeVisible();
      await expect(input).toHaveValue('');
      await expect(previewText).toHaveValue(/继续讨论「本地预算计算」/);
      await expect(previewText).toHaveValue(/总预算：0 元/);
      await expect(previewText).toHaveValue(/请解释以上当前结果的含义/);
      await expect(card.locator('button.genui-card-followup')).toHaveAttribute('aria-expanded', 'true');
      // 键盘打开时焦点直接进入摘要；下一次 Tab 落到「填入输入框」，而不是紧随触发的「重置」。
      await expect(previewText).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(card.locator('button.genui-followup-apply')).toBeFocused();
      await expect(card.locator('button.genui-card-reset')).not.toBeFocused();

      // 重复点击只聚焦预览，不覆盖用户已编辑的摘要。
      await previewText.fill('请解释一下当前结果。');
      await card.locator('button.genui-card-followup').click();
      await expect(previewText).toHaveValue('请解释一下当前结果。');

      // 用户手动填写的草稿逐字保留；确认后才追加，发送仍由用户完成。
      await input.fill('用户手动草稿');
      await card.locator('button.genui-followup-apply').click();
      await expect(input).toHaveValue('用户手动草稿\n\n请解释一下当前结果。');
      await expect(card.locator('.genui-card-followup-feedback')).toContainText('草稿已保留');
      await expect(preview).toBeHidden();
      const withDraft = await input.inputValue();

      // 同样的摘要再次确认时不重复追加（去重）。
      await card.locator('button.genui-card-followup').click();
      await card.locator('textarea.genui-followup-text').fill('请解释一下当前结果。');
      await card.locator('button.genui-followup-apply').click();
      await expect(input).toHaveValue(withDraft);

      // v1 静态卡片没有「继续讨论」入口。
      await expect(hosts.nth(2).locator('button.genui-card-followup')).toHaveCount(0);
      // 输入框仍在、没有被清空，也没有发送动作可触发发送。
      await expect(input).not.toHaveValue('');

      const all = [...buckets.extension, ...buckets.site, ...buckets.unattributed];
      expect(all, '模拟页中出现错误（唯一脚本即被测扩展，全部归因于扩展）').toEqual([]);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test(`阶段 3 · ${label} 流式期间保留历史卡片，消息重写和替换可清理`, async () => {
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
      // 流式回答本身等待稳定，但未变化的历史卡片保持挂载，不再全局卸载。
      await expect(page.locator('.genui-card-host')).toHaveCount(2);
      await expect(page.locator('#e2e-stream-message .genui-card-host')).toHaveCount(0);

      await page.locator('#e2e-stream-block pre span').evaluate((node, value) => {
        node.textContent = value;
      }, VALID_RAW_2);
      await page.waitForTimeout(850);
      await expect(page.locator('#e2e-stream-block')).not.toHaveAttribute('data-genui-state', 'mounted');
      await expect(page.locator('.genui-card-host')).toHaveCount(2);

      await page.locator('#e2e-stop').evaluate((node) => node.remove());
      await expect(page.locator('#e2e-stream-block')).toHaveAttribute('data-genui-state', 'mounted');
      await expect(page.locator('.genui-card-host')).toHaveCount(3);

      // 重新生成当前回复并沿用同一节点时先卸载该卡片；历史回答保持挂载。
      await page.evaluate(() => {
        const stop = document.createElement('div');
        stop.id = 'e2e-stop-regen';
        stop.setAttribute('role', 'button');
        stop.setAttribute('aria-label', '停止生成');
        document.body.append(stop);
        const block = document.querySelector('#e2e-stream-block pre span');
        if (block) block.textContent = '{"type":"genui",';
      });
      await expect(page.locator('.genui-card-host')).toHaveCount(2);
      await expect(page.locator('#e2e-stream-block')).toBeVisible();
      await expect(page.locator('#e2e-stream-block')).not.toHaveAttribute('data-genui-state', 'mounted');
      await page.locator('#e2e-stream-block pre span').evaluate((node, value) => {
        node.textContent = value;
      }, VALID_RAW_2);
      await page.locator('#e2e-stop-regen').evaluate((node) => node.remove());
      await expect(page.locator('#e2e-stream-block')).toHaveAttribute('data-genui-state', 'mounted');
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

  test(`阶段 14 · ${label} 主动保存后刷新恢复与清除（模拟页）`, async () => {
    test.skip(REAL_SITE, '保存与刷新恢复使用本地模拟页面；真实网页需人工验收');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      // 每次导航都注入同一张可交互卡片，模拟刷新后同一条回复重新出现。
      await context.addInitScript((raw) => {
        const insert = () => {
          if (!document.body || document.getElementById('e2e-saved-interactive')) return;
          const message = document.createElement('div');
          message.className = 'ds-assistant-message-main-content';
          message.id = 'e2e-saved-message';
          message.setAttribute('data-virtual-list-item-key', 'e2e-saved-msg-1');
          const block = document.createElement('div');
          block.className = 'md-code-block md-code-block-light';
          block.id = 'e2e-saved-interactive';
          block.innerHTML =
            '<div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>';
          const pre = document.createElement('pre');
          const content = document.createElement('span');
          content.textContent = raw;
          pre.append(content);
          block.append(pre);
          message.append(block);
          document.body.append(message);
        };
        if (document.body) {
          insert();
          return;
        }
        const observer = new MutationObserver(() => {
          if (!document.body) return;
          observer.disconnect();
          insert();
        });
        observer.observe(document, { childList: true, subtree: true });
      }, INTERACTIVE_RAW);

      await gotoAndAwaitMarker(page);
      const card = page.locator('.genui-card-host').filter({ hasText: '本地预算计算' });
      await expect(card).toHaveCount(1);
      const slider = card.locator('input[type="range"]');
      await slider.focus();
      await slider.press('ArrowRight');
      await expect(card.locator('.genui-control-current')).toHaveText('110 元');

      await card.locator('.genui-card-save').click();
      await expect(card.locator('.genui-card-save-feedback')).toContainText(
        '已保存到本机，刷新后可恢复',
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(`html[${MARKER}]`)).toHaveAttribute(MARKER, /^[a-p]{32}$/, {
        timeout: 30_000,
      });

      const restored = page.locator('.genui-card-host').filter({ hasText: '本地预算计算' });
      await expect(restored).toHaveCount(1);
      await expect(restored.locator('.genui-card-restored')).toContainText('已恢复');
      await expect(restored.locator('input[type="range"]')).toHaveValue('110');
      await expect(restored.locator('.genui-control-current')).toHaveText('110 元');

      await restored.locator('.genui-card-clear-saved').click();
      await expect(restored.locator('.genui-card-save-feedback')).toContainText(
        '已清除本机保存的设置',
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(`html[${MARKER}]`)).toHaveAttribute(MARKER, /^[a-p]{32}$/, {
        timeout: 30_000,
      });
      const reset = page.locator('.genui-card-host').filter({ hasText: '本地预算计算' });
      await expect(reset).toHaveCount(1);
      await expect(reset.locator('input[type="range"]')).toHaveValue('100');
      await expect(reset.locator('.genui-card-restored')).toHaveCount(0);

      const all = [...buckets.extension, ...buckets.site, ...buckets.unattributed];
      expect(all, '模拟页中出现错误（唯一脚本即被测扩展，全部归因于扩展）').toEqual([]);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });
  test(`阶段 15 · ${label} 卡片分组与局部容器自适应布局（360/560/720/960px、防水平溢出、键盘焦点与宽窄切换状态保持）`, async () => {
    test.skip(REAL_SITE, '自适应与防溢出测试使用本地模拟页面；真实网页需人工验收');
    const { context, page, profileDir } = await launchWithExtension(channel);
    const buckets = watchErrors(page);

    try {
      await context.addInitScript((raw) => {
        const insert = () => {
          if (!document.body || document.getElementById('e2e-layout-message')) return;
          const message = document.createElement('div');
          message.className = 'ds-assistant-message-main-content';
          message.id = 'e2e-layout-message';
          message.setAttribute('data-virtual-list-item-key', 'e2e-layout-msg-1');
          const block = document.createElement('div');
          block.className = 'md-code-block md-code-block-light';
          block.id = 'e2e-layout-block';
          block.innerHTML =
            '<div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>';
          const pre = document.createElement('pre');
          const content = document.createElement('span');
          content.textContent = raw;
          pre.append(content);
          block.append(pre);
          message.append(block);
          document.body.append(message);
        };
        if (document.body) {
          insert();
          return;
        }
        const observer = new MutationObserver(() => {
          if (!document.body) return;
          observer.disconnect();
          insert();
        });
        observer.observe(document, { childList: true, subtree: true });
      }, RESPONSIVE_LAYOUT_RAW);

      await gotoAndAwaitMarker(page);
      const card = page.locator('.genui-card-host').filter({ hasText: '自适应与防溢出测试' });
      await expect(card).toHaveCount(1);

      const evaluateLayout = async (widthPx: number, theme: 'light' | 'dark' = 'light') => {
        return await page.evaluate(
          ({ w, th }) => {
            const container = document.getElementById('e2e-layout-message');
            if (!container) throw new Error('e2e-layout-message not found');
            container.style.width = `${w}px`;
            container.style.boxSizing = 'border-box';

            const host = document.querySelector('#e2e-layout-message .genui-card-host');
            if (!host || !host.shadowRoot) throw new Error('card host or shadowRoot not found');
            const shadow = host.shadowRoot;
            const root = shadow.querySelector('.genui-card-root');
            if (!root) throw new Error('card-root not found');

            root.setAttribute('data-site-theme', th);

            const cardEl = shadow.querySelector('.genui-card') as HTMLElement;
            const outer2Col = shadow.querySelector(
              '.genui-section:nth-of-type(1) > .genui-section-body > .genui-columns-container > .genui-columns',
            ) as HTMLElement;
            const nested2Col = outer2Col?.querySelector(
              '.genui-column:nth-child(1) .genui-columns-container > .genui-columns',
            ) as HTMLElement;
            const col3 = shadow.querySelector(
              '.genui-columns[data-columns="3"]',
            ) as HTMLElement;

            const parseColCount = (el: HTMLElement | null) => {
              if (!el) return 0;
              const template = window.getComputedStyle(el).gridTemplateColumns.trim();
              if (!template) return 0;
              return template.split(/\s+/).length;
            };

            const isCardOverflowing = cardEl.scrollWidth > cardEl.clientWidth + 1;

            return {
              outer2ColCount: parseColCount(outer2Col),
              nested2ColCount: parseColCount(nested2Col),
              col3Count: parseColCount(col3),
              isCardOverflowing,
            };
          },
          { w: widthPx, th: theme },
        );
      };

      // 1. 360px（等效 200% 缩放窄栏回流）：全部为单列，卡片无水平溢出
      const at360 = await evaluateLayout(360, 'light');
      expect(at360.outer2ColCount).toBe(1);
      expect(at360.col3Count).toBe(1);
      expect(at360.isCardOverflowing).toBe(false);

      // 2. 560px：仍处于 < 38rem（608px）区间，保持单列，无溢出
      const at560 = await evaluateLayout(560, 'light');
      expect(at560.outer2ColCount).toBe(1);
      expect(at560.col3Count).toBe(1);
      expect(at560.isCardOverflowing).toBe(false);

      // 3. 720px：局部容器 >= 38rem（608px）且 < 58rem（928px）
      // 外层 2 列恢复双列并列；嵌套在左列内部的二级 columns 局部宽度约 330px < 38rem，保持单列
      const at720 = await evaluateLayout(720, 'light');
      expect(at720.outer2ColCount).toBe(2);
      expect(at720.nested2ColCount).toBe(1);
      expect(at720.isCardOverflowing).toBe(false);

      // 4. 960px：局部容器 >= 58rem（928px）
      // 外层 2 列并列，三列布局恢复 3 列并列
      const at960 = await evaluateLayout(960, 'light');
      expect(at960.outer2ColCount).toBe(2);
      expect(at960.col3Count).toBe(3);
      expect(at960.isCardOverflowing).toBe(false);

      // 5. 暗色主题在 360px 与 960px 验证
      const at360Dark = await evaluateLayout(360, 'dark');
      expect(at360Dark.outer2ColCount).toBe(1);
      expect(at360Dark.isCardOverflowing).toBe(false);

      const at960Dark = await evaluateLayout(960, 'dark');
      expect(at960Dark.col3Count).toBe(3);
      expect(at960Dark.isCardOverflowing).toBe(false);

      // 6. 窄栏极端滑块布局与键盘操作（360px 下长数值 1e12 + 20 字符单位 + 120 字符标签）
      await evaluateLayout(360, 'light');
      const sliderMetrics = await page.evaluate(() => {
        const host = document.querySelector('#e2e-layout-message .genui-card-host');
        const shadow = host?.shadowRoot;
        const slider = shadow?.querySelector('input[type="range"][max="1000000000000"]') as HTMLInputElement;
        const row = slider?.closest('.genui-slider-row') as HTMLElement;
        const output = row?.querySelector('.genui-control-current') as HTMLElement;
        const cardEl = shadow?.querySelector('.genui-card') as HTMLElement;
        const rect = slider?.getBoundingClientRect();
        return {
          sliderWidth: rect?.width ?? 0,
          computedWidth: window.getComputedStyle(slider).width,
          offsetWidth: slider?.offsetWidth,
          rect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
          currentText: output?.textContent ?? '',
          sliderValue: slider?.value ?? '',
          isCardOverflowing: cardEl.scrollWidth > cardEl.clientWidth + 1,
          sliderFound: !!slider,
          sliderCount: shadow?.querySelectorAll("input[type=\"range\"]").length ?? 0,
          allInputs: Array.from(shadow?.querySelectorAll("input") ?? []).map(i => ({ type: i.type, max: i.max, id: i.id })),
        };
      });
      // 断言滑块具有合理的可见宽度（>= 120px，换行后独占一行展开至完整容器可用宽），且输出包含长单位
      expect(sliderMetrics.sliderWidth).toBeGreaterThanOrEqual(120);
      expect(sliderMetrics.currentText).toContain('1000000000000');
      expect(sliderMetrics.currentText).toContain('千瓦时·每周期人次测试单位二十字');
      expect(sliderMetrics.isCardOverflowing).toBe(false);

      // 在真实浏览器中操作极端滑块：聚焦并按向左键调整
      await page.evaluate(() => {
        const host = document.querySelector('#e2e-layout-message .genui-card-host');
        const slider = host?.shadowRoot?.querySelector('input[type="range"][max="1000000000000"]') as HTMLInputElement;
        slider.focus();
      });
      await page.keyboard.press('ArrowLeft');
      const sliderAfterKey = await page.evaluate(() => {
        const host = document.querySelector('#e2e-layout-message .genui-card-host');
        const shadow = host?.shadowRoot;
        const slider = shadow?.querySelector('input[type="range"][max="1000000000000"]') as HTMLInputElement;
        const row = slider?.closest('.genui-slider-row') as HTMLElement;
        const output = row?.querySelector('.genui-control-current') as HTMLElement;
        const cardEl = shadow?.querySelector('.genui-card') as HTMLElement;
        return {
          sliderValue: slider?.value ?? '',
          currentText: output?.textContent ?? '',
          isCardOverflowing: cardEl.scrollWidth > cardEl.clientWidth + 1,
        };
      });
      expect(sliderAfterKey.sliderValue).toBe('999999000000');
      expect(sliderAfterKey.currentText).toContain('999999000000');
      expect(sliderAfterKey.isCardOverflowing).toBe(false);

      // 7. 真实浏览器 Tab 键顺序验证：聚焦首个输入控件后连续按 Tab，验证焦点在 Shadow DOM 内顺次前行
      await page.evaluate(() => {
        const host = document.querySelector('#e2e-layout-message .genui-card-host');
        const first = host?.shadowRoot?.querySelector('input[type="range"]') as HTMLInputElement;
        first.focus();
      });

      const focusedElements: string[] = [];
      for (let i = 0; i < 8; i++) {
        const tag = await page.evaluate(() => {
          const host = document.querySelector('#e2e-layout-message .genui-card-host');
          const active = host?.shadowRoot?.activeElement as HTMLElement | null;
          if (!active) return 'none';
          const type = active.getAttribute('type');
          return `${active.tagName.toLowerCase()}${active.className ? '.' + active.className.split(' ')[0] : ''}${type ? `[${type}]` : ''}`;
        });
        focusedElements.push(tag);
        await page.keyboard.press('Tab');
      }

      // 断言真实键盘焦点顺序严格按照协议 DOM 顺序依次经过：
      // paramA 滑块 -> paramB 滑块 -> inputNum 输入框 -> col3_1 滑块 -> col3_2 滑块 -> col3_3 滑块 -> longField 滑块 -> table 筛选框
      expect(focusedElements[0]).toBe('input.genui-slider[range]');
      expect(focusedElements[1]).toBe('input.genui-slider[range]');
      expect(focusedElements[2]).toBe('input.genui-number-input[number]');
      expect(focusedElements[3]).toBe('input.genui-slider[range]');
      expect(focusedElements[4]).toBe('input.genui-slider[range]');
      expect(focusedElements[5]).toBe('input.genui-slider[range]');
      expect(focusedElements[6]).toBe('input.genui-slider[range]');
      expect(focusedElements[7]).toBe('input[search]');

      // 8. 宽窄布局切换前后的表格筛选、排序、输入草稿与详情折叠状态完整保持验证
      // 先切到 960px 宽容器
      await evaluateLayout(960, 'light');

      // (1) 表格筛选：输入 "方案 B"
      await page.evaluate(() => {
        const host = document.querySelector('#e2e-layout-message .genui-card-host');
        const shadow = host?.shadowRoot;
        const filterInput = shadow?.querySelector('.genui-table-filter input') as HTMLInputElement;
        filterInput.value = '方案 B';
        filterInput.dispatchEvent(new Event('input', { bubbles: true }));
        filterInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(50);
      const rowsFiltered = await page.evaluate(() => {
        const host = document.querySelector('#e2e-layout-message .genui-card-host');
        return host?.shadowRoot?.querySelectorAll('.genui-table tbody tr').length ?? 0;
      });
      expect(rowsFiltered).toBe(1);

      // (2) 表格筛选改为 "方案"（全匹配）并点击按预计成本列排序
      await page.evaluate(() => {
        const host = document.querySelector('#e2e-layout-message .genui-card-host');
        const shadow = host?.shadowRoot;
        const filterInput = shadow?.querySelector('.genui-table-filter input') as HTMLInputElement;
        filterInput.value = '方案';
        filterInput.dispatchEvent(new Event('input', { bubbles: true }));
        filterInput.dispatchEvent(new Event('change', { bubbles: true }));

        // 点击第二列（预计成本）表头排序按钮
        const sortButtons = shadow?.querySelectorAll('.genui-table-sort') ?? [];
        if (sortButtons.length > 1) {
          (sortButtons[1] as HTMLButtonElement).click();
        }
      });
      await page.waitForTimeout(50);

      // (3) 在 inputNum 中输入未提交/超界草稿 "150"（范围 0–100），显示错误状态
      await page.evaluate(() => {
        const host = document.querySelector('#e2e-layout-message .genui-card-host');
        const shadow = host?.shadowRoot;
        const numInput = shadow?.querySelector('input.genui-number-input') as HTMLInputElement;
        numInput.value = '150';
        numInput.dispatchEvent(new Event('input', { bubbles: true }));
        numInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(50);

      // (4) 展开图表数据详情、界面详情与原始 JSON 视图
      await page.evaluate(() => {
        const host = document.querySelector('#e2e-layout-message .genui-card-host');
        const shadow = host?.shadowRoot;
        const chartDetails = shadow?.querySelector('details.genui-chart-data') as HTMLDetailsElement;
        if (chartDetails) chartDetails.open = true;

        const uiDetails = shadow?.querySelector('details.genui-card-details') as HTMLDetailsElement;
        if (uiDetails) uiDetails.open = true;

        const rawBtn = shadow?.querySelector('.genui-card-toggle') as HTMLButtonElement;
        if (rawBtn && rawBtn.textContent?.includes('查看原始 JSON')) {
          rawBtn.click();
        }
      });
      await page.waitForTimeout(50);

      // 验证在 960px 下当前状态
      const stateAt960 = await page.evaluate(() => {
        const host = document.querySelector('#e2e-layout-message .genui-card-host');
        const shadow = host?.shadowRoot;
        const filterInput = shadow?.querySelector('.genui-table-filter input') as HTMLInputElement;
        const sortTh = shadow?.querySelectorAll('.genui-table thead th')[1] as HTMLElement;
        const firstRowName = shadow?.querySelector('.genui-table tbody tr td')?.textContent?.trim();
        const numInput = shadow?.querySelector('input.genui-number-input') as HTMLInputElement;
        const errorEl = shadow?.querySelector('.genui-input-error');
        const chartDetails = shadow?.querySelector('details.genui-chart-data') as HTMLDetailsElement;
        const uiDetails = shadow?.querySelector('details.genui-card-details') as HTMLDetailsElement;
        const actions = shadow?.querySelector('.genui-card-actions');
        const toggleBtn = shadow?.querySelector('.genui-card-toggle');
        return {
          filter: filterInput?.value,
          sortDir: sortTh?.getAttribute('aria-sort'),
          firstRowName,
          numValue: numInput?.value,
          hasError: !!errorEl,
          chartDetailsOpen: chartDetails?.open,
          uiDetailsOpen: uiDetails?.open,
          actionFirstClass: (actions?.firstElementChild as HTMLElement | null)?.className ?? null,
          toggleBtnText: toggleBtn?.textContent?.trim(),
        };
      });
      expect(stateAt960.filter).toBe('方案');
      expect(stateAt960.sortDir).toBe('ascending');
      expect(stateAt960.firstRowName).toBe('方案 B'); // 成本 800 最低，升序排第一
      expect(stateAt960.numValue).toBe('150');
      expect(stateAt960.hasError).toBe(true);
      expect(stateAt960.chartDetailsOpen).toBe(true);
      
      expect(stateAt960.uiDetailsOpen).toBe(true);
      expect(stateAt960.actionFirstClass).toBe('genui-card-followup');
      expect(stateAt960.toggleBtnText).toBe('收起原始 JSON');

      // (5) 触发宽度切换：从 960px 缩窄至 360px（触发 columns 单列化）
      await evaluateLayout(360, 'light');

      // 验证在 360px 单列化下，表格筛选、排序方向、首行排序结果、输入草稿、错误提示与详情展开完整保持
      const stateAt360 = await page.evaluate(() => {
        const host = document.querySelector('#e2e-layout-message .genui-card-host');
        const shadow = host?.shadowRoot;
        const filterInput = shadow?.querySelector('.genui-table-filter input') as HTMLInputElement;
        const sortTh = shadow?.querySelectorAll('.genui-table thead th')[1] as HTMLElement;
        const firstRowName = shadow?.querySelector('.genui-table tbody tr td')?.textContent?.trim();
        const numInput = shadow?.querySelector('input.genui-number-input') as HTMLInputElement;
        const errorEl = shadow?.querySelector('.genui-input-error');
        const chartDetails = shadow?.querySelector('details.genui-chart-data') as HTMLDetailsElement;
        const uiDetails = shadow?.querySelector('details.genui-card-details') as HTMLDetailsElement;
        const actions = shadow?.querySelector('.genui-card-actions');
        const toggleBtn = shadow?.querySelector('.genui-card-toggle');
        const cardEl = shadow?.querySelector('.genui-card') as HTMLElement;
        return {
          filter: filterInput?.value,
          sortDir: sortTh?.getAttribute('aria-sort'),
          firstRowName,
          numValue: numInput?.value,
          hasError: !!errorEl,
          chartDetailsOpen: chartDetails?.open,
          uiDetailsOpen: uiDetails?.open,
          actionFirstClass: (actions?.firstElementChild as HTMLElement | null)?.className ?? null,
          toggleBtnText: toggleBtn?.textContent?.trim(),
          isCardOverflowing: cardEl.scrollWidth > cardEl.clientWidth + 1,
        };
      });
      expect(stateAt360.filter).toBe('方案');
      expect(stateAt360.sortDir).toBe('ascending');
      expect(stateAt360.firstRowName).toBe('方案 B');
      expect(stateAt360.numValue).toBe('150');
      expect(stateAt360.hasError).toBe(true);
      expect(stateAt360.chartDetailsOpen).toBe(true);
      
      expect(stateAt360.uiDetailsOpen).toBe(true);
      expect(stateAt360.actionFirstClass).toBe('genui-card-followup');
      expect(stateAt360.toggleBtnText).toBe('收起原始 JSON');
      expect(stateAt360.isCardOverflowing).toBe(false);

      // (6) 再切回 960px 恢复多列并列，再次断言所有状态完整保留
      await evaluateLayout(960, 'light');
      const stateRestored = await page.evaluate(() => {
        const host = document.querySelector('#e2e-layout-message .genui-card-host');
        const shadow = host?.shadowRoot;
        const filterInput = shadow?.querySelector('.genui-table-filter input') as HTMLInputElement;
        const sortTh = shadow?.querySelectorAll('.genui-table thead th')[1] as HTMLElement;
        const firstRowName = shadow?.querySelector('.genui-table tbody tr td')?.textContent?.trim();
        const numInput = shadow?.querySelector('input.genui-number-input') as HTMLInputElement;
        const errorEl = shadow?.querySelector('.genui-input-error');
        const chartDetails = shadow?.querySelector('details.genui-chart-data') as HTMLDetailsElement;
        const cardEl = shadow?.querySelector('.genui-card') as HTMLElement;
        return {
          filter: filterInput?.value,
          sortDir: sortTh?.getAttribute('aria-sort'),
          firstRowName,
          numValue: numInput?.value,
          hasError: !!errorEl,
          chartDetailsOpen: chartDetails?.open,
          isCardOverflowing: cardEl.scrollWidth > cardEl.clientWidth + 1,
        };
      });
      expect(stateRestored.filter).toBe('方案');
      expect(stateRestored.sortDir).toBe('ascending');
      expect(stateRestored.firstRowName).toBe('方案 B');
      expect(stateRestored.numValue).toBe('150');
      expect(stateRestored.hasError).toBe(true);
      expect(stateRestored.chartDetailsOpen).toBe(true);
      
      expect(stateRestored.isCardOverflowing).toBe(false);

      const all = [...buckets.extension, ...buckets.site, ...buckets.unattributed];
      expect(all, '模拟页中出现错误（唯一脚本即被测扩展，全部归因于扩展）').toEqual([]);
    } finally {
      await context.close();
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

}
