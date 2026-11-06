import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { GenuiDocument } from '../../src/protocol/types';
import { mountCard, type MountedCard } from '../../src/render/mount';

/**
 * issue #15：操作与辅助信息的呈现层级。
 *
 * 只锁定结构、关联与语义，不把具体像素写进单测：
 * - 「继续讨论」是唯一直接可见的主操作，重置留在同一个操作组里但更轻；
 * - 原始 JSON 与插件技术说明收进默认收起的原生 details「界面详情」；
 * - 反馈仍出现在触发操作附近，失败提示不进入详情；
 * - 详情开合属本地视图状态，卡片参数、草稿与当前结果不因查看详情丢失；
 * - 收起卡片后页脚整体隐藏，详情内的控件不留在可见层。
 */

const V2_DOC: GenuiDocument = {
  type: 'genui',
  version: 2,
  title: '预算规划',
  state: [
    { id: 'budget', label: '总预算', kind: 'number', initial: 5000, min: 0, max: 10000, step: 100, unit: '元' },
    { id: 'spent', label: '已支出', kind: 'number', initial: 1000, min: 0, max: 5000, step: 100, unit: '元' },
  ],
  derived: [
    {
      id: 'remaining',
      label: '余额',
      unit: '元',
      expression: {
        op: 'subtract',
        left: { op: 'state', id: 'budget' },
        right: { op: 'state', id: 'spent' },
      },
    },
  ],
  elements: [
    { kind: 'number-input', bind: 'budget' },
    { kind: 'value', label: '余额', source: { kind: 'derived', id: 'remaining' } },
  ],
};

const V1_DOC: GenuiDocument = {
  type: 'genui',
  version: 1,
  title: '静态说明',
  elements: [{ kind: 'text', value: '只有文本' }],
};

let mounted: MountedCard | null = null;

interface MountOptions {
  onToggleRaw?: (showRaw: boolean) => void;
  onContinue?: (summary: string) => 'filled' | 'appended' | 'no-input' | 'unavailable';
  onSaveState?: () => Promise<{ ok: true; savedAt: number; evicted: number }>;
  onClearSavedState?: () => Promise<{ ok: true }>;
  savedAt?: number | null;
}

function mount(doc: GenuiDocument = V2_DOC, options: MountOptions = {}): ShadowRoot {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mounted = mountCard(host, {
    document: doc,
    rawJson: JSON.stringify(doc),
    onToggleRaw: options.onToggleRaw,
    onContinue: options.onContinue,
    onSaveState: options.onSaveState,
    onClearSavedState: options.onClearSavedState,
    savedAt: options.savedAt,
  });
  const root = host.shadowRoot;
  expect(root).not.toBeNull();
  return root!;
}

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function footer(root: ShadowRoot): HTMLElement {
  const element = root.querySelector<HTMLElement>('.genui-card-footer');
  if (!element) throw new Error('页脚未渲染');
  return element;
}

function details(root: ShadowRoot): HTMLDetailsElement {
  const element = root.querySelector<HTMLDetailsElement>('details.genui-card-details');
  if (!element) throw new Error('界面详情未渲染');
  return element;
}

function summary(root: ShadowRoot): HTMLElement {
  const element = details(root).querySelector<HTMLElement>('summary');
  if (!element) throw new Error('界面详情摘要未渲染');
  return element;
}

function toggle(root: ShadowRoot): HTMLButtonElement {
  const element = root.querySelector<HTMLButtonElement>('button.genui-card-toggle');
  if (!element) throw new Error('原始 JSON 入口未渲染');
  return element;
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.replaceChildren();
});

describe('issue #15 · 页脚操作按主次分组', () => {
  it('「继续讨论」是操作组首位，重置与保存/清除保存同组随后', () => {
    const root = mount(V2_DOC, {
      onSaveState: async () => ({ ok: true, savedAt: 1, evicted: 0 }),
      onClearSavedState: async () => ({ ok: true }),
      savedAt: 1,
    });

    const actions = footer(root).querySelector<HTMLElement>('.genui-card-actions');
    expect(actions).not.toBeNull();
    expect(actions?.getAttribute('role')).toBe('group');
    expect(actions?.getAttribute('aria-label')).toBe('界面操作');

    const order = Array.from(actions?.children ?? []).map((element) => element.className);
    expect(order).toEqual([
      'genui-card-followup',
      'genui-card-reset',
      'genui-card-save',
      'genui-card-clear-saved',
    ]);

    // 直接可见的主操作与较轻的重置都不在详情里。
    expect(details(root).contains(actions?.firstElementChild ?? null)).toBe(false);
    expect(root.querySelector('.genui-card-reset')?.closest('details')).toBeNull();
  });

  it('重置仍是可直接操作的原生按钮，并保持可访问名称', () => {
    const root = mount(V2_DOC);
    const reset = root.querySelector<HTMLButtonElement>('button.genui-card-reset');

    expect(reset).not.toBeNull();
    expect(reset?.type).toBe('button');
    expect(reset?.disabled).toBe(false);
    expect(reset?.textContent).toBe('重置当前界面');
  });
});

describe('issue #15 · 界面详情（原始 JSON 与技术说明）', () => {
  it('使用默认收起的原生 details，摘要为「界面详情」', () => {
    const root = mount(V2_DOC);
    const disclosure = details(root);

    expect(disclosure.tagName).toBe('DETAILS');
    expect(disclosure.hasAttribute('open')).toBe(false);
    expect(summary(root).textContent).toBe('界面详情');
    expect(disclosure.firstElementChild).toBe(summary(root));
  });

  it('原始 JSON 入口与技术说明都收进详情，默认不在可见层', () => {
    const root = mount(V2_DOC);
    const disclosure = details(root);
    const rawToggle = toggle(root);
    const note = disclosure.querySelector('.genui-card-note');

    expect(disclosure.contains(rawToggle)).toBe(true);
    expect(rawToggle.closest('.genui-card-details-body')).not.toBeNull();
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain('透明增强');
    expect(note?.textContent).toContain('不执行脚本');
    expect(note?.textContent).toContain('原始');
    // 技术说明只在详情里出现一次，不再单独占据页脚首行。
    expect(root.querySelectorAll('.genui-card-note')).toHaveLength(1);
  });

  it('详情可由键盘可聚焦的 summary 展开，展开后原始 JSON 入口可用', async () => {
    const onToggleRaw = vi.fn();
    const root = mount(V2_DOC, { onToggleRaw });

    summary(root).click();
    await flushUi();
    expect(details(root).open).toBe(true);

    toggle(root).click();
    await flushUi();
    expect(onToggleRaw).toHaveBeenCalledWith(true);
    expect(toggle(root).textContent).toBe('收起原始 JSON');
    expect(details(root).open).toBe(true);
  });

  it('切换原始 JSON 后能返回，卡片参数与当前结果不丢', async () => {
    const onToggleRaw = vi.fn();
    const root = mount(V2_DOC, { onToggleRaw });
    const input = root.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) throw new Error('数字输入未渲染');

    fireEvent.change(input, { target: { value: '7000' } });
    await flushUi();
    expect(root.querySelector('.genui-value-output')?.textContent).toBe('6000 元');

    summary(root).click();
    await flushUi();
    toggle(root).click();
    await flushUi();
    expect(onToggleRaw).toHaveBeenLastCalledWith(true);
    expect(input.value).toBe('7000');

    // 收起详情再打开，仍能回到「查看原始 JSON」并保留当前参数。
    summary(root).click();
    await flushUi();
    expect(details(root).open).toBe(false);
    summary(root).click();
    await flushUi();
    toggle(root).click();
    await flushUi();
    expect(onToggleRaw).toHaveBeenLastCalledWith(false);
    expect(toggle(root).textContent).toBe('查看原始 JSON');
    expect(input.value).toBe('7000');
    expect(root.querySelector('.genui-value-output')?.textContent).toBe('6000 元');
  });

  it('收起卡片后页脚（含详情）整体隐藏，重新展开保留详情开合状态', async () => {
    const root = mount(V2_DOC);
    const expand = root.querySelector<HTMLButtonElement>('button.genui-card-expand');
    if (!expand) throw new Error('展开按钮未渲染');

    summary(root).click();
    await flushUi();
    expect(details(root).open).toBe(true);

    expand.click();
    await flushUi();
    expect(footer(root).hasAttribute('hidden')).toBe(true);
    expect(details(root).closest('[hidden]')).toBe(footer(root));

    expand.click();
    await flushUi();
    expect(footer(root).hasAttribute('hidden')).toBe(false);
    expect(details(root).open).toBe(true);
  });
});

describe('issue #15 · 反馈与轻量重置', () => {
  it('继续讨论的反馈出现在操作附近、详情之外，并保留 role=status', async () => {
    const onContinue = vi.fn<(summary: string) => 'no-input'>(() => 'no-input');
    const root = mount(V2_DOC, { onContinue });

    fireEvent.click(root.querySelector<HTMLElement>('.genui-card-followup')!);
    await flushUi();
    fireEvent.click(root.querySelector<HTMLElement>('.genui-followup-apply')!);
    await flushUi();

    const feedback = footer(root).querySelector<HTMLElement>('.genui-card-followup-feedback');
    expect(feedback).not.toBeNull();
    expect(feedback?.getAttribute('role')).toBe('status');
    expect(feedback?.textContent).toContain('未找到聊天输入框');
    expect(details(root).contains(feedback)).toBe(false);
    // 反馈紧跟在操作组之后、详情之前。
    expect(feedback?.previousElementSibling?.className).toBe('genui-card-actions');
    expect(
      (feedback?.compareDocumentPosition(details(root)) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('重置仍清除本地输入错误并恢复初始值', async () => {
    const root = mount(V2_DOC);
    const input = root.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) throw new Error('数字输入未渲染');

    fireEvent.change(input, { target: { value: '20000' } });
    await flushUi();
    expect(root.querySelector('.genui-input-error')).not.toBeNull();

    fireEvent.click(root.querySelector<HTMLElement>('.genui-card-reset')!);
    await flushUi();
    expect(input.value).toBe('5000');
    expect(root.querySelector('.genui-input-error')).toBeNull();
    expect(root.querySelector('.genui-value-output')?.textContent).toBe('4000 元');
  });
});

describe('issue #15 · v1 静态卡片', () => {
  it('没有继续讨论与重置，但仍可展开详情查看原始 JSON', async () => {
    const onToggleRaw = vi.fn();
    const root = mount(V1_DOC, { onToggleRaw });

    expect(root.querySelector('.genui-card-followup')).toBeNull();
    expect(root.querySelector('.genui-card-reset')).toBeNull();
    expect(details(root).hasAttribute('open')).toBe(false);

    summary(root).click();
    await flushUi();
    toggle(root).click();
    await flushUi();
    expect(onToggleRaw).toHaveBeenCalledWith(true);
    expect(toggle(root).textContent).toBe('收起原始 JSON');
  });
});

describe('issue #15 · 样式契约（只锁定层级差异，不锁定像素）', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/render/card.css'), 'utf8');

  function ruleBody(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    expect(match, `缺少 ${selector} 规则`).not.toBeNull();
    return match?.[1] ?? '';
  }

  it('「继续讨论」用主色承担主操作，重置为无边框次要文字按钮', () => {
    const primary = ruleBody('.genui-card-followup');
    expect(primary).toContain('var(--genui-color-accent-border)');
    expect(primary).toContain('var(--genui-color-accent-soft)');
    expect(primary).toContain('font-weight: 600');

    const quiet = ruleBody('.genui-card-reset');
    expect(quiet).toContain('border: 1px solid transparent');
    expect(quiet).toContain('var(--genui-color-text-muted)');
    expect(quiet).not.toContain('accent');
  });

  it('重复的 GenUI 文字标记不再使用描边胶囊，详情摘要具备指针与焦点反馈', () => {
    const badge = ruleBody('.genui-card-badge');
    expect(badge).toContain('var(--genui-color-text-muted)');
    expect(badge).not.toContain('999px');

    expect(ruleBody('.genui-card-details-summary')).toContain('cursor: pointer');
    expect(css).toContain('.genui-card-details-summary:focus-visible');
  });
});
