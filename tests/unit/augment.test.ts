import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDraftAugmenter,
  type DraftAugmenter,
} from '../../src/content/augment';
import { GENUI_PROMPT_START, GENUI_PROMPT_TEXT } from '../../src/content/prompt';

/**
 * 阶段 7：默认增强只追加可见草稿文本，绝不自动发送。
 * 关闭时必须恢复原文，但任何用户编辑都不能被覆盖。
 */

const USER = '帮我规划每月预算';
const DEBOUNCE = 100;

let augmenter: DraftAugmenter | null = null;

function createInput(value = ''): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  textarea.setAttribute('name', 'search');
  textarea.setAttribute('placeholder', '给 DeepSeek 发送消息');
  textarea.value = value;
  document.body.append(textarea);
  return textarea;
}

function createAugmenter(options: { enabled?: boolean } = {}): DraftAugmenter {
  augmenter = createDraftAugmenter(document, {
    enabled: options.enabled ?? true,
    debounceMs: DEBOUNCE,
    window,
  });
  augmenter.start();
  return augmenter;
}

function userTypes(textarea: HTMLTextAreaElement, value: string): void {
  textarea.value = value;
  textarea.setSelectionRange(value.length, value.length);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
}

describe('默认增强草稿接线', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    augmenter?.dispose();
    augmenter = null;
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('停止输入后把提示词追加到草稿末尾，光标停在说明之前', async () => {
    const input = createInput();
    const draft = createAugmenter();

    userTypes(input, USER);
    await advance(DEBOUNCE - 1);
    expect(input.value).toBe(USER);

    await advance(1);
    expect(input.value).toBe(`${USER}\n\n${GENUI_PROMPT_TEXT}`);
    expect(input.selectionStart).toBe(USER.length);
    expect(input.selectionEnd).toBe(USER.length);
    expect(draft.getStatus()).toBe('appended');
  });

  it('空草稿不写入任何内容', async () => {
    const input = createInput();
    createAugmenter();

    userTypes(input, '   ');
    await advance(DEBOUNCE * 3);
    expect(input.value).toBe('   ');
  });

  it('启动时不改动已经存在的草稿，只有用户继续输入才追加', async () => {
    const input = createInput('原有草稿');
    createAugmenter();

    await advance(DEBOUNCE * 3);
    expect(input.value).toBe('原有草稿');

    userTypes(input, '原有草稿，补充一句');
    await advance(DEBOUNCE);
    expect(input.value).toBe(`原有草稿，补充一句\n\n${GENUI_PROMPT_TEXT}`);
  });

  it('已包含同一提示词时不重复追加', async () => {
    const input = createInput(`${USER}\n\n${GENUI_PROMPT_TEXT}`);
    createAugmenter();

    userTypes(input, `${USER}\n\n${GENUI_PROMPT_TEXT}再加一点`);
    await advance(DEBOUNCE * 2);
    expect(input.value.split(GENUI_PROMPT_TEXT)).toHaveLength(2);
  });

  it('关闭增强时逐字节恢复未被编辑的草稿', async () => {
    const input = createInput();
    const draft = createAugmenter();

    userTypes(input, USER);
    await advance(DEBOUNCE);
    const appended = input.value;
    draft.setEnabled(false);

    expect(draft.getStatus()).toBe('disabled');
    expect(input.value).toBe(USER);
    expect(input.value).not.toContain(GENUI_PROMPT_TEXT);
    expect(appended).toContain(GENUI_PROMPT_TEXT);
  });

  it('关闭增强时保留用户在说明之前补写的内容，只移除末尾说明', async () => {
    const input = createInput();
    const draft = createAugmenter();

    userTypes(input, USER);
    await advance(DEBOUNCE);
    const edited = `补充：${input.value}`;
    userTypes(input, edited);
    expect(draft.getStatus()).toBe('appended');

    draft.setEnabled(false);
    expect(input.value).toBe(`补充：${USER}`);
  });

  it('用户修改说明本身后关闭增强不覆盖任何内容', async () => {
    const input = createInput();
    const draft = createAugmenter();

    userTypes(input, USER);
    await advance(DEBOUNCE);
    const edited = input.value.replace('GenUI 增强 v2', 'GenUI 增强（我改过）');
    userTypes(input, edited);

    draft.setEnabled(false);
    expect(input.value).toBe(edited);
  });

  it('手动删除说明后本草稿不再自动追加，清空草稿后恢复', async () => {
    const input = createInput();
    const draft = createAugmenter();

    userTypes(input, USER);
    await advance(DEBOUNCE);
    userTypes(input, USER);
    expect(draft.getStatus()).toBe('dismissed');

    userTypes(input, `${USER}，继续输入`);
    await advance(DEBOUNCE * 2);
    expect(input.value).toBe(`${USER}，继续输入`);

    userTypes(input, '');
    expect(draft.getStatus()).toBe('idle');
    userTypes(input, '全新草稿');
    await advance(DEBOUNCE);
    expect(input.value).toBe(`全新草稿\n\n${GENUI_PROMPT_TEXT}`);
  });

  it('分多次删除说明时保持 dismissed，不会在剩余标记被删后再追加', async () => {
    const input = createInput();
    const draft = createAugmenter();

    userTypes(input, USER);
    await advance(DEBOUNCE);

    // 先只删掉说明正文，保留起始标记。
    userTypes(input, GENUI_PROMPT_START);
    expect(draft.getStatus()).toBe('dismissed');

    // 再把剩余标记删掉；此时草稿为空，应恢复可追加状态。
    userTypes(input, '');
    expect(draft.getStatus()).toBe('idle');

    userTypes(input, '新的草稿');
    await advance(DEBOUNCE);
    expect(input.value).toBe(`新的草稿\n\n${GENUI_PROMPT_TEXT}`);
  });

  it('等待追加期间替换输入框（切换会话）不修改新草稿', async () => {
    const first = createInput();
    const draft = createAugmenter();

    userTypes(first, USER);
    expect(draft.getStatus()).toBe('scheduled');

    first.remove();
    const second = createInput('另一个会话的草稿');
    await advance(DEBOUNCE * 2);

    expect(second.value).toBe('另一个会话的草稿');
    expect(draft.getStatus()).toBe('idle');
  });

  it('等待追加期间复用输入框恢复另一份草稿时不写入', async () => {
    const input = createInput();
    const draft = createAugmenter();

    userTypes(input, USER);
    expect(draft.getStatus()).toBe('scheduled');

    input.value = '另一个会话的草稿';
    await advance(DEBOUNCE * 2);

    expect(input.value).toBe('另一个会话的草稿');
    expect(draft.getStatus()).toBe('idle');
  });

  it('输入框消失时报告 no-input，而不是写入其他元素', async () => {
    const input = createInput();
    const draft = createAugmenter();

    userTypes(input, USER);
    input.remove();
    await advance(DEBOUNCE);
    expect(draft.getStatus()).toBe('no-input');
  });

  it('输入法组合期间不追加，组合结束后再追加', async () => {
    const input = createInput();
    createAugmenter();

    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    userTypes(input, '拼音输入中');
    await advance(DEBOUNCE * 3);
    expect(input.value).toBe('拼音输入中');

    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await advance(DEBOUNCE);
    expect(input.value).toBe(`拼音输入中\n\n${GENUI_PROMPT_TEXT}`);
  });

  it('关闭状态下用户输入不会触发追加，重新开启后立即补齐', async () => {
    const input = createInput();
    const draft = createAugmenter({ enabled: false });

    userTypes(input, USER);
    await advance(DEBOUNCE * 3);
    expect(input.value).toBe(USER);

    draft.setEnabled(true);
    await advance(DEBOUNCE);
    expect(input.value).toBe(`${USER}\n\n${GENUI_PROMPT_TEXT}`);
  });
});
