import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageLifecycle } from '../../src/content/controller';
import type { ExtensionSettingsStore } from '../../src/content/settings';
import { GENUI_PROMPT_TEXT } from '../../src/content/prompt';

/**
 * 阶段 7：默认增强与页面生命周期的集成。
 * 提示词必须是输入框中的可见草稿文本，关闭开关即移除，且从不触发发送。
 */

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

function buildDoc(): Document {
  const doc = document.implementation.createHTMLDocument('augment lifecycle');
  doc.body.innerHTML =
    '<textarea name="search" placeholder="给 DeepSeek 发送消息"></textarea>' +
    '<button id="send" type="button">发送</button>';
  return doc;
}

function type(doc: Document, value: string): void {
  const input = doc.querySelector<HTMLTextAreaElement>('textarea[name="search"]')!;
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
}

describe('默认增强与页面生命周期', () => {
  let lifecycle: ReturnType<typeof createPageLifecycle> | null = null;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    lifecycle?.dispose();
    lifecycle = null;
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('输入后追加可见提示词；面板展示同一份实际内容，关闭开关即移除', async () => {
    const doc = buildDoc();
    const send = doc.querySelector<HTMLButtonElement>('#send')!;
    const sendClick = vi.fn();
    send.addEventListener('click', sendClick);
    lifecycle = createPageLifecycle(doc, {
      store: makeStore(true),
      window,
      debounceMs: 10,
      settleMs: 20,
      augmentDelayMs: 30,
    });
    await lifecycle.start();

    type(doc, '帮我规划每月预算');
    await advance(29);
    expect(doc.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('帮我规划每月预算');

    await advance(1);
    const input = doc.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(input.value).toBe(`帮我规划每月预算\n\n${GENUI_PROMPT_TEXT}`);
    expect(sendClick).not.toHaveBeenCalled();

    const shadow = doc.querySelector('[data-genui-control]')?.shadowRoot;
    const buttons = shadow?.querySelectorAll('button') ?? [];
    expect(buttons[0]?.textContent).toBe('GenUI 已开启');
    expect(buttons[1]?.textContent).toBe('查看增强说明');

    buttons[1]?.click();
    const panel = shadow?.querySelector<HTMLElement>('.panel');
    expect(panel?.hasAttribute('hidden')).toBe(false);
    expect(panel?.querySelector('pre')?.textContent).toBe(GENUI_PROMPT_TEXT);
    expect(shadow?.textContent).toContain('状态：已追加到当前草稿');
    expect(shadow?.textContent).toContain('不会自动发送消息');

    buttons[0]?.click();
    expect(input.value).toBe('帮我规划每月预算');
    expect(doc.querySelector('[data-genui-control]')?.shadowRoot?.textContent).toContain(
      '状态：增强已关闭，不会追加',
    );
    expect(sendClick).not.toHaveBeenCalled();
  });

  it('Escape 关闭说明面板，不会改动草稿', async () => {
    const doc = buildDoc();
    lifecycle = createPageLifecycle(doc, {
      store: makeStore(true),
      window,
      debounceMs: 10,
      settleMs: 20,
      augmentDelayMs: 30,
    });
    await lifecycle.start();
    type(doc, '预算');
    await advance(30);

    const shadow = doc.querySelector('[data-genui-control]')?.shadowRoot;
    const input = doc.querySelector<HTMLTextAreaElement>('textarea')!;
    const before = input.value;
    shadow?.querySelectorAll('button')[1]?.click();
    const panel = shadow?.querySelector<HTMLElement>('.panel');
    expect(panel?.hasAttribute('hidden')).toBe(false);

    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel?.hasAttribute('hidden')).toBe(true);
    expect(input.value).toBe(before);
  });

  it('保存为关闭时启动不追加；用户重新开启后补齐当前草稿', async () => {
    const doc = buildDoc();
    lifecycle = createPageLifecycle(doc, {
      store: makeStore(false),
      window,
      debounceMs: 10,
      settleMs: 20,
      augmentDelayMs: 30,
    });
    await lifecycle.start();

    type(doc, '已有关闭设置的草稿');
    await advance(100);
    const input = doc.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(input.value).toBe('已有关闭设置的草稿');
    expect(doc.querySelector('[data-genui-control]')?.shadowRoot?.textContent).toContain('GenUI 已关闭');

    doc.querySelector('[data-genui-control]')?.shadowRoot?.querySelector('button')?.click();
    await advance(30);
    expect(input.value).toBe(`已有关闭设置的草稿\n\n${GENUI_PROMPT_TEXT}`);
  });
});
