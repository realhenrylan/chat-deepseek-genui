import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AugmentStatus,
  type DraftAugmenter,
  createDraftAugmenter,
} from '../../src/content/augment.ts';
import {
  BRIDGE_ENABLED_ATTR,
  BRIDGE_MODE_ATTR,
  BRIDGE_PENDING_REPAIR_ATTR,
  REQUEST_DELIVERED_EVENT,
  REQUEST_SENT_EVENT,
  readPendingRepairPrompt,
  writePendingRepairPrompt,
  type RequestSentDetail,
} from '../../src/content/bridge.ts';
import type { GenuiPromptMode } from '../../src/content/prompt.ts';

const makeDoc = (): Document => document.implementation.createHTMLDocument('genui-augment');

interface Harness {
  doc: Document;
  augmenter: DraftAugmenter;
  statuses: AugmentStatus[];
  modes: GenuiPromptMode[];
}

const createHarness = (
  doc: Document,
  overrides: Partial<Parameters<typeof createDraftAugmenter>[1]> = {},
): Harness => {
  const statuses: AugmentStatus[] = [];
  const modes: GenuiPromptMode[] = [];
  const augmenter = createDraftAugmenter(doc, {
    enabled: true,
    onStatus: (status) => statuses.push(status),
    onModeChange: (mode) => modes.push(mode),
    ...overrides,
  });
  return { doc, augmenter, statuses, modes };
};

const rootAttr = (doc: Document, name: string): string | null =>
  doc.documentElement.getAttribute(name);

const sendRequest = (doc: Document, detail?: Partial<RequestSentDetail>): void => {
  doc.dispatchEvent(new CustomEvent(REQUEST_SENT_EVENT, { detail }));
};

const delivered = (doc: Document, repairStashId: string | null): void => {
  doc.dispatchEvent(new CustomEvent(REQUEST_DELIVERED_EVENT, { detail: { repairStashId } }));
};

afterEach(() => {
  vi.useRealTimers();
});

describe('静默状态桥：开关与模式同步到 documentElement', () => {
  it('启动后写入 enabled/mode，并上报 ready', () => {
    const { doc, augmenter, statuses } = createHarness(makeDoc());
    augmenter.start();

    expect(rootAttr(doc, BRIDGE_ENABLED_ATTR)).toBe('true');
    expect(rootAttr(doc, BRIDGE_MODE_ATTR)).toBe('auto');
    expect(augmenter.getStatus()).toBe('ready');
    expect(augmenter.getMode()).toBe('auto');
    expect(augmenter.isEnabled()).toBe(true);
    expect(statuses.at(-1)).toBe('ready');
  });

  it('关闭后状态为 disabled，重新开启回到自动适配', () => {
    const { doc, augmenter, statuses, modes } = createHarness(makeDoc());
    augmenter.start();
    augmenter.setMode('plain');
    expect(augmenter.getStatus()).toBe('plain');

    augmenter.setEnabled(false);
    expect(rootAttr(doc, BRIDGE_ENABLED_ATTR)).toBe('false');
    expect(augmenter.getStatus()).toBe('disabled');
    expect(statuses.at(-1)).toBe('disabled');

    augmenter.setMode('tool');
    expect(rootAttr(doc, BRIDGE_MODE_ATTR)).toBe('tool');
    expect(augmenter.getStatus()).toBe('disabled');

    augmenter.setEnabled(true);
    expect(rootAttr(doc, BRIDGE_ENABLED_ATTR)).toBe('true');
    expect(rootAttr(doc, BRIDGE_MODE_ATTR)).toBe('auto');
    expect(augmenter.getMode()).toBe('auto');
    expect(augmenter.getStatus()).toBe('ready');
    expect(modes.at(-1)).toBe('auto');
  });

  it('模式切换回调与状态一一对应，非法值被忽略', () => {
    const { doc, augmenter, modes, statuses } = createHarness(makeDoc());
    augmenter.start();

    augmenter.setMode('tool');
    expect(rootAttr(doc, BRIDGE_MODE_ATTR)).toBe('tool');
    expect(modes.at(-1)).toBe('tool');
    expect(statuses.at(-1)).toBe('ready');

    augmenter.setMode('plain');
    expect(rootAttr(doc, BRIDGE_MODE_ATTR)).toBe('plain');
    expect(statuses.at(-1)).toBe('plain');

    augmenter.setMode('auto');
    expect(rootAttr(doc, BRIDGE_MODE_ATTR)).toBe('auto');
    expect(statuses.at(-1)).toBe('ready');

    augmenter.setMode('bogus' as GenuiPromptMode);
    expect(rootAttr(doc, BRIDGE_MODE_ATTR)).toBe('auto');
    expect(augmenter.getMode()).toBe('auto');
  });

  it('重复设置同一模式不会重复上报', () => {
    const { augmenter, modes } = createHarness(makeDoc());
    augmenter.start();
    augmenter.setMode('tool');
    augmenter.setMode('tool');
    expect(modes).toEqual(['tool']);
  });

  it('每次模式变化都会推进版本号，供拦截器忽略迟到事件', () => {
    const { doc, augmenter } = createHarness(makeDoc());
    augmenter.start();
    expect(doc.documentElement.getAttribute('data-genui-mode-rev')).toBe('0');

    augmenter.setMode('tool');
    expect(doc.documentElement.getAttribute('data-genui-mode-rev')).toBe('1');
    augmenter.setMode('tool');
    expect(doc.documentElement.getAttribute('data-genui-mode-rev')).toBe('1');
  });
});

describe('静默状态桥：不再触碰输入框草稿', () => {
  it('输入内容不会触发任何延迟改写', async () => {
    vi.useFakeTimers();
    const doc = makeDoc();
    doc.body.innerHTML =
      '<textarea name="search" placeholder="给 DeepSeek 发送消息"></textarea>';
    const input = doc.querySelector('textarea') as HTMLTextAreaElement;
    const { augmenter, statuses } = createHarness(doc);
    augmenter.start();

    input.value = '帮我把这段话总结一下';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(5000);

    expect(input.value).toBe('帮我把这段话总结一下');
    expect(statuses).toEqual(['ready']);
  });
});

describe('静默状态桥：单轮模式在请求发出后复位', () => {
  it('tool 模式在请求发出后复位为自动适配，暂存详情保留到送达', () => {
    const { doc, augmenter, modes } = createHarness(makeDoc());
    augmenter.start();
    augmenter.setMode('tool');
    const stash = writePendingRepairPrompt(doc.documentElement, '完整修复请求');
    expect(stash).not.toBeNull();

    sendRequest(doc, { mode: 'tool', modeRevision: 1, injected: true, repairStashId: stash?.id ?? null });

    expect(augmenter.getMode()).toBe('auto');
    expect(rootAttr(doc, BRIDGE_MODE_ATTR)).toBe('auto');
    expect(modes.at(-1)).toBe('auto');
    expect(readPendingRepairPrompt(doc.documentElement)).toBe('完整修复请求');
  });

  it('自动适配模式保持自动适配，不会触发模式回调', () => {
    const { doc, augmenter, modes } = createHarness(makeDoc());
    augmenter.start();

    sendRequest(doc, { mode: 'auto', modeRevision: 0, injected: true, repairStashId: null });

    expect(augmenter.getMode()).toBe('auto');
    expect(modes).toEqual([]);
  });

  it('旧请求的迟到事件不会复位新一轮选择', () => {
    const { doc, augmenter } = createHarness(makeDoc());
    augmenter.start();
    augmenter.setMode('tool');

    // 版本号 0 是上一轮请求留下的；当前已经推进到 1。
    sendRequest(doc, { mode: 'tool', modeRevision: 0, injected: true, repairStashId: null });

    expect(augmenter.getMode()).toBe('tool');
    expect(rootAttr(doc, BRIDGE_MODE_ATTR)).toBe('tool');
  });

  it('缺少 detail 或版本号的事件被忽略', () => {
    const { doc, augmenter } = createHarness(makeDoc());
    augmenter.start();
    doc.documentElement.setAttribute(BRIDGE_MODE_ATTR, 'plain');

    sendRequest(doc);
    expect(augmenter.getMode()).toBe('auto');
  });

  it('未启动或已停止时不响应事件', () => {
    const { doc, augmenter } = createHarness(makeDoc());
    augmenter.setMode('tool');

    sendRequest(doc, { mode: 'tool', modeRevision: 0, injected: true, repairStashId: null });
    expect(augmenter.getMode()).toBe('tool');

    augmenter.start();
    augmenter.stop();
    sendRequest(doc, { mode: 'tool', modeRevision: 0, injected: true, repairStashId: null });
    expect(augmenter.getMode()).toBe('tool');
  });

  it('重复 start 只注册一次监听', () => {
    const { doc, augmenter, modes } = createHarness(makeDoc());
    augmenter.start();
    augmenter.start();
    augmenter.setMode('tool');
    modes.length = 0;

    sendRequest(doc, { mode: 'tool', modeRevision: 1, injected: true, repairStashId: null });
    expect(augmenter.getMode()).toBe('auto');
    expect(modes).toEqual(['auto']);
  });
});

describe('静默状态桥：送达事件只清除对应暂存', () => {
  it('匹配 id 时清除，不匹配时保留用户新点的修复详情', () => {
    const { doc, augmenter } = createHarness(makeDoc());
    augmenter.start();
    const stash = writePendingRepairPrompt(doc.documentElement, '第一份修复详情');
    expect(stash).not.toBeNull();

    delivered(doc, 'other-id');
    expect(readPendingRepairPrompt(doc.documentElement)).toBe('第一份修复详情');

    delivered(doc, stash?.id ?? null);
    expect(rootAttr(doc, BRIDGE_PENDING_REPAIR_ATTR)).toBeNull();
  });

  it('没有暂存 id 的送达事件不会清除任何内容', () => {
    const { doc, augmenter } = createHarness(makeDoc());
    augmenter.start();
    writePendingRepairPrompt(doc.documentElement, '修复详情');

    delivered(doc, null);
    expect(readPendingRepairPrompt(doc.documentElement)).toBe('修复详情');
  });
});

describe('静默状态桥：订阅与销毁', () => {
  it('subscribe 收到后续状态变化，取消订阅后不再收到', () => {
    const { augmenter } = createHarness(makeDoc());
    const seen: AugmentStatus[] = [];
    const unsubscribe = augmenter.subscribe((status) => seen.push(status));
    augmenter.start();
    augmenter.setEnabled(false);
    expect(seen).toEqual(['ready', 'disabled']);

    unsubscribe();
    augmenter.setEnabled(true);
    expect(seen).toEqual(['ready', 'disabled']);
  });

  it('dispose 后停止监听并清空订阅者', () => {
    const { doc, augmenter } = createHarness(makeDoc());
    const seen: AugmentStatus[] = [];
    augmenter.subscribe((status) => seen.push(status));
    augmenter.start();
    augmenter.setMode('tool');
    seen.length = 0;

    augmenter.dispose();
    sendRequest(doc, { mode: 'tool', modeRevision: 1, injected: true, repairStashId: null });

    expect(augmenter.getMode()).toBe('tool');
    expect(seen).toEqual([]);
  });
});
