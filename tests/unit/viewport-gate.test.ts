import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createViewportGateAdapter,
  type IsBlockUnverifiable,
} from '../../src/content/viewport-gate';
import { createEnhancementManager } from '../../src/content/enhance';
import { createPageLifecycle } from '../../src/content/controller';
import type { ExtensionSettingsStore } from '../../src/content/settings';

/**
 * src/content/viewport-gate.ts 单测：适配器判定 + 与 EnhancementManager /
 * controller 的接线。jsdom 没有 IntersectionObserver，用可手控回调的替身。
 */

type GateEntry = Array<{ target: HTMLElement; isIntersecting: boolean }>;

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observed: HTMLElement[] = [];
  disconnectCalls = 0;

  constructor(
    public callback: (entries: GateEntry) => void,
    public options?: Record<string, unknown>,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: HTMLElement): void {
    this.observed.push(target);
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.observed = [];
  }

  emit(target: HTMLElement, isIntersecting: boolean): void {
    this.callback([{ target, isIntersecting }]);
  }
}

const originalObserver = (
  globalThis as unknown as { IntersectionObserver?: unknown }
).IntersectionObserver;

function winWith(observer: unknown): Window & typeof globalThis {
  return { IntersectionObserver: observer } as unknown as Window & typeof globalThis;
}

function codeBlock(id: string, raw: string): string {
  return `<div class="md-code-block" id="${id}"><div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div><pre><span>${raw}</span></pre></div>`;
}

/** findGenuiBlocks 只扫描 AI 回复容器；测试文档必须带同样的外壳。 */
function assistantDoc(body: string): Document {
  const doc = document.implementation.createHTMLDocument('gate test');
  doc.body.innerHTML = `<div class="ds-assistant-message-main-content" id="m">${body}</div>`;
  return doc;
}

const VALID_TEXT = (value: string): string =>
  JSON.stringify({ type: 'genui', version: 1, elements: [{ kind: 'text', value }] });

describe('viewport-gate 适配器', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
  });

  it('window 无 IntersectionObserver 时返回 null（jsdom 按旧规则判断）', () => {
    expect(createViewportGateAdapter(winWith(undefined), () => {})).toBeNull();
  });

  it('首见块返回不可验证并开始观察；确认相交后标记可见且只通知一次', () => {
    const onVerifiable = vi.fn();
    const adapter = createViewportGateAdapter(winWith(FakeIntersectionObserver), onVerifiable);
    expect(adapter).not.toBeNull();
    const block = document.createElement('div');

    expect(adapter!.isBlockUnverifiable(block)).toBe(true);
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    const observer = FakeIntersectionObserver.instances[0]!;
    expect(observer.observed).toEqual([block]);
    expect(onVerifiable).not.toHaveBeenCalled();

    // 不相交：既不理解锁也不回调。
    observer.emit(block, false);
    expect(onVerifiable).not.toHaveBeenCalled();
    expect(adapter!.isBlockUnverifiable(block)).toBe(true);

    // 相交：解锁并通知一次；之后再问直接按可验证处理。
    observer.emit(block, true);
    expect(onVerifiable).toHaveBeenCalledTimes(1);
    expect(onVerifiable).toHaveBeenCalledWith(block);
    expect(adapter!.isBlockUnverifiable(block)).toBe(false);

    observer.emit(block, true);
    expect(onVerifiable).toHaveBeenCalledTimes(1);
  });

  it('dispose 后停止观察', () => {
    const adapter = createViewportGateAdapter(winWith(FakeIntersectionObserver), () => {});
    const block = document.createElement('div');
    adapter!.isBlockUnverifiable(block);
    adapter!.dispose();
    const observer = FakeIntersectionObserver.instances[0]!;
    expect(observer.disconnectCalls).toBe(1);
  });

  it('threshold 配置为 0：一个像素相交即可验证', () => {
    createViewportGateAdapter(winWith(FakeIntersectionObserver), () => {});
    expect(FakeIntersectionObserver.instances[0]!.options).toEqual({ root: null, threshold: 0 });
  });
});

describe('EnhanceOptions.isBlockUnverifiable（视口门控失败出口）', () => {
  it('不可验证时不写失败状态、不建 host、不计入 failed 结果', () => {
    const doc = assistantDoc(codeBlock('b', '{"type":"genui",'));
    let verifiable = false;
    const isBlockUnverifiable: IsBlockUnverifiable = () => !verifiable;
    const manager = createEnhancementManager(doc, { isBlockUnverifiable });

    const first = manager.reconcile(true);
    expect(first).toEqual({ mounted: 0, skipped: 0, failed: 0 });

    const block = doc.querySelector<HTMLElement>('#b')!;
    expect(block.hasAttribute('data-genui-state')).toBe(false);
    expect(doc.querySelectorAll('[data-genui-host]')).toHaveLength(0);
    expect(block.style.display).toBe('');
    expect(doc.querySelectorAll('[data-genui-state]')).toHaveLength(0);

    // 用户滚动入场后按正常规则判定：非法文本如实标记失败。
    verifiable = true;
    const second = manager.reconcile(true);
    expect(second.failed).toBe(1);
    expect(block.getAttribute('data-genui-state')).toBe('failed');
    expect(block.getAttribute('data-genui-reason')).toBe('invalid-json');
  });

  it('文本有效：门控只管失败判定，视口外也正常挂载且幂等', () => {
    const doc = assistantDoc(codeBlock('b', VALID_TEXT('离屏补全后挂载')));
    let verifiable = false;
    const manager = createEnhancementManager(doc, { isBlockUnverifiable: () => !verifiable });

    // 解析失败才受门控约束：有效的块即使在视口外也按正常流程挂载，
    // 用户滚动到位时卡片已就绪。
    expect(manager.reconcile(true)).toEqual({ mounted: 1, skipped: 0, failed: 0 });
    const host = doc.querySelector<HTMLElement>('.genui-card-host');
    expect(host?.shadowRoot?.textContent).toContain('离屏补全后挂载');
    const block = doc.querySelector<HTMLElement>('#b')!;
    expect(block.getAttribute('data-genui-state')).toBe('mounted');
    expect(block.style.display).toBe('none');

    // 可见性解锁后再次协调：已挂载的块照常 skipped，不重复挂载。
    verifiable = true;
    expect(manager.reconcile(true)).toEqual({ mounted: 0, skipped: 1, failed: 0 });
    expect(doc.querySelectorAll('[data-genui-host]')).toHaveLength(1);
  });

  it('未开启门控时保持旧行为：解析失败立即标记', () => {
    const doc = assistantDoc(codeBlock('b', '{"type":"genui",'));
    const manager = createEnhancementManager(doc);

    expect(manager.reconcile(true).failed).toBe(1);
    expect(doc.querySelector('#b')?.getAttribute('data-genui-reason')).toBe('invalid-json');
  });

  it('defer 后站点补齐文本（新 signature）在解锁后成功挂载', () => {
    const doc = assistantDoc(codeBlock('b', '{"type":"genui","el'));
    let verifiable = false;
    const manager = createEnhancementManager(doc, { isBlockUnverifiable: () => !verifiable });

    expect(manager.reconcile(true).mounted).toBe(0);

    // 模拟站点在滚动后补全代码块文本与用户入场同时发生。
    doc.querySelector('#b pre span')!.textContent = VALID_TEXT('补全后的完整内容');
    verifiable = true;
    const result = manager.reconcile(true);

    expect(result).toEqual({ mounted: 1, skipped: 0, failed: 0 });
    expect(doc.querySelector('.genui-card-host')?.shadowRoot?.textContent).toContain('补全后的完整内容');
  });
});

describe('controller + viewport-gate 集成', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver =
      FakeIntersectionObserver;
    FakeIntersectionObserver.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    const holder = globalThis as unknown as { IntersectionObserver?: unknown };
    if (originalObserver === undefined) delete holder.IntersectionObserver;
    else holder.IntersectionObserver = originalObserver;
    document.body.innerHTML = '';
  });

  async function advance(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
  }

  function makeStore(initial?: boolean): ExtensionSettingsStore {
    let stored = initial;
    return {
      async loadGenuiEnabled() {
        return stored;
      },
      async saveGenuiEnabled(enabled) {
        stored = enabled;
      },
      subscribe() {
        return () => undefined;
      },
    };
  }

  const STORE: ExtensionSettingsStore = makeStore(true);

  it('离屏无效块不判失败；滚动入场并补齐文本后按正常规则挂载', async () => {
    const doc = assistantDoc(codeBlock('late-block', '{"type":"genui","el'));
    const lifecycle = createPageLifecycle(doc, {
      store: STORE,
      window,
      debounceMs: 10,
      settleMs: 40,
      enableViewportGate: true,
    });

    await lifecycle.start();
    await advance(80);
    const block = doc.querySelector<HTMLElement>('#late-block')!;
    expect(block.hasAttribute('data-genui-state')).toBe(false);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);

    // 站点在滚动后补齐文本，块同时进入视口：适配器解锁并重排立即扫描。
    doc.querySelector('#late-block pre span')!.textContent = VALID_TEXT('补齐后的完整内容');
    const observer = FakeIntersectionObserver.instances.at(-1)!;
    observer.emit(block, true);
    // 新签名重开 40ms 稳定窗 + 首扫 settle 40ms，80ms 覆盖整个链路。
    await advance(80);

    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(1);
    expect(block.getAttribute('data-genui-state')).toBe('mounted');
    lifecycle.dispose();
  });

  it('离屏无效块解锁且文本仍非法时如实标记 failed', async () => {
    const doc = assistantDoc(codeBlock('bad-block', '{"type":"genui",'));
    const lifecycle = createPageLifecycle(doc, {
      store: STORE,
      window,
      debounceMs: 10,
      settleMs: 40,
      enableViewportGate: true,
    });

    await lifecycle.start();
    await advance(80);
    const block = doc.querySelector<HTMLElement>('#bad-block')!;
    expect(block.hasAttribute('data-genui-state')).toBe(false);

    const observer = FakeIntersectionObserver.instances.at(-1)!;
    observer.emit(block, true);
    await advance(30);

    expect(block.getAttribute('data-genui-state')).toBe('failed');
    expect(block.getAttribute('data-genui-reason')).toBe('invalid-json');
    expect(block.style.display).toBe('');
    lifecycle.dispose();
  });

  it('未开启 enableViewportGate 的旧配置不受影响', async () => {
    const doc = assistantDoc(codeBlock('plain-block', '{"type":"genui",'));
    const lifecycle = createPageLifecycle(doc, {
      store: STORE,
      window,
      debounceMs: 10,
      settleMs: 40,
    });

    await lifecycle.start();
    await advance(80);

    const block = doc.querySelector<HTMLElement>('#plain-block')!;
    expect(block.getAttribute('data-genui-state')).toBe('failed');
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    lifecycle.dispose();
  });
});
