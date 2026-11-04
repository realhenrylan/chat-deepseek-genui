import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REASON_ATTR,
  STATE_ATTR,
  createEnhancementManager,
  enhanceDocument,
} from '../../src/content/enhance';
import { UNKNOWN_SESSION_ID } from '../../src/content/identity';
import { createPlanStore, type PlanStorageArea } from '../../src/content/plan-store';
import { createCardStateStore } from '../../src/runtime/card-state-store';
import { ElementRegistry } from '../../src/render/registry';

/**
 * 阶段 2：识别 → 解析 → 挂载的整链路（enhanceDocument）。
 *
 * 覆盖开发任务要求：普通 Markdown 不受影响、多代码块互不干扰、
 * 非法输入安全回退、幂等、组件异常恢复原始内容。
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/assistant-genui-message.html');

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const VALID_JSON = (value: string): string =>
  JSON.stringify({ type: 'genui', version: 1, elements: [{ kind: 'text', value }] });

/** 按真实网页观察到的结构组装回复片段。 */
function codeBlock(options: { label?: string | null; raw?: string | null } = {}): string {
  const { label = 'genui', raw = VALID_JSON('默认文本') } = options;
  const banner =
    '<div class="md-code-block-banner-wrap">' +
    '<div class="md-code-block-banner md-code-block-banner-lite">' +
    '<div class="d2a24f03">' +
    (label === null ? '' : `<span class="d813de27">${label}</span>`) +
    '</div></div></div>';
  const pre = raw === null ? '' : `<pre><span>${raw}</span></pre>`;
  return `<div class="md-code-block md-code-block-dark">${banner}${pre}</div>`;
}

function assistant(html: string): string {
  return `<div class="ds-markdown ds-assistant-message-main-content">${html}</div>`;
}

function buildDoc(html: string): Document {
  return parseHtml(`<!DOCTYPE html><html><body>${html}</body></html>`);
}

describe('enhanceDocument 整链路', () => {
  it('真实阶段 0 快照 fixture：恰好挂载 1 个卡片并隐藏原始块', () => {
    const doc = parseHtml(readFileSync(FIXTURE, 'utf8'));

    const result = enhanceDocument(doc);

    expect(result).toEqual({ mounted: 1, skipped: 0, failed: 0 });
    const hosts = doc.querySelectorAll('.genui-card-host');
    expect(hosts).toHaveLength(1);
    const shadow = hosts[0].shadowRoot;
    expect(shadow).not.toBeNull();
    expect(shadow?.textContent).toContain('透明增强测试');
    expect(shadow?.textContent).toContain('查看原始 JSON');
    const block = doc.querySelector<HTMLElement>('.md-code-block');
    expect(block?.style.display).toBe('none');
    expect(block?.getAttribute(STATE_ATTR)).toBe('mounted');
  });

  it('幂等：已挂载的块再次执行被跳过，不产生重复 host', () => {
    const doc = buildDoc(assistant(codeBlock({ raw: VALID_JSON('幂等测试') })));

    expect(enhanceDocument(doc).mounted).toBe(1);
    const second = enhanceDocument(doc);

    expect(second).toEqual({ mounted: 0, skipped: 1, failed: 0 });
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(1);
  });

  it('非法 JSON 块安全回退：原块保持可见并标记失败原因', () => {
    const doc = buildDoc(assistant(codeBlock({ raw: '{"type":"genui",' })));

    const result = enhanceDocument(doc);

    expect(result).toEqual({ mounted: 0, skipped: 0, failed: 1 });
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    const block = doc.querySelector<HTMLElement>('.md-code-block');
    expect(block?.style.display).not.toBe('none');
    expect(block?.getAttribute(STATE_ATTR)).toBe('failed');
    expect(block?.getAttribute(REASON_ATTR)).toBe('invalid-json');
    expect(block?.querySelector('pre')?.textContent).toBe('{"type":"genui",');
  });

  it('未知版本安全回退并记录 unsupported-version', () => {
    const doc = buildDoc(
      assistant(codeBlock({ raw: '{"type":"genui","version":6,"elements":[{"kind":"text","value":"x"}]}' })),
    );

    expect(enhanceDocument(doc).failed).toBe(1);
    expect(doc.querySelector('.md-code-block')?.getAttribute(REASON_ATTR)).toBe('unsupported-version');
  });

  it('额外字段安全回退并记录 schema-violation', () => {
    const doc = buildDoc(
      assistant(codeBlock({ raw: '{"type":"genui","version":1,"elements":[{"kind":"text","value":"x"}],"evil":1}' })),
    );

    expect(enhanceDocument(doc).failed).toBe(1);
    expect(doc.querySelector('.md-code-block')?.getAttribute(REASON_ATTR)).toBe('schema-violation');
  });

  it('缺少 pre 的 genui 块按 missing-pre 回退', () => {
    const doc = buildDoc(assistant(codeBlock({ raw: null })));

    expect(enhanceDocument(doc).failed).toBe(1);
    expect(doc.querySelector('.md-code-block')?.getAttribute(REASON_ATTR)).toBe('missing-pre');
  });

  it('普通 Markdown、json 标签块与用户消息完全不受影响', () => {
    const doc = buildDoc(
      '<p class="ds-markdown-paragraph">普通段落，提到 genui 一词。</p>' +
        assistant('<p class="ds-markdown-paragraph">回复里的普通文本。</p>' + codeBlock({ label: 'json' })) +
        `<div class="ds-message">${codeBlock({ raw: VALID_JSON('用户消息里的块') })}</div>`,
    );

    const result = enhanceDocument(doc);

    expect(result).toEqual({ mounted: 0, skipped: 0, failed: 0 });
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    for (const block of doc.querySelectorAll<HTMLElement>('.md-code-block')) {
      expect(block.style.display).not.toBe('none');
      expect(block.hasAttribute(STATE_ATTR)).toBe(false);
    }
  });

  it('同一回复内多个 genui 块各自独立挂载，互不干扰', () => {
    const doc = buildDoc(
      assistant(codeBlock({ raw: VALID_JSON('第一个卡片') }) + codeBlock({ raw: VALID_JSON('第二个卡片') })),
    );

    const result = enhanceDocument(doc);

    expect(result.mounted).toBe(2);
    const hosts = doc.querySelectorAll('.genui-card-host');
    expect(hosts).toHaveLength(2);
    expect(hosts[0].shadowRoot?.textContent).toContain('第一个卡片');
    expect(hosts[1].shadowRoot?.textContent).toContain('第二个卡片');
    const blocks = doc.querySelectorAll<HTMLElement>('.md-code-block');
    expect(blocks[0].style.display).toBe('none');
    expect(blocks[1].style.display).toBe('none');
  });

  it('查看原始 JSON：恢复原块且卡片保持可见（入口可再次收起），收起后反向恢复', async () => {
    const doc = buildDoc(assistant(codeBlock({ raw: VALID_JSON('切换测试') })));
    enhanceDocument(doc);
    const host = doc.querySelector<HTMLElement>('.genui-card-host');
    const block = doc.querySelector<HTMLElement>('.md-code-block');
    expect(host).not.toBeNull();
    expect(block).not.toBeNull();

    // 阶段 6 起 header 上还有展开按钮；原始 JSON 入口必须用专属类定位。
    const button = host?.shadowRoot?.querySelector<HTMLButtonElement>('button.genui-card-toggle');
    expect(button).not.toBeNull();
    // React 19 的状态更新在后续任务刷入，等待后再断言。
    const flushUi = () => new Promise((resolve) => setTimeout(resolve, 0));

    button?.click();
    await flushUi();
    expect(block?.style.display).not.toBe('none');
    // 卡片不得隐藏：否则「收起原始 JSON」在真实浏览器中不可再点击。
    expect(host?.hidden).toBe(false);
    expect(button?.textContent).toBe('收起原始 JSON');

    button?.click();
    await flushUi();
    expect(block?.style.display).toBe('none');
    expect(host?.hidden).toBe(false);
    expect(button?.textContent).toBe('查看原始 JSON');
  });

  it('组件渲染异常时恢复原始块、移除卡片并标记 render-error', async () => {
    const doc = buildDoc(assistant(codeBlock({ raw: VALID_JSON('异常恢复') })));
    // 卡片级异常（区别于元素级边界）：注册表在 Card 渲染期间抛错，
    // 触发 CardErrorBoundary → onFatal 恢复链路。
    const registry = ElementRegistry.withDefaults();
    Object.defineProperty(registry, 'get', {
      value: () => {
        throw new Error('render-boom');
      },
    });

    enhanceDocument(doc, { registry });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    const block = doc.querySelector<HTMLElement>('.md-code-block');
    expect(block?.style.display).not.toBe('none');
    expect(block?.getAttribute(STATE_ATTR)).toBe('failed');
    expect(block?.getAttribute(REASON_ATTR)).toBe('render-error');
    expect(block?.querySelector('pre')?.textContent).toContain('异常恢复');
  });
});

describe('阶段 6：onContinue 透传（用户主动触发，不自动发送）', () => {
  const V2_JSON = JSON.stringify({
    type: 'genui',
    version: 2,
    title: '预算复核',
    state: [{ id: 'budget', label: '总预算', kind: 'number', initial: 100, min: 0, max: 100000, step: 1, unit: '元' }],
    derived: [],
    elements: [{ kind: 'value', label: '当前预算', source: { kind: 'state', id: 'budget' } }],
  });

  it('点击继续讨论：先打开可编辑预览，点「填入输入框」才交给 onContinue', async () => {
    const doc = buildDoc(assistant(codeBlock({ raw: V2_JSON })));
    const summaries: string[] = [];
    const flushUi = () => new Promise((resolve) => setTimeout(resolve, 0));

    enhanceDocument(doc, {
      onContinue: (summary) => {
        summaries.push(summary);
        return 'filled';
      },
    });
    const host = doc.querySelector<HTMLElement>('.genui-card-host');
    expect(host).not.toBeNull();

    // 初始挂载绝不自动调用：必须由用户点击触发。
    expect(summaries).toHaveLength(0);

    const button = host?.shadowRoot?.querySelector<HTMLButtonElement>('button.genui-card-followup');
    expect(button).not.toBeNull();
    await flushUi();
    button?.click();
    await flushUi();

    // 点击只打开预览，发送仍由用户决定。
    expect(summaries).toHaveLength(0);
    expect(host?.shadowRoot?.querySelector('.genui-followup-text')).not.toBeNull();

    const apply = host?.shadowRoot?.querySelector<HTMLButtonElement>('.genui-followup-apply');
    expect(apply).not.toBeNull();
    apply?.click();
    await flushUi();

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('总预算：100 元');
    const feedback = host?.shadowRoot?.querySelector('.genui-card-followup-feedback');
    expect(feedback?.textContent).toContain('已填入输入框');
  });

  it('未接线（未提供 onContinue）点击不抛异常；v1 卡片没有该入口', async () => {
    const doc = buildDoc(
      assistant(codeBlock({ raw: VALID_JSON('旧卡片') }) + codeBlock({ raw: V2_JSON })),
    );
    const flushUi = () => new Promise((resolve) => setTimeout(resolve, 0));

    expect(() => enhanceDocument(doc)).not.toThrow();
    const hosts = doc.querySelectorAll<HTMLElement>('.genui-card-host');
    expect(hosts).toHaveLength(2);
    // v1（第 1 个块）没有继续讨论按钮；v2 有且点击安全（无 onContinue → 不可用反馈）。
    expect(hosts[0]?.shadowRoot?.querySelector('.genui-card-followup')).toBeNull();
    const followup = hosts[1]?.shadowRoot?.querySelector<HTMLButtonElement>('button.genui-card-followup');
    expect(followup).not.toBeNull();
    await flushUi();
    expect(() => followup?.click()).not.toThrow();
    await flushUi();
  });
});

describe('阶段 8：卡片状态保留与「保存方案」（issue #2）', () => {
  const SESSION = '/a/chat/s/session-1';
  const ACCOUNT = 'user-1';

  const BUDGET_V2 = JSON.stringify({
    type: 'genui',
    version: 2,
    title: '预算复核',
    state: [
      {
        id: 'budget',
        label: '总预算',
        kind: 'number',
        initial: 5000,
        min: 0,
        max: 10000,
        step: 100,
        unit: '元',
      },
    ],
    derived: [],
    elements: [
      { kind: 'slider', bind: 'budget' },
      { kind: 'value', label: '当前预算', source: { kind: 'state', id: 'budget' } },
    ],
  });

  const CHANGED_V2 = JSON.stringify({
    type: 'genui',
    version: 2,
    title: '预算（修订）',
    state: [
      {
        id: 'budget',
        label: '总预算',
        kind: 'number',
        initial: 5000,
        min: 0,
        max: 10000,
        step: 100,
        unit: '元',
      },
    ],
    derived: [],
    elements: [
      { kind: 'number-input', bind: 'budget' },
      { kind: 'value', label: '可用预算', source: { kind: 'state', id: 'budget' } },
    ],
  });

  const TABLE_V3 = JSON.stringify({
    type: 'genui',
    version: 3,
    title: '支出明细',
    state: [],
    derived: [],
    elements: [
      {
        kind: 'table',
        title: '支出',
        sortable: true,
        columns: [
          { key: 'name', label: '项目' },
          { key: 'amount', label: '金额', numeric: true, unit: '元' },
        ],
        rows: [
          { cells: { name: '房租', amount: 3000 } },
          { cells: { name: '餐饮', amount: 1200 } },
        ],
      },
    ],
  });

  const flushUi = () => new Promise((resolve) => setTimeout(resolve, 0));

  /**
   * DOMParser 创建的文档没有 window，testing-library 的 fireEvent 无法使用；
   * 这里用原型 setter 绕过 React 的 value tracker 后派发原生 input 事件。
   */
  function setInputValue(input: HTMLInputElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }

  class MemoryArea implements PlanStorageArea {
    readonly items = new Map<string, unknown>();

    async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
      if (keys === null) return Object.fromEntries(this.items);
      const list = typeof keys === 'string' ? [keys] : keys;
      const result: Record<string, unknown> = {};
      for (const key of list) {
        if (this.items.has(key)) result[key] = this.items.get(key);
      }
      return result;
    }

    async set(items: Record<string, unknown>): Promise<void> {
      for (const [key, value] of Object.entries(items)) this.items.set(key, value);
    }

    async remove(keys: string | string[]): Promise<void> {
      for (const key of typeof keys === 'string' ? [keys] : keys) this.items.delete(key);
    }
  }

  /** 带虚拟列表消息键的真实容器结构，避免身份退化为文本指纹。 */
  function message(html: string, key = 'v1'): string {
    return `<div data-virtual-list-item-key="${key}">${assistant(html)}</div>`;
  }

  function budgetDoc(raw: string = BUDGET_V2): Document {
    return buildDoc(message(codeBlock({ raw })));
  }

  function sliderOf(host: HTMLElement): HTMLInputElement {
    const slider = host.shadowRoot?.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('滑块未渲染');
    return slider;
  }

  /** 模拟站点用新节点替换整条消息：旧卡片 host 与挂载标记都消失。 */
  function replaceMessage(doc: Document): HTMLElement {
    const wrapper = doc.querySelector<HTMLElement>('[data-virtual-list-item-key]');
    if (!wrapper) throw new Error('消息容器不存在');
    const replacement = wrapper.cloneNode(true) as HTMLElement;
    for (const host of replacement.querySelectorAll('.genui-card-host')) host.remove();
    for (const block of replacement.querySelectorAll<HTMLElement>('.md-code-block')) {
      block.removeAttribute(STATE_ATTR);
      block.removeAttribute(REASON_ATTR);
      block.style.display = '';
    }
    wrapper.replaceWith(replacement);
    return replacement;
  }

  it('同一文档的节点替换后保留调整值；未提供存储时没有保存入口', async () => {
    const doc = budgetDoc();
    const stateStore = createCardStateStore();
    enhanceDocument(doc, { stateStore, sessionId: SESSION });

    const firstHost = doc.querySelector<HTMLElement>('.genui-card-host');
    expect(firstHost).not.toBeNull();
    if (!firstHost) return;
    expect(firstHost.shadowRoot?.querySelector('.genui-card-save')).toBeNull();

    setInputValue(sliderOf(firstHost), '7000');
    await flushUi();
    expect(stateStore.size()).toBe(1);

    replaceMessage(doc);
    enhanceDocument(doc, { stateStore, sessionId: SESSION });

    const remounted = doc.querySelector<HTMLElement>('.genui-card-host');
    expect(remounted).not.toBeNull();
    if (!remounted) return;
    expect(remounted).not.toBe(firstHost);
    expect(sliderOf(remounted).value).toBe('7000');
    expect(remounted.shadowRoot?.textContent).toContain('7000 元');
  });

  it('同一文档的节点替换后保留表格筛选与排序', async () => {
    const doc = buildDoc(message(codeBlock({ raw: TABLE_V3 })));
    const stateStore = createCardStateStore();
    enhanceDocument(doc, { stateStore, sessionId: SESSION });

    const firstHost = doc.querySelector<HTMLElement>('.genui-card-host');
    expect(firstHost).not.toBeNull();
    if (!firstHost) return;
    const filter = firstHost.shadowRoot?.querySelector<HTMLInputElement>('input[type="search"]');
    expect(filter).not.toBeNull();
    if (!filter) throw new Error('筛选框未渲染');
    setInputValue(filter, '房租');
    await flushUi();
    expect(firstHost.shadowRoot?.querySelector('.genui-table-count')?.textContent).toContain(
      '显示 1 / 2 行',
    );

    const amountSort = [...(firstHost.shadowRoot?.querySelectorAll<HTMLButtonElement>(
      'button.genui-table-sort',
    ) ?? [])].find((button) => button.textContent?.includes('金额'));
    amountSort?.click();
    await flushUi();
    expect(
      firstHost.shadowRoot?.querySelector('th[aria-sort="ascending"]')?.textContent,
    ).toContain('金额');

    replaceMessage(doc);
    enhanceDocument(doc, { stateStore, sessionId: SESSION });

    const remounted = doc.querySelector<HTMLElement>('.genui-card-host');
    expect(remounted).not.toBeNull();
    if (!remounted) return;
    const restoredFilter = remounted.shadowRoot?.querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    expect(restoredFilter?.value).toBe('房租');
    expect(remounted.shadowRoot?.querySelector('.genui-table-count')?.textContent).toContain(
      '显示 1 / 2 行',
    );
    expect(remounted.shadowRoot?.querySelector('th[aria-sort="ascending"]')?.textContent).toContain(
      '金额',
    );
  });

  it('原始块被改写后丢弃旧文档状态并按新文档初始值挂载', async () => {
    const doc = budgetDoc();
    const stateStore = createCardStateStore();
    const manager = createEnhancementManager(doc, { stateStore, sessionId: SESSION });
    manager.reconcile(true);

    const host = doc.querySelector<HTMLElement>('.genui-card-host');
    expect(host).not.toBeNull();
    if (!host) return;
    setInputValue(sliderOf(host), '8000');
    await flushUi();
    expect(stateStore.size()).toBe(1);

    const raw = doc.querySelector('.md-code-block pre span');
    expect(raw).not.toBeNull();
    raw!.textContent = CHANGED_V2;
    manager.reconcile(true);

    // 旧键被删除、新文档重新占一个键；不会把 8000 套用到改写后的文档。
    expect(stateStore.size()).toBe(1);
    const remounted = doc.querySelector<HTMLElement>('.genui-card-host');
    expect(remounted).not.toBeNull();
    if (!remounted) return;
    const numberInput = remounted.shadowRoot?.querySelector<HTMLInputElement>(
      'input[type="number"]',
    );
    expect(numberInput?.value).toBe('5000');
    expect(remounted.shadowRoot?.textContent).toContain('5000 元');

    manager.dispose();
  });

  it('主动保存写入本机，清除后移除记录并恢复入口文案', async () => {
    const area = new MemoryArea();
    const planStore = createPlanStore(area);
    const doc = budgetDoc();
    enhanceDocument(doc, { planStore, sessionId: SESSION, accountId: ACCOUNT });

    const host = doc.querySelector<HTMLElement>('.genui-card-host');
    expect(host).not.toBeNull();
    if (!host) return;
    setInputValue(sliderOf(host), '7000');
    await flushUi();

    const save = host.shadowRoot?.querySelector<HTMLButtonElement>('button.genui-card-save');
    expect(save?.textContent).toBe('保存方案');
    await flushUi();
    save?.click();
    await flushUi();

    expect(area.items.size).toBe(1);
    const [storageKey] = [...area.items.keys()];
    expect(storageKey?.startsWith('genuiPlan:')).toBe(true);
    expect(host.shadowRoot?.querySelector('.genui-card-plan-feedback')?.textContent).toContain(
      '已保存到本机',
    );
    expect(save?.textContent).toBe('更新保存的方案');

    const clear = host.shadowRoot?.querySelector<HTMLButtonElement>(
      'button.genui-card-clear-plan',
    );
    expect(clear).not.toBeNull();
    clear?.click();
    await flushUi();

    expect(area.items.size).toBe(0);
    expect(host.shadowRoot?.querySelector('.genui-card-plan-feedback')?.textContent).toContain(
      '已清除',
    );
    expect(save?.textContent).toBe('保存方案');
    expect(host.shadowRoot?.querySelector('button.genui-card-clear-plan')).toBeNull();
  });

  it('会话或消息身份不可靠时拒绝写入本机并给出说明', async () => {
    const area = new MemoryArea();
    const doc = budgetDoc();
    enhanceDocument(doc, { planStore: createPlanStore(area), sessionId: UNKNOWN_SESSION_ID });

    const host = doc.querySelector<HTMLElement>('.genui-card-host');
    expect(host).not.toBeNull();
    if (!host) return;
    const save = host.shadowRoot?.querySelector<HTMLButtonElement>('button.genui-card-save');
    expect(save).not.toBeNull();
    await flushUi();
    save?.click();
    await flushUi();

    expect(area.items.size).toBe(0);
    expect(host.shadowRoot?.querySelector('.genui-card-plan-feedback')?.textContent).toContain(
      '无法可靠确认',
    );
  });

  it('账号标记缺失时仍按会话作用域保存，并在刷新后恢复', async () => {
    const area = new MemoryArea();
    const firstDoc = budgetDoc();
    const first = createEnhancementManager(firstDoc, {
      planStore: createPlanStore(area),
      sessionId: SESSION,
    });
    await first.loadSavedPlans();
    first.reconcile(true);

    const host = firstDoc.querySelector<HTMLElement>('.genui-card-host');
    expect(host).not.toBeNull();
    if (!host) return;
    setInputValue(sliderOf(host), '7000');
    await flushUi();
    host.shadowRoot?.querySelector<HTMLButtonElement>('button.genui-card-save')?.click();
    await flushUi();

    expect(area.items.size).toBe(1);
    const [savedKey] = [...area.items.keys()];
    expect(savedKey).toContain('acct-unknown');
    expect(host.shadowRoot?.querySelector('.genui-card-plan-feedback')?.textContent).toContain(
      '已保存到本机',
    );
    first.dispose();

    const secondDoc = budgetDoc();
    const second = createEnhancementManager(secondDoc, {
      planStore: createPlanStore(area),
      sessionId: SESSION,
    });
    await second.loadSavedPlans();
    second.reconcile(true);

    const restored = secondDoc.querySelector<HTMLElement>('.genui-card-host');
    expect(restored).not.toBeNull();
    if (!restored) return;
    expect(sliderOf(restored).value).toBe('7000');
    second.dispose();
  });

  it('账号作用域不同的保存记录不会被读取', async () => {
    const area = new MemoryArea();
    const firstDoc = budgetDoc();
    enhanceDocument(firstDoc, {
      planStore: createPlanStore(area),
      sessionId: SESSION,
      accountId: ACCOUNT,
    });

    const firstHost = firstDoc.querySelector<HTMLElement>('.genui-card-host');
    expect(firstHost).not.toBeNull();
    if (!firstHost) return;
    setInputValue(sliderOf(firstHost), '7000');
    await flushUi();
    firstHost.shadowRoot
      ?.querySelector<HTMLButtonElement>('button.genui-card-save')
      ?.click();
    await flushUi();
    expect(area.items.size).toBe(1);

    const secondDoc = budgetDoc();
    const second = createEnhancementManager(secondDoc, {
      planStore: createPlanStore(area),
      sessionId: SESSION,
      accountId: 'user-2',
    });
    await second.loadSavedPlans();
    second.reconcile(true);

    const restored = secondDoc.querySelector<HTMLElement>('.genui-card-host');
    expect(restored).not.toBeNull();
    if (!restored) return;
    expect(sliderOf(restored).value).toBe('5000');
    expect(
      restored.shadowRoot?.querySelector('button.genui-card-save')?.textContent,
    ).toBe('保存方案');

    second.dispose();
  });

  it('刷新后由新管理器加载保存记录并恢复方案', async () => {
    const area = new MemoryArea();
    const firstDoc = budgetDoc();
    const first = createEnhancementManager(firstDoc, {
      planStore: createPlanStore(area),
      sessionId: SESSION,
      accountId: ACCOUNT,
    });
    await first.loadSavedPlans();
    first.reconcile(true);

    const host = firstDoc.querySelector<HTMLElement>('.genui-card-host');
    expect(host).not.toBeNull();
    if (!host) return;
    setInputValue(sliderOf(host), '7000');
    await flushUi();
    host.shadowRoot?.querySelector<HTMLButtonElement>('button.genui-card-save')?.click();
    await flushUi();
    expect(area.items.size).toBe(1);
    first.dispose();

    const secondDoc = budgetDoc();
    const second = createEnhancementManager(secondDoc, {
      planStore: createPlanStore(area),
      sessionId: SESSION,
      accountId: ACCOUNT,
    });
    await second.loadSavedPlans();
    second.reconcile(true);

    const restored = secondDoc.querySelector<HTMLElement>('.genui-card-host');
    expect(restored).not.toBeNull();
    if (!restored) return;
    expect(sliderOf(restored).value).toBe('7000');
    expect(
      restored.shadowRoot?.querySelector('button.genui-card-save')?.textContent,
    ).toBe('更新保存的方案');

    second.dispose();
  });
});
