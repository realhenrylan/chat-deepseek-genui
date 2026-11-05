import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { GenuiDocument, TableElement } from '../../src/protocol/types';
import { ElementRegistry } from '../../src/render/registry';
import { mountCard, type MountedCard } from '../../src/render/mount';
import { createCardStateStore } from '../../src/runtime/card-state-store';
import type {
  CardUiState,
  SavedStateClearResult,
  SavedStateSaveResult,
} from '../../src/runtime/card-state';

/**
 * 阶段 2：Card 渲染与 Shadow DOM 样式隔离（Red → Green）。
 *
 * 覆盖：基本呈现、未知 kind 占位（防御层）、单元素异常隔离、
 * 查看原始 JSON 切换、卡片级渲染异常回滚、模型字符串不作 HTML 解释。
 */

const RAW = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"你好"}]}';

const DOC: GenuiDocument = {
  type: 'genui',
  version: 1,
  title: '预算规划',
  elements: [{ kind: 'text', value: '合计 100 元' }],
};

const INTERACTIVE_DOC: GenuiDocument = {
  type: 'genui',
  version: 2,
  title: '预算调整',
  state: [
    { id: 'budget', label: '总预算', kind: 'number', initial: 5000, min: 0, max: 10000, step: 100, unit: '元' },
    { id: 'spent', label: '已支出', kind: 'number', initial: 1000, min: 0, max: 5000, step: 100, unit: '元' },
    {
      id: 'category',
      label: '类别',
      kind: 'select',
      initial: 'food',
      options: [{ label: '餐饮', value: 'food' }, { label: '交通', value: 'transport' }],
    },
  ],
  derived: [{
    id: 'remaining',
    label: '余额',
    unit: '元',
    expression: { op: 'subtract', left: { op: 'state', id: 'budget' }, right: { op: 'state', id: 'spent' } },
  }],
  elements: [
    { kind: 'slider', bind: 'budget' },
    { kind: 'number-input', bind: 'spent' },
    { kind: 'select', bind: 'category' },
    { kind: 'value', label: '当前类别', source: { kind: 'state', id: 'category' } },
    { kind: 'value', label: '可用余额', source: { kind: 'derived', id: 'remaining' } },
  ],
};

let mounted: MountedCard | null = null;

function mount(
  doc: GenuiDocument,
  options: {
    registry?: ElementRegistry;
    onToggleRaw?: (show: boolean) => void;
    onFatal?: (error: Error) => void;
    savedAt?: number | null;
    restoredAt?: number | null;
    onSaveState?: (state: CardUiState) => Promise<SavedStateSaveResult>;
    onClearSavedState?: () => Promise<SavedStateClearResult>;
  } = {},
  rawJson = RAW,
): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mounted = mountCard(host, {
    document: doc,
    rawJson,
    ...options,
  });
  return host;
}

function shadowText(host: HTMLElement): string {
  const shadow = host.shadowRoot;
  expect(shadow).not.toBeNull();
  return shadow?.textContent ?? '';
}

/** 等待 React 把点击触发的状态更新刷入 DOM（React 19 调度在后续任务）。 */
function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.replaceChildren();
});

describe('Card 渲染（Shadow DOM 隔离）', () => {
  it('渲染标题、文本元素、说明与查看入口', () => {
    const host = mount(DOC);
    const text = shadowText(host);

    expect(host.shadowRoot?.querySelector('style')).not.toBeNull();
    expect(text).toContain('GenUI');
    expect(text).toContain('预算规划');
    expect(text).toContain('合计 100 元');
    expect(text).toContain('查看原始 JSON');
    expect(text).toContain('透明增强');
  });

  it('无 title 时不渲染标题节点', () => {
    const doc: GenuiDocument = { ...DOC, title: undefined, elements: [{ kind: 'text', value: '只有文本' }] };
    const host = mount(doc);

    expect(host.shadowRoot?.querySelector('.genui-card-title')).toBeNull();
    expect(shadowText(host)).toContain('只有文本');
  });

  it('模型输出的 HTML 字面量按纯文本呈现，不产生真实元素（不作 HTML 解释）', () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const doc: GenuiDocument = {
      type: 'genui',
      version: 1,
      elements: [{ kind: 'text', value: hostile }],
    };
    const host = mount(doc);

    expect(host.shadowRoot?.querySelector('img')).toBeNull();
    expect(host.shadowRoot?.querySelector('script')).toBeNull();
    expect(shadowText(host)).toContain(hostile);
  });

  it('注册表缺失的 kind 渲染占位而不是崩溃（防御层）', () => {
    const doc = {
      type: 'genui',
      version: 1,
      elements: [{ kind: 'chart', value: 'x' }],
    } as unknown as GenuiDocument;
    const host = mount(doc);
    const text = shadowText(host);

    expect(text).toContain('暂不支持的元素类型：chart');
    expect(text).toContain('GenUI');
    expect(text).toContain('查看原始 JSON');
  });

  it('单个元素组件抛错时由元素级边界接管，卡片其余部分存活', () => {
    const registry = ElementRegistry.withDefaults().register('text', () => {
      throw new Error('element-boom');
    });
    const host = mount(DOC, { registry });
    const text = shadowText(host);

    expect(text).toContain('该元素渲染失败');
    expect(text).toContain('GenUI');
    expect(text).toContain('查看原始 JSON');
  });

  it('点击「查看原始 JSON」回调 show=true 并切换按钮文案', async () => {
    const onToggleRaw = vi.fn();
    const host = mount(DOC, { onToggleRaw });

    // 阶段 6 起 header 上先有展开按钮；这里必须点「查看原始 JSON」按钮本体。
    const button = host.shadowRoot?.querySelector<HTMLButtonElement>('button.genui-card-toggle');
    expect(button).not.toBeNull();
    button?.click();
    await flushUi();

    expect(onToggleRaw).toHaveBeenCalledWith(true);
    expect(shadowText(host)).toContain('收起原始 JSON');

    button?.click();
    await flushUi();
    expect(onToggleRaw).toHaveBeenLastCalledWith(false);
    expect(shadowText(host)).toContain('查看原始 JSON');
  });

  it('卡片级渲染异常触发 onFatal（由挂载方恢复原始块）', async () => {
    const onFatal = vi.fn();
    const broken = { type: 'genui', version: 1, elements: null } as unknown as GenuiDocument;
    mount(broken, { onFatal });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('交互控件即时更新派生值，选择器展示状态，重置恢复初始值', async () => {
    const host = mount(INTERACTIVE_DOC);
    const shadow = host.shadowRoot;
    const slider = shadow?.querySelector<HTMLInputElement>('input[type="range"]');
    const numberInput = shadow?.querySelector<HTMLInputElement>('input[type="number"]');
    const select = shadow?.querySelector<HTMLSelectElement>('select');

    expect(shadow?.querySelectorAll('input[type="range"], input[type="number"]')).toHaveLength(2);
    expect(shadow?.querySelectorAll('output.genui-value-output')[0]?.textContent).toBe('餐饮');
    expect(shadow?.querySelectorAll('output.genui-value-output')[1]?.textContent).toBe('4000 元');

    if (!slider || !numberInput || !select) throw new Error('交互控件未渲染');
    fireEvent.change(slider, { target: { value: '7000' } });
    await flushUi();
    expect(shadow?.querySelectorAll('output.genui-value-output')[1]?.textContent).toBe('6000 元');

    fireEvent.change(numberInput, { target: { value: '2000' } });
    await flushUi();
    expect(shadow?.querySelectorAll('output.genui-value-output')[1]?.textContent).toBe('5000 元');

    fireEvent.change(select, { target: { value: 'transport' } });
    await flushUi();
    expect(shadow?.querySelectorAll('output.genui-value-output')[0]?.textContent).toBe('交通');

    shadow?.querySelector<HTMLButtonElement>('.genui-card-reset')?.click();
    await flushUi();
    expect(slider.value).toBe('5000');
    expect(numberInput.value).toBe('1000');
    expect(select.value).toBe('food');
    expect(shadow?.querySelectorAll('output.genui-value-output')[1]?.textContent).toBe('4000 元');
  });

  it('空输入与越界输入显示局部错误且保留上一个有效状态', async () => {
    const host = mount(INTERACTIVE_DOC);
    const shadow = host.shadowRoot;
    const input = shadow?.querySelector<HTMLInputElement>('input[type="number"]');
    const result = () => shadow?.querySelectorAll('output.genui-value-output')[1]?.textContent;
    if (!input) throw new Error('数值输入控件未渲染');

    fireEvent.change(input, { target: { value: '' } });
    await flushUi();
    expect(shadow?.querySelector('[role="status"]')?.textContent).toContain('请输入有限数字');
    expect(result()).toBe('4000 元');

    fireEvent.change(input, { target: { value: '6000' } });
    await flushUi();
    expect(shadow?.querySelector('[role="status"]')?.textContent).toContain('之间的值');
    expect(result()).toBe('4000 元');

    fireEvent.change(input, { target: { value: '1500' } });
    await flushUi();
    expect(shadow?.querySelector('[role="status"]')).toBeNull();
    expect(result()).toBe('3500 元');
  });

  it('数值输入遵守控件步长且拒绝步长不匹配的值', async () => {
    const host = mount(INTERACTIVE_DOC);
    const shadow = host.shadowRoot;
    const input = shadow?.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) throw new Error('数值输入控件未渲染');

    fireEvent.change(input, { target: { value: '1550' } });
    await flushUi();
    expect(shadow?.querySelector('[role="status"]')?.textContent).toContain('100 为步长');
    expect(shadow?.querySelectorAll('output.genui-value-output')[1]?.textContent).toBe('4000 元');
  });

  it('两张交互卡片的状态彼此隔离', async () => {
    const first = mount(INTERACTIVE_DOC);
    const second = mount(INTERACTIVE_DOC);
    const firstSlider = first.shadowRoot?.querySelector<HTMLInputElement>('input[type="range"]');
    if (!firstSlider) throw new Error('滑块未渲染');

    fireEvent.change(firstSlider, { target: { value: '7000' } });
    await flushUi();

    expect(first.shadowRoot?.querySelectorAll('output.genui-value-output')[1]?.textContent).toBe('6000 元');
    expect(second.shadowRoot?.querySelectorAll('output.genui-value-output')[1]?.textContent).toBe('4000 元');
  });
});

/**
 * Phase 4 P2 回归一：合法协议 ID 可以与 Object.prototype 的继承属性同名
 * （constructor、toString 等）。所有以 ID 为键的状态/草稿/错误/计算结果
 * 读取都必须只命中自有属性，否则输入框与派生值显示异常。
 */
const PROTOTYPE_ID_DOC: GenuiDocument = {
  type: 'genui',
  version: 2,
  title: '原型同名 ID',
  state: [
    { id: 'constructor', label: '数量', kind: 'number', initial: 42, min: 0, max: 100, step: 1 },
  ],
  derived: [
    {
      id: 'toString',
      label: '翻倍',
      expression: {
        op: 'add',
        left: { op: 'state', id: 'constructor' },
        right: { op: 'state', id: 'constructor' },
      },
    },
  ],
  elements: [
    { kind: 'number-input', bind: 'constructor' },
    { kind: 'value', label: '派生结果', source: { kind: 'derived', id: 'toString' } },
  ],
};

/**
 * Phase 4 P2 回归二：min=0、max=1e12、step=1 的大范围状态，
 * 1000000000.5 这种半步值必须被拒绝并保留最后一个有效状态。
 */
const BIG_RANGE_DOC: GenuiDocument = {
  type: 'genui',
  version: 2,
  title: '大范围步长',
  state: [
    {
      id: 'distance',
      label: '距离',
      kind: 'number',
      initial: 1000000000,
      min: 0,
      max: 1000000000000,
      step: 1,
      unit: '米',
    },
  ],
  derived: [
    {
      id: 'plusOne',
      label: '加一',
      unit: '米',
      expression: { op: 'add', left: { op: 'state', id: 'distance' }, right: { op: 'const', value: 1 } },
    },
  ],
  elements: [
    { kind: 'number-input', bind: 'distance' },
    { kind: 'value', label: '派生结果', source: { kind: 'derived', id: 'plusOne' } },
  ],
};

describe('回归：合法 ID 与 Object.prototype 同名（Phase 4 P2）', () => {
  it('constructor 输入显示初始值，toString 派生值正常渲染且无伪造错误', () => {
    const host = mount(PROTOTYPE_ID_DOC);
    const shadow = host.shadowRoot;
    const input = shadow?.querySelector<HTMLInputElement>('input[type="number"]');

    if (!input) throw new Error('数值输入控件未渲染（元素级边界可能拦截了渲染异常）');
    expect(shadowText(host)).not.toContain('该元素渲染失败');
    expect(input.value).toBe('42');
    expect(shadow?.querySelector('[role="status"]')).toBeNull();
    expect(shadow?.querySelector('.genui-runtime-error')).toBeNull();
    expect(shadow?.querySelector('output.genui-value-output')?.textContent).toBe('84');
  });

  it('原型同名 ID 的更新、错误恢复与重置', async () => {
    const host = mount(PROTOTYPE_ID_DOC);
    const shadow = host.shadowRoot;
    const input = shadow?.querySelector<HTMLInputElement>('input[type="number"]');
    const derived = () => shadow?.querySelector('output.genui-value-output')?.textContent;
    if (!input) throw new Error('数值输入控件未渲染');

    fireEvent.change(input, { target: { value: '50' } });
    await flushUi();
    expect(input.value).toBe('50');
    expect(derived()).toBe('100');

    fireEvent.change(input, { target: { value: '150' } });
    await flushUi();
    expect(shadow?.querySelector('[role="status"]')?.textContent).toContain('之间的值');
    expect(derived()).toBe('100');

    fireEvent.change(input, { target: { value: '60' } });
    await flushUi();
    expect(shadow?.querySelector('[role="status"]')).toBeNull();
    expect(derived()).toBe('120');

    shadow?.querySelector<HTMLButtonElement>('.genui-card-reset')?.click();
    await flushUi();
    expect(input.value).toBe('42');
    expect(derived()).toBe('84');
    expect(shadow?.querySelector('[role="status"]')).toBeNull();
  });

  it('原型同名 ID 的两张卡片状态彼此隔离', async () => {
    const first = mount(PROTOTYPE_ID_DOC);
    const second = mount(PROTOTYPE_ID_DOC);
    const firstInput = first.shadowRoot?.querySelector<HTMLInputElement>('input[type="number"]');
    const secondInput = second.shadowRoot?.querySelector<HTMLInputElement>('input[type="number"]');
    if (!firstInput || !secondInput) throw new Error('数值输入控件未渲染');

    fireEvent.change(firstInput, { target: { value: '70' } });
    await flushUi();

    expect(first.shadowRoot?.querySelector('output.genui-value-output')?.textContent).toBe('140');
    expect(second.shadowRoot?.querySelector('output.genui-value-output')?.textContent).toBe('84');
    expect(secondInput.value).toBe('42');
  });
});

describe('阶段 6 · 展开/收起（保留当前状态）', () => {
  it('默认展开；收起后 body 隐藏（aria-expanded=false），控件值与派生结果保留', async () => {
    const host = mount(INTERACTIVE_DOC);
    const shadow = host.shadowRoot;
    const expandButton = shadow?.querySelector<HTMLButtonElement>('button.genui-card-expand');
    if (!expandButton) throw new Error('展开按钮未渲染');

    expect(expandButton.getAttribute('aria-expanded')).toBe('true');
    const body = shadow?.querySelector('.genui-card-body');
    expect(body?.hasAttribute('hidden')).toBe(false);

    const slider = shadow?.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('滑动条未渲染');
    fireEvent.change(slider, {
      target: { value: '7000' },
    });
    await flushUi();

    expandButton.click();
    await flushUi();
    expect(expandButton.getAttribute('aria-expanded')).toBe('false');
    expect(expandButton.textContent).toContain('展开查看');
    expect(expandButton.textContent).not.toContain('收起');
    expect(body?.hasAttribute('hidden')).toBe(true);
    // React 树未卸载：控件值仍在 DOM 中（visibility 隐藏而不是销毁）。
    expect(shadow?.querySelector<HTMLInputElement>('input[type="range"]')?.value).toBe('7000');

    expandButton.click();
    await flushUi();
    expect(body?.hasAttribute('hidden')).toBe(false);
    expect(shadow?.querySelectorAll('output.genui-value-output')[1]?.textContent).toBe('6000 元');
  });

  it('收起后 footer 一并隐藏，展开后恢复', async () => {
    // 设计说明：收起视图只保留标题与展开按钮；重置/查看原始 JSON/继续讨论
    // 都随 body/footer 一起隐藏。展开后所有入口恢复，状态未丢。
    const host = mount(INTERACTIVE_DOC);
    const shadow = host.shadowRoot;
    const expandButton = shadow?.querySelector<HTMLButtonElement>('button.genui-card-expand');
    expandButton?.click();
    await flushUi();
    expect(shadow?.querySelector('.genui-card-footer')?.hasAttribute('hidden')).toBe(true);

    expandButton?.click();
    await flushUi();
    expect(shadow?.querySelector('.genui-card-footer')?.hasAttribute('hidden')).toBe(false);
  });

  it('收起时查看原始 JSON 状态互不影响：先折叠，原块切换仍由挂载方处理', async () => {
    const onToggleRaw = vi.fn();
    const host = mount(DOC, { onToggleRaw });
    const shadow = host.shadowRoot;
    const expandButton = shadow?.querySelector<HTMLButtonElement>('button.genui-card-expand');
    expandButton?.click();
    await flushUi();
    // 收起视图没有查看原文按钮（在 footer 中）——不得抛错或误触发。
    expect(onToggleRaw).not.toHaveBeenCalled();
    expect(expandButton?.getAttribute('aria-expanded')).toBe('false');
    expect(expandButton?.getAttribute('aria-controls')).toBeTruthy();
  });

  it('v1 静态卡片同样支持展开/收起', async () => {
    const host = mount(DOC);
    const expandButton = host.shadowRoot?.querySelector<HTMLButtonElement>('button.genui-card-expand');
    expect(expandButton).not.toBeNull();
    expandButton?.click();
    await flushUi();
    expect(host.shadowRoot?.querySelector('.genui-card-body')?.hasAttribute('hidden')).toBe(true);
  });
});

describe('阶段 6 · 继续讨论（用户主动触发）', () => {
  /** mount 带继续讨论回调的独立入口（CardProps.onContinue）。 */
  function mountWithContinue(
    doc: GenuiDocument,
    onContinue: (summary: string) => 'filled' | 'appended' | 'no-input' | 'unavailable',
  ): HTMLElement {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mounted = mountCard(host, { document: doc, rawJson: RAW, onContinue });
    return host;
  }

  function followupTextarea(shadow: ShadowRoot | null): HTMLTextAreaElement {
    const textarea = shadow?.querySelector<HTMLTextAreaElement>('.genui-followup-text');
    if (!textarea) throw new Error('继续讨论预览未渲染');
    return textarea;
  }

  it('v2/v3 卡片提供「继续讨论」按钮；v1 静态卡片不提供', () => {
    const interactive = mount(INTERACTIVE_DOC);
    expect(interactive.shadowRoot?.querySelector('.genui-card-followup')).not.toBeNull();

    const staticCard = mount(DOC);
    expect(staticCard.shadowRoot?.querySelector('.genui-card-followup')).toBeNull();
  });

  it('点击只打开可编辑预览，不立即写入输入框', async () => {
    const onContinue = vi.fn<(summary: string) => 'filled'>(() => 'filled');
    const host = mountWithContinue(INTERACTIVE_DOC, onContinue);
    const shadow = host.shadowRoot;
    // 先改变状态，摘要必须反映当前值而不是初始值。
    const slider = shadow?.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('滑动条未渲染');
    fireEvent.change(slider, {
      target: { value: '7000' },
    });
    await flushUi();

    shadow?.querySelector<HTMLButtonElement>('.genui-card-followup')?.click();
    await flushUi();

    expect(onContinue).not.toHaveBeenCalled();
    expect(shadow?.querySelector('.genui-followup')).not.toBeNull();
    const textarea = followupTextarea(shadow);
    expect(textarea.value).toContain('预算调整');
    expect(textarea.value).toContain('总预算：7000 元');
    expect(textarea.value).toContain('余额：6000 元');
  });

  it('把用户编辑后的摘要原样交给回调，并显示已填入反馈', async () => {
    const onContinue = vi.fn<(summary: string) => 'filled'>(() => 'filled');
    const host = mountWithContinue(INTERACTIVE_DOC, onContinue);
    const shadow = host.shadowRoot;
    shadow?.querySelector<HTMLButtonElement>('.genui-card-followup')?.click();
    await flushUi();

    const textarea = followupTextarea(shadow);
    fireEvent.change(textarea, { target: { value: '请解释一下总预算 5000 元是否够用。' } });
    await flushUi();
    shadow?.querySelector<HTMLButtonElement>('.genui-followup-apply')?.click();
    await flushUi();

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue.mock.calls[0][0]).toBe('请解释一下总预算 5000 元是否够用。');
    expect(shadow?.querySelector('.genui-followup')).toBeNull();
    const feedback = shadow?.querySelector('.genui-card-followup-feedback');
    expect(feedback?.textContent).toContain('已填入输入框');
    expect(feedback?.textContent).toContain('发送由你完成');
  });

  it('重复点击不覆盖已编辑的摘要', async () => {
    const onContinue = vi.fn<(summary: string) => 'filled'>(() => 'filled');
    const host = mountWithContinue(INTERACTIVE_DOC, onContinue);
    const shadow = host.shadowRoot;
    shadow?.querySelector<HTMLButtonElement>('.genui-card-followup')?.click();
    await flushUi();
    const textarea = followupTextarea(shadow);
    fireEvent.change(textarea, { target: { value: '编辑后的摘要' } });
    await flushUi();

    shadow?.querySelector<HTMLButtonElement>('.genui-card-followup')?.click();
    await flushUi();
    expect(followupTextarea(shadow).value).toBe('编辑后的摘要');
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('参数变化后关闭预览，避免旧快照配上新数值', async () => {
    const host = mountWithContinue(INTERACTIVE_DOC, vi.fn<(summary: string) => 'filled'>(() => 'filled'));
    const shadow = host.shadowRoot;
    shadow?.querySelector<HTMLButtonElement>('.genui-card-followup')?.click();
    await flushUi();
    expect(shadow?.querySelector('.genui-followup')).not.toBeNull();

    const slider = shadow?.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('滑动条未渲染');
    fireEvent.change(slider, { target: { value: '7100' } });
    await flushUi();
    expect(shadow?.querySelector('.genui-followup')).toBeNull();
  });

  it('页面无输入框时保留预览并反馈「未找到聊天输入框」', async () => {
    const onContinue = vi.fn<(summary: string) => 'no-input'>(() => 'no-input');
    const host = mountWithContinue(INTERACTIVE_DOC, onContinue);
    const shadow = host.shadowRoot;
    shadow?.querySelector<HTMLButtonElement>('.genui-card-followup')?.click();
    await flushUi();
    shadow?.querySelector<HTMLButtonElement>('.genui-followup-apply')?.click();
    await flushUi();

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(shadow?.querySelector('.genui-followup')).not.toBeNull();
    expect(shadow?.querySelector('.genui-card-followup-feedback')?.textContent).toContain('未找到聊天输入框');
  });

  it('已有草稿时反馈追加语义（草稿未被覆盖）', async () => {
    const onContinue = vi.fn<(summary: string) => 'appended'>(() => 'appended');
    const host = mountWithContinue(INTERACTIVE_DOC, onContinue);
    const shadow = host.shadowRoot;
    shadow?.querySelector<HTMLButtonElement>('.genui-card-followup')?.click();
    await flushUi();
    shadow?.querySelector<HTMLButtonElement>('.genui-followup-apply')?.click();
    await flushUi();
    const feedback = shadow?.querySelector('.genui-card-followup-feedback')?.textContent ?? '';
    expect(feedback).toContain('草稿已保留');
    expect(feedback).toContain('追加');
  });

  it('派生计算失败时摘要如实标注（继续讨论不带错误数值）', async () => {
    const onContinue = vi.fn<(summary: string) => 'filled'>(() => 'filled');
    const host = mountWithContinue(BIG_RANGE_DOC, onContinue);
    const shadow = host.shadowRoot;
    // 1e12 输入合法但派生 1e12+1 超出计算上限（阶段 4 严格规则）。
    const numberInput = shadow?.querySelector<HTMLInputElement>('input[type="number"]');
    if (!numberInput) throw new Error('数字输入未渲染');
    fireEvent.change(numberInput, {
      target: { value: '1000000000000' },
    });
    await flushUi();

    shadow?.querySelector<HTMLButtonElement>('.genui-card-followup')?.click();
    await flushUi();
    const textarea = followupTextarea(shadow);
    expect(textarea.value).toContain('加一：无法计算');
    // 不应把 1000000001 当成结果写进摘要。
    expect(textarea.value).not.toMatch(/加一：\d/);

    shadow?.querySelector<HTMLButtonElement>('.genui-followup-apply')?.click();
    await flushUi();
    expect(onContinue.mock.calls[0][0]).toContain('加一：无法计算');
  });
});

describe('阶段 6 · 表格筛选/选中项进入继续讨论摘要', () => {
  const TABLE_DOC: GenuiDocument = {
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
  };

  it('筛选并选中候选项后，摘要包含筛选、已选与对比', async () => {
    const onContinue = vi.fn<(summary: string) => 'filled'>(() => 'filled');
    const host = document.createElement('div');
    document.body.appendChild(host);
    mounted = mountCard(host, { document: TABLE_DOC, rawJson: RAW, onContinue });
    const shadow = host.shadowRoot;

    const filter = shadow?.querySelector<HTMLInputElement>('input[type="search"]');
    if (!filter) throw new Error('筛选框未渲染');
    fireEvent.change(filter, { target: { value: '在售' } });
    await flushUi();

    const radios = shadow?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios?.length).toBe(2);
    fireEvent.click(radios![1]!);
    await flushUi();

    shadow?.querySelector<HTMLButtonElement>('.genui-card-followup')?.click();
    await flushUi();
    expect(onContinue).not.toHaveBeenCalled();
    const textarea = shadow?.querySelector<HTMLTextAreaElement>('.genui-followup-text');
    if (!textarea) throw new Error('继续讨论预览未渲染');
    expect(textarea.value).toContain('表格「候选方案」');
    expect(textarea.value).toContain('筛选「在售」');
    expect(textarea.value).toContain('显示 2 / 2 行');
    expect(textarea.value).toContain('- 已选：C — 价格 5200 元；重量 1.3 kg');
    expect(textarea.value).toContain('- 对比：A — 价格 4800 元；重量 1.4 kg');
    expect(textarea.value).toContain('价格相差 400 元');

    shadow?.querySelector<HTMLButtonElement>('.genui-followup-apply')?.click();
    await flushUi();
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue.mock.calls[0][0]).toContain('筛选「在售」');
  });

  it('三行以上可见时按用户指定的对比项生成摘要', async () => {
    const table = TABLE_DOC.elements[0];
    if (!table || table.kind !== 'table') throw new Error('测试文档缺少表格');
    const threeRowDoc: GenuiDocument = {
      ...TABLE_DOC,
      elements: [
        {
          ...table,
          rows: [...table.rows, { cells: { name: 'B', price: 5600, weight: 1.6, status: '在售' } }],
        } as TableElement,
      ],
    };
    const onContinue = vi.fn<(summary: string) => 'filled'>(() => 'filled');
    const host = document.createElement('div');
    document.body.appendChild(host);
    mounted = mountCard(host, { document: threeRowDoc, rawJson: RAW, onContinue });
    const shadow = host.shadowRoot;

    const radios = shadow?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios?.length).toBe(3);
    fireEvent.click(radios![1]!);
    await flushUi();

    const compare = shadow?.querySelector<HTMLSelectElement>('.genui-table-compare select');
    if (!compare) throw new Error('对比项选择器未渲染');
    fireEvent.change(compare, { target: { value: '2' } });
    await flushUi();

    shadow?.querySelector<HTMLButtonElement>('.genui-card-followup')?.click();
    await flushUi();
    const textarea = shadow?.querySelector<HTMLTextAreaElement>('.genui-followup-text');
    if (!textarea) throw new Error('继续讨论预览未渲染');
    expect(textarea.value).toContain('- 已选：C — 价格 5200 元；重量 1.3 kg');
    expect(textarea.value).toContain('- 对比：B — 价格 5600 元；重量 1.6 kg');
    expect(textarea.value).toContain('价格相差 400 元；重量相差 0.3 kg');
  });

  it('切换讨论意图不覆盖用户已修改的预览，只替换结尾请求', async () => {
    const onContinue = vi.fn<(summary: string) => 'filled'>(() => 'filled');
    const host = document.createElement('div');
    document.body.appendChild(host);
    mounted = mountCard(host, { document: TABLE_DOC, rawJson: RAW, onContinue });
    const shadow = host.shadowRoot;

    const radios = shadow?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    fireEvent.click(radios![1]!);
    await flushUi();
    shadow?.querySelector<HTMLButtonElement>('.genui-card-followup')?.click();
    await flushUi();

    const textarea = shadow?.querySelector<HTMLTextAreaElement>('.genui-followup-text');
    if (!textarea) throw new Error('继续讨论预览未渲染');
    fireEvent.change(textarea, { target: { value: '我手写的摘要：请重点比较续航。' } });
    await flushUi();

    const compareIntent = Array.from(
      shadow?.querySelectorAll<HTMLButtonElement>('.genui-followup-intent') ?? [],
    ).find((button) => button.textContent === '比较两个方案');
    if (!compareIntent) throw new Error('比较意图按钮未渲染');
    fireEvent.click(compareIntent);
    await flushUi();

    expect(textarea.value.startsWith('我手写的摘要：请重点比较续航。')).toBe(true);
    expect(textarea.value).toContain('请比较以上两个候选方案的差异与取舍。');
    expect(shadow?.querySelector('.genui-followup-hint')?.textContent ?? '').toBeTruthy();
    expect(shadow?.querySelector('.genui-card-followup-feedback')?.textContent).toContain('已保留你的修改');
  });
});

describe('阶段 6 · 主题与展开的样例不受重置影响', () => {
  it('重置不改变展开/收起状态', async () => {
    const host = mount(INTERACTIVE_DOC);
    const shadow = host.shadowRoot;
    shadow?.querySelector<HTMLButtonElement>('button.genui-card-expand')?.click();
    await flushUi();
    shadow?.querySelector<HTMLButtonElement>('.genui-card-reset')?.click();
    await flushUi();
    expect(shadow?.querySelector('button.genui-card-expand')?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('回归：大步数步长校验（Phase 4 P2）', () => {
  it('拒绝半步输入并保留最后有效状态，接受合法大整数', async () => {
    const host = mount(BIG_RANGE_DOC);
    const shadow = host.shadowRoot;
    const input = shadow?.querySelector<HTMLInputElement>('input[type="number"]');
    const derived = () => shadow?.querySelector('output.genui-value-output')?.textContent;
    if (!input) throw new Error('数值输入控件未渲染');

    expect(input.value).toBe('1000000000');
    expect(derived()).toBe('1000000001 米');

    fireEvent.change(input, { target: { value: '1000000000.5' } });
    await flushUi();
    expect(shadow?.querySelector('[role="status"]')?.textContent).toContain('1 为步长');
    expect(derived()).toBe('1000000001 米');
    expect(input.value).toBe('1000000000.5');

    fireEvent.change(input, { target: { value: '1000000001' } });
    await flushUi();
    expect(shadow?.querySelector('[role="status"]')).toBeNull();
    expect(derived()).toBe('1000000002 米');

    fireEvent.change(input, { target: { value: '999999999999.5' } });
    await flushUi();
    expect(shadow?.querySelector('[role="status"]')?.textContent).toContain('1 为步长');
    expect(derived()).toBe('1000000002 米');

    fireEvent.change(input, { target: { value: '1000000000000' } });
    await flushUi();
    // 输入本身合法（等于状态上限），但派生结果 1e12+1 超出严格计算上限。
    expect(shadow?.querySelector('.genui-input-error')).toBeNull();
    expect(shadow?.querySelector('[role="status"]')?.textContent).toContain('结果超出可计算范围');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.value).toBe('1000000000000');
    expect(derived()).toBeUndefined();
  });
});

it('表格筛选与排序通过状态仓库在重新挂载后保留', async () => {
  const TABLE_DOC: GenuiDocument = {
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
  };
  const stateStore = createCardStateStore();
  const cardKey = 'card|1|test-session|vl:msg|0|hash';

  const firstHost = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(firstHost);
  const first = mountCard(firstHost, {
    document: TABLE_DOC,
    rawJson: JSON.stringify(TABLE_DOC),
    cardKey,
    stateStore,
  });
  const firstFilter = firstHost.shadowRoot?.querySelector<HTMLInputElement>('input[type="search"]');
  expect(firstFilter).not.toBeNull();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(firstFilter, '房租');
  firstFilter!.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await flushUi();
  expect(firstHost.shadowRoot?.textContent).toContain('显示 1 / 2 行');
  first.unmount();

  const secondHost = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(secondHost);
  const second = mountCard(secondHost, {
    document: TABLE_DOC,
    rawJson: JSON.stringify(TABLE_DOC),
    cardKey,
    stateStore,
  });
  const restoredFilter =
    secondHost.shadowRoot?.querySelector<HTMLInputElement>('input[type="search"]');
  expect(restoredFilter?.value).toBe('房租');
  expect(secondHost.shadowRoot?.textContent).toContain('显示 1 / 2 行');
  second.unmount();
});

describe('阶段 13 · 保存当前界面（issue #2 收尾）', () => {
  const SAVED_AT = 1_700_000_000_000;

  const TABLE_DOC: GenuiDocument = {
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
  };

  const saveOk = (): Promise<SavedStateSaveResult> =>
    Promise.resolve({ ok: true, savedAt: SAVED_AT, evicted: 0 });

  it('点击保存把当前值交给回调，成功后切换为「更新已保存的设置」并提供清除入口', async () => {
    const onSaveState = vi.fn(async (state: CardUiState) => {
      void state;
      return saveOk();
    });
    const host = mount(INTERACTIVE_DOC, {
      onSaveState,
      onClearSavedState: vi.fn(async (): Promise<SavedStateClearResult> => ({ ok: true })),
    });
    const shadow = host.shadowRoot;
    const slider = shadow?.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('滑块未渲染');
    fireEvent.change(slider, { target: { value: '7000' } });
    await flushUi();

    const save = shadow?.querySelector<HTMLButtonElement>('button.genui-card-save');
    expect(save?.textContent).toBe('保存当前界面');
    save?.click();
    await flushUi();
    await flushUi();

    expect(onSaveState).toHaveBeenCalledTimes(1);
    const saved = (onSaveState.mock.calls[0] as [CardUiState] | undefined)?.[0];
    expect(saved?.values.budget).toBe(7000);
    expect(saved?.values.category).toBe('food');
    expect(shadow?.querySelector('.genui-card-save-feedback')?.textContent).toContain(
      '已保存到本机，刷新后可恢复。',
    );
    expect(shadow?.querySelector('button.genui-card-save')?.textContent).toBe('更新已保存的设置');
    expect(shadow?.querySelector('button.genui-card-clear-saved')).not.toBeNull();
  });

  it('保存时一并带上表格筛选与排序视图', async () => {
    const onSaveState = vi.fn(async (state: CardUiState) => {
      void state;
      return saveOk();
    });
    const host = mount(TABLE_DOC, { onSaveState, savedAt: null });
    const filter = host.shadowRoot?.querySelector<HTMLInputElement>('input[type="search"]');
    if (!filter) throw new Error('筛选框未渲染');
    fireEvent.change(filter, { target: { value: '房租' } });
    await flushUi();

    host.shadowRoot?.querySelector<HTMLButtonElement>('button.genui-card-save')?.click();
    await flushUi();
    await flushUi();

    const saved = (onSaveState.mock.calls[0] as [CardUiState] | undefined)?.[0];
    const views = Object.values(saved?.tables ?? {});
    expect(views[0]?.filter).toBe('房租');
  });

  it('保存失败时如实显示原因，按钮文案保持未保存', async () => {
    const onSaveState = vi.fn(
      async (state: CardUiState): Promise<SavedStateSaveResult> => {
        void state;
        return { ok: false, message: '保存失败：本机存储不可用' };
      },
    );
    const host = mount(INTERACTIVE_DOC, { onSaveState });
    host.shadowRoot?.querySelector<HTMLButtonElement>('button.genui-card-save')?.click();
    await flushUi();
    await flushUi();

    expect(host.shadowRoot?.querySelector('.genui-card-save-feedback')?.textContent).toContain(
      '本机存储不可用',
    );
    expect(host.shadowRoot?.querySelector('button.genui-card-save')?.textContent).toBe(
      '保存当前界面',
    );
    expect(host.shadowRoot?.querySelector('button.genui-card-clear-saved')).toBeNull();
  });

  it('恢复保存记录时提示来源与「不会自动保存」', () => {
    const host = mount(INTERACTIVE_DOC, {
      savedAt: SAVED_AT,
      restoredAt: SAVED_AT,
      onSaveState: vi.fn(async (state: CardUiState) => {
      void state;
      return saveOk();
    }),
      onClearSavedState: vi.fn(async (): Promise<SavedStateClearResult> => ({ ok: true })),
    });

    const notice = host.shadowRoot?.querySelector('.genui-card-restored');
    expect(notice?.textContent).toContain('已恢复');
    expect(notice?.textContent).toContain('不会自动保存');
    expect(host.shadowRoot?.querySelector('button.genui-card-save')?.textContent).toBe(
      '更新已保存的设置',
    );
    expect(host.shadowRoot?.querySelector('button.genui-card-clear-saved')).not.toBeNull();
  });

  it('清除保存后回到未保存文案，当前界面值保持不变', async () => {
    const onClearSavedState = vi.fn(
      async (): Promise<SavedStateClearResult> => ({ ok: true }),
    );
    const host = mount(INTERACTIVE_DOC, {
      savedAt: SAVED_AT,
      onSaveState: vi.fn(async (state: CardUiState) => {
      void state;
      return saveOk();
    }),
      onClearSavedState,
    });
    const slider = host.shadowRoot?.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('滑块未渲染');
    fireEvent.change(slider, { target: { value: '7000' } });
    await flushUi();

    host.shadowRoot?.querySelector<HTMLButtonElement>('button.genui-card-clear-saved')?.click();
    await flushUi();
    await flushUi();

    expect(onClearSavedState).toHaveBeenCalledTimes(1);
    expect(host.shadowRoot?.querySelector('.genui-card-save-feedback')?.textContent).toContain(
      '已清除本机保存的设置；当前界面保持不变。',
    );
    expect(host.shadowRoot?.querySelector('button.genui-card-save')?.textContent).toBe(
      '保存当前界面',
    );
    expect(host.shadowRoot?.querySelector('button.genui-card-clear-saved')).toBeNull();
    expect(slider.value).toBe('7000');
  });

  it('未提供保存回调时不渲染保存与清除入口', () => {
    const host = mount(INTERACTIVE_DOC);
    expect(host.shadowRoot?.querySelector('button.genui-card-save')).toBeNull();
    expect(host.shadowRoot?.querySelector('button.genui-card-clear-saved')).toBeNull();
  });
});
