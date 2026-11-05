import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageLifecycle, isGenerationActive, STOP_GENERATION_PATH_PREFIX } from '../../src/content/controller';
import type { ExtensionSettingsStore } from '../../src/content/settings';
import { hashString } from '../../src/runtime/hash';
import type { GenuiDocument } from '../../src/protocol/types';
import {
  UNKNOWN_ACCOUNT_ID,
  UNKNOWN_SESSION_ID,
  createCardKey,
} from '../../src/content/identity';
import {
  CARD_STATE_VERSION,
  documentStateSignature,
  type SavedCardState,
} from '../../src/runtime/card-state';
import {
  SAVED_STATE_KEY_PREFIX,
  createSavedStateStore,
  type SavedStateStorageArea,
} from '../../src/runtime/saved-card-state-store';

const VALID = (value: string): string =>
  JSON.stringify({ type: 'genui', version: 1, elements: [{ kind: 'text', value }] });

function codeBlock(id: string, raw: string): string {
  return `<div class="md-code-block" id="${id}"><div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div><pre><span>${raw}</span></pre></div>`;
}

function assistant(id: string, raw: string): string {
  return `<div class="ds-assistant-message-main-content" id="${id}">${codeBlock(`${id}-block`, raw)}</div>`;
}

function buildDoc(body: string): Document {
  const doc = document.implementation.createHTMLDocument('lifecycle test');
  doc.body.innerHTML = body;
  return doc;
}

function firstCardText(doc: Document): string {
  return doc.querySelector('.genui-card-host')?.shadowRoot?.textContent ?? '';
}

function stopControl(): string {
  return `<div id="stop" role="button" aria-label="停止生成"><svg><path d="${STOP_GENERATION_PATH_PREFIX} rest" /></svg></div>`;
}

function makeStore(initial?: boolean): ExtensionSettingsStore & {
  value: () => boolean | undefined;
  subscriberCount: () => number;
} {
  let stored = initial;
  const listeners = new Set<(enabled: boolean) => void>();
  return {
    async loadGenuiEnabled() {
      return stored;
    },
    async saveGenuiEnabled(enabled) {
      stored = enabled;
      for (const listener of listeners) listener(enabled);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    value: () => stored,
    subscriberCount: () => listeners.size,
  };
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
}

describe('页面生命周期控制器', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('生成中不解析或标记不完整 JSON；停止后内容稳定才挂载', async () => {
    const doc = buildDoc(stopControl() + assistant('streaming', '{"type":"genui",'));
    const store = makeStore();
    const lifecycle = createPageLifecycle(doc, {
      store,
      window,
      debounceMs: 10,
      settleMs: 50,
    });

    await lifecycle.start();
    await advance(200);
    const block = doc.querySelector<HTMLElement>('#streaming-block');
    expect(isGenerationActive(doc)).toBe(true);
    doc.querySelector('#stop')?.removeAttribute('aria-label');
    expect(isGenerationActive(doc)).toBe(true); // 图标路径作为语义属性之外的回退
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    expect(block?.hasAttribute('data-genui-state')).toBe(false);

    block!.querySelector('pre span')!.textContent = VALID('完整回复');
    await advance(100);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    expect(block?.hasAttribute('data-genui-state')).toBe(false);

    doc.querySelector('#stop')?.remove();
    await advance(80);
    expect(isGenerationActive(doc)).toBe(false);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(1);
    expect(firstCardText(doc)).toContain('完整回复');

    lifecycle.dispose();
  });

  it('新回答生成期间保留未变化的历史卡片与已调整的值', async () => {
    const sliderDoc = JSON.stringify({
      type: 'genui',
      version: 2,
      title: '预算',
      state: [
        { id: 'budget', label: '预算', kind: 'number', initial: 5000, min: 0, max: 10000, step: 100, unit: '元' },
      ],
      derived: [],
      elements: [
        { kind: 'slider', bind: 'budget' },
        { kind: 'value', label: '当前预算', source: { kind: 'state', id: 'budget' } },
      ],
    });
    const doc = buildDoc(assistant('history', sliderDoc));
    const lifecycle = createPageLifecycle(doc, {
      store: makeStore(true),
      window,
      debounceMs: 10,
      settleMs: 40,
    });
    await lifecycle.start();
    await advance(60);

    const host = doc.querySelector<HTMLElement>('.genui-card-host');
    expect(host).not.toBeNull();
    const slider = host?.shadowRoot?.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider).not.toBeNull();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(slider, '7000');
    slider!.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await advance(20);
    expect(host?.shadowRoot?.textContent).toContain('7000');

    doc.body.insertAdjacentHTML('beforeend', stopControl());
    doc.body.insertAdjacentHTML('beforeend', assistant('streaming', '{"type":"genui",'));
    await advance(200);

    expect(isGenerationActive(doc)).toBe(true);
    expect(host?.isConnected).toBe(true);
    const kept = doc.querySelector<HTMLElement>('.genui-card-host');
    expect(kept).toBe(host);
    expect(kept?.shadowRoot?.textContent).toContain('7000');

    doc.querySelector('#stop')?.remove();
    await advance(120);
    expect(host?.isConnected).toBe(true);
    expect(host?.shadowRoot?.textContent).toContain('7000');

    lifecycle.dispose();
  });

  it('生成期间只撤下当前回复的卡片，历史回答保持挂载', async () => {
    const doc = buildDoc(
      assistant('history', VALID('历史回答')) + assistant('streaming', VALID('正在生成')),
    );
    const lifecycle = createPageLifecycle(doc, {
      store: makeStore(true),
      window,
      debounceMs: 10,
      settleMs: 40,
    });

    await lifecycle.start();
    await advance(80);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(2);

    doc.body.insertAdjacentHTML('beforeend', stopControl());
    await advance(40);

    expect(isGenerationActive(doc)).toBe(true);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(1);
    const historyBlock = doc.querySelector<HTMLElement>('#history-block')!;
    const streamingBlock = doc.querySelector<HTMLElement>('#streaming-block')!;
    expect(historyBlock.previousElementSibling?.hasAttribute('data-genui-host')).toBe(true);
    expect(historyBlock.getAttribute('data-genui-state')).toBe('mounted');
    expect(streamingBlock.getAttribute('data-genui-status')).toBe('pending');
    expect(streamingBlock.hasAttribute('data-genui-state')).toBe(false);

    lifecycle.dispose();
  });

  it('回复改写与会话节点替换会卸载旧卡片并只挂载当前节点', async () => {
    const doc = buildDoc(assistant('session-a', VALID('第一版')));
    const lifecycle = createPageLifecycle(doc, {
      store: makeStore(true),
      window,
      debounceMs: 10,
      settleMs: 40,
    });
    await lifecycle.start();
    await advance(60);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(1);

    const firstBlock = doc.querySelector<HTMLElement>('#session-a-block')!;
    firstBlock.querySelector('pre span')!.textContent = VALID('重新生成结果');
    await advance(70);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(1);
    expect(firstCardText(doc)).toContain('重新生成结果');
    expect(firstCardText(doc)).not.toContain('第一版');

    doc.querySelector('#session-a')?.remove();
    await advance(20);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);

    doc.body.insertAdjacentHTML('beforeend', assistant('session-b', VALID('新会话')));
    await advance(60);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(1);
    expect(firstCardText(doc)).toContain('新会话');

    lifecycle.dispose();
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    expect(doc.querySelector('#session-b-block')?.getAttribute('data-genui-state')).toBeNull();
  });

  it('总开关立即恢复原始块、跨页面保存状态，并在重新开启后继续扫描', async () => {
    const store = makeStore(true);
    const firstDoc = buildDoc(assistant('first', VALID('第一张卡片')));
    const first = createPageLifecycle(firstDoc, {
      store,
      window,
      debounceMs: 10,
      settleMs: 40,
    });
    await first.start();
    await advance(60);
    const block = firstDoc.querySelector<HTMLElement>('#first-block')!;
    expect(firstDoc.querySelectorAll('.genui-card-host')).toHaveLength(1);

    const button = firstDoc.querySelector('[data-genui-control]')?.shadowRoot?.querySelector('button');
    button?.click();
    expect(store.value()).toBe(false);
    expect(firstDoc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    expect(block.style.display).not.toBe('none');
    expect(block.hasAttribute('data-genui-state')).toBe(false);

    const secondDoc = buildDoc(assistant('second', VALID('第二张卡片')));
    const second = createPageLifecycle(secondDoc, {
      store,
      window,
      debounceMs: 10,
      settleMs: 40,
    });
    await second.start();
    await advance(100);
    expect(second.isEnabled()).toBe(false);
    expect(secondDoc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    expect(secondDoc.querySelector('[data-genui-control]')?.shadowRoot?.textContent).toContain('GenUI 已关闭');

    secondDoc.querySelector('[data-genui-control]')?.shadowRoot?.querySelector('button')?.click();
    await advance(60);
    expect(store.value()).toBe(true);
    expect(secondDoc.querySelectorAll('.genui-card-host')).toHaveLength(1);

    first.dispose();
    second.dispose();
  });

  it('无关 DOM 变化不会缩短默认的 700ms 内容稳定等待', async () => {
    const doc = buildDoc(
      assistant('stable', VALID('等待完整')) + '<div id="unrelated"></div>',
    );
    const lifecycle = createPageLifecycle(doc, { store: null, window });
    await lifecycle.start();

    await advance(50);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    doc.querySelector('#unrelated')!.className = 'changed-but-unrelated';
    await advance(120);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);

    // The initial stable snapshot was first observed at 0ms; mutations at 50ms
    // may cause a scan at 150ms, but cannot replace the 700ms settle deadline.
    await advance(529);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    await advance(1);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(1);

    lifecycle.dispose();
  });

  it('断开后复用的消息节点在关闭增强时恢复原始代码块', async () => {
    const doc = buildDoc(assistant('reused', VALID('可复用内容')));
    const lifecycle = createPageLifecycle(doc, {
      store: null,
      window,
      debounceMs: 10,
      settleMs: 40,
    });
    await lifecycle.start();
    await advance(60);

    const reply = doc.querySelector<HTMLElement>('#reused')!;
    const block = doc.querySelector<HTMLElement>('#reused-block')!;
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(1);
    reply.remove();
    await advance(60);
    doc.body.append(reply);
    await advance(60);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(1);

    lifecycle.setEnabled(false);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    expect(block.style.display).not.toBe('none');
    expect(block.hasAttribute('data-genui-state')).toBe(false);

    lifecycle.dispose();
  });

  it('pagehide 清理 Observer 和挂载，BFCache pageshow 后重新接管', async () => {
    const doc = buildDoc(assistant('persisted-a', VALID('返回页面')));
    const store = makeStore(true);
    const lifecycle = createPageLifecycle(doc, {
      store,
      window,
      debounceMs: 10,
      settleMs: 40,
    });
    await lifecycle.start();
    await advance(60);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(1);
    expect(store.subscriberCount()).toBe(1);

    window.dispatchEvent(new Event('pagehide'));
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    expect(doc.querySelector('[data-genui-control]')).toBeNull();
    expect(store.subscriberCount()).toBe(0);

    doc.body.insertAdjacentHTML('beforeend', assistant('persisted-b', VALID('恢复观察')));
    await advance(100);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);

    const pageshow = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(pageshow, 'persisted', { value: true });
    window.dispatchEvent(pageshow);
    await Promise.resolve();
    await advance(60);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(2);
    expect(store.subscriberCount()).toBe(1);

    lifecycle.dispose();
    expect(store.subscriberCount()).toBe(0);
  });

  it('首次扫描前预载本机保存记录，首帧即恢复并提示来源', async () => {
    const document: GenuiDocument = {
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
    };
    const raw = JSON.stringify(document);
    const doc = buildDoc(
      `<div data-virtual-list-item-key="msg-1">${assistant('saved', raw)}</div>`,
    );

    const documentHash = hashString(raw);
    const saved: SavedCardState = {
      stateVersion: CARD_STATE_VERSION,
      documentHash,
      stateSignature: documentStateSignature(document),
      accountId: UNKNOWN_ACCOUNT_ID,
      sessionId: UNKNOWN_SESSION_ID,
      messageKey: 'msg-1',
      duplicateIndex: 0,
      savedAt: 1_700_000_000_000,
      values: { budget: 7000 },
      tables: {},
    };
    const cardKey = createCardKey({
      accountId: UNKNOWN_ACCOUNT_ID,
      sessionId: UNKNOWN_SESSION_ID,
      messageKey: 'msg-1',
      duplicateIndex: 0,
      documentHash,
    });
    const area: SavedStateStorageArea = {
      async get() {
        return { [`${SAVED_STATE_KEY_PREFIX}${cardKey}`]: saved };
      },
      async set() {},
      async remove() {},
    };

    const lifecycle = createPageLifecycle(doc, {
      store: makeStore(),
      window,
      savedStateStore: createSavedStateStore(area),
      debounceMs: 10,
      settleMs: 40,
    });
    await lifecycle.start();
    await advance(100);

    const host = doc.querySelector<HTMLElement>('.genui-card-host');
    expect(host).not.toBeNull();
    const root = host?.shadowRoot ?? null;
    // 若预载晚于首次扫描，这里会是初始值 5000 且没有恢复提示。
    expect(root?.querySelector<HTMLInputElement>('input[type="range"]')?.value).toBe('7000');
    expect(root?.querySelector('.genui-card-restored')?.textContent).toContain('保存的设置');

    lifecycle.dispose();
  });
});
