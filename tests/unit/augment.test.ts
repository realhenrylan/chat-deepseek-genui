import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDraftAugmenter,
  GENUI_PLAIN_RESIDUAL_NOTE,
  type DraftAugmenter,
} from '../../src/content/augment';
import {
  GENUI_PROMPT_START,
  GENUI_PROMPT_TEXT,
  GENUI_TOOL_PROMPT_TEXT,
} from '../../src/content/prompt';

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

function createAugmenter(
  options: {
    enabled?: boolean;
    onModeChange?: (mode: 'auto' | 'tool' | 'plain') => void;
    onPlainNote?: (note: string | null) => void;
  } = {},
): DraftAugmenter {
  augmenter = createDraftAugmenter(document, {
    enabled: options.enabled ?? true,
    debounceMs: DEBOUNCE,
    window,
    onModeChange: options.onModeChange,
    onPlainNote: options.onPlainNote,
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
    const edited = input.value.replace(GENUI_PROMPT_START, 'GenUI 增强（我改过）');
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

describe('issue7 本轮模式', () => {
  const NL = String.fromCharCode(10);
  const SEP = NL + NL;
  const TOOL = GENUI_TOOL_PROMPT_TEXT;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    augmenter?.dispose();
    augmenter = null;
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('默认 auto；显式选择 tool 后停止输入追加 tool 文本', async () => {
    const input = createInput();
    const draft = createAugmenter();

    expect(draft.getMode()).toBe('auto');
    draft.setMode('tool');
    expect(draft.getMode()).toBe('tool');
    expect(draft.getStatus()).toBe('idle');

    userTypes(input, USER);
    await advance(DEBOUNCE);
    expect(input.value).toBe(`${USER}${SEP}${TOOL}`);
    expect(input.selectionStart).toBe(USER.length);
    expect(input.selectionEnd).toBe(USER.length);
    expect(draft.getStatus()).toBe('appended');
  });

  it('已追加且未编辑时切 tool：整段替换为 tool 文本，光标停在说明之前', async () => {
    const input = createInput();
    const draft = createAugmenter();

    userTypes(input, USER);
    await advance(DEBOUNCE);
    expect(input.value).toBe(`${USER}${SEP}${GENUI_PROMPT_TEXT}`);

    draft.setMode('tool');
    expect(input.value).toBe(`${USER}${SEP}${TOOL}`);
    expect(draft.getStatus()).toBe('appended');
    expect(input.selectionStart).toBe(USER.length);
    expect(input.selectionEnd).toBe(USER.length);

    draft.setEnabled(false);
    expect(input.value).toBe(USER);
  });

  it('已追加且未编辑时切 plain：移除说明并报告 plain，期间不再追加', async () => {
    const input = createInput();
    const draft = createAugmenter();

    userTypes(input, USER);
    await advance(DEBOUNCE);
    draft.setMode('plain');
    expect(input.value).toBe(USER);
    expect(draft.getStatus()).toBe('plain');
    expect(draft.getMode()).toBe('plain');

    userTypes(input, `${USER}，再想想`);
    await advance(DEBOUNCE * 2);
    expect(input.value).toBe(`${USER}，再想想`);
    expect(draft.getStatus()).toBe('plain');
  });

  it('plain 后切回 auto：恢复自动追加', async () => {
    const input = createInput();
    const draft = createAugmenter();

    draft.setMode('plain');
    userTypes(input, USER);
    await advance(DEBOUNCE * 2);
    expect(input.value).toBe(USER);

    draft.setMode('auto');
    await advance(DEBOUNCE);
    expect(input.value).toBe(`${USER}${SEP}${GENUI_PROMPT_TEXT}`);
    expect(draft.getMode()).toBe('auto');
    expect(draft.getStatus()).toBe('appended');
  });

  it('显式选择 tool 会清除手动删除记录并重新追加', async () => {
    const input = createInput();
    const draft = createAugmenter();

    userTypes(input, USER);
    await advance(DEBOUNCE);
    userTypes(input, USER);
    expect(draft.getStatus()).toBe('dismissed');

    draft.setMode('tool');
    expect(draft.getStatus()).toBe('scheduled');
    await advance(DEBOUNCE);
    expect(input.value).toBe(`${USER}${SEP}${TOOL}`);
    expect(input.value).not.toContain(GENUI_PROMPT_TEXT);
    expect(draft.getStatus()).toBe('appended');
  });

  it('草稿清空后本轮模式回到 auto，下一轮追加 auto 文本', async () => {
    const input = createInput();
    const draft = createAugmenter();

    draft.setMode('tool');
    userTypes(input, USER);
    await advance(DEBOUNCE);
    expect(input.value).toContain(TOOL);

    userTypes(input, '');
    expect(draft.getMode()).toBe('auto');
    expect(draft.getStatus()).toBe('idle');

    userTypes(input, '第二轮问题');
    await advance(DEBOUNCE);
    expect(input.value).toBe(`第二轮问题${SEP}${GENUI_PROMPT_TEXT}`);
    expect(input.value).not.toContain(TOOL);
  });

  it('stop/start 重置本轮模式为 auto', () => {
    const draft = createAugmenter();
    draft.setMode('plain');
    expect(draft.getMode()).toBe('plain');

    draft.stop();
    expect(draft.getMode()).toBe('auto');
    draft.start();
    expect(draft.getMode()).toBe('auto');
  });

  it('关闭再开启增强后模式回到 auto', async () => {
    const input = createInput();
    const draft = createAugmenter();

    draft.setMode('tool');
    userTypes(input, USER);
    await advance(DEBOUNCE);
    expect(input.value).toContain(TOOL);

    draft.setEnabled(false);
    userTypes(input, USER);
    expect(draft.getMode()).toBe('tool');

    draft.setEnabled(true);
    expect(draft.getMode()).toBe('auto');
    await advance(DEBOUNCE);
    expect(input.value).toBe(`${USER}${SEP}${GENUI_PROMPT_TEXT}`);
  });

  it('输入法组合期间切换模式推迟到组合结束后应用', async () => {
    const input = createInput();
    const draft = createAugmenter();

    userTypes(input, '组合输入');
    expect(draft.getStatus()).toBe('scheduled');

    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    draft.setMode('tool');
    expect(draft.getMode()).toBe('tool');

    await advance(DEBOUNCE * 3);
    expect(input.value).toBe('组合输入');

    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(draft.getStatus()).toBe('scheduled');
    await advance(DEBOUNCE);
    expect(input.value).toBe(`组合输入${SEP}${TOOL}`);
  });

  it('onModeChange 只在模式变化时回调', async () => {
    const onModeChange = vi.fn();
    augmenter = createDraftAugmenter(document, {
      enabled: true,
      debounceMs: DEBOUNCE,
      window,
      onModeChange,
    });
    augmenter.start();
    const draft = augmenter;

    draft.setMode('tool');
    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenLastCalledWith('tool');

    draft.setMode('tool');
    expect(onModeChange).toHaveBeenCalledTimes(1);

    const input = createInput();
    userTypes(input, USER);
    await advance(DEBOUNCE);
    expect(input.value).toContain(TOOL);

    draft.setMode('plain');
    expect(onModeChange).toHaveBeenCalledTimes(2);
    expect(onModeChange).toHaveBeenLastCalledWith('plain');

    userTypes(input, '');
    expect(onModeChange).toHaveBeenCalledTimes(3);
    expect(onModeChange).toHaveBeenLastCalledWith('auto');
  });
});

describe('issue7 模式切换安全替换与残留', () => {
  const NL = String.fromCharCode(10);
  const SEP = NL + NL;
  const TOOL = GENUI_TOOL_PROMPT_TEXT;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    augmenter?.dispose();
    augmenter = null;
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('编辑原文后切 tool：只替换尾部说明，保留补充内容并把光标夹回原文末尾', async () => {
    const input = createInput();
    const draft = createAugmenter();
    userTypes(input, USER);
    await advance(DEBOUNCE);

    const EDITED_BASE = `${USER}，再算年度`;
    userTypes(input, `${EDITED_BASE}${SEP}${GENUI_PROMPT_TEXT}`);
    input.setSelectionRange(EDITED_BASE.length + 3, EDITED_BASE.length + 7);

    draft.setMode('tool');
    expect(input.value).toBe(`${EDITED_BASE}${SEP}${TOOL}`);
    expect(draft.getStatus()).toBe('appended');
    expect(input.value).not.toContain(GENUI_PROMPT_START);
    expect(input.selectionStart).toBe(EDITED_BASE.length);
    expect(input.selectionEnd).toBe(EDITED_BASE.length);

    // 切换后的记录仍指向最新原文：关闭增强恢复的是补充后的内容。
    draft.setEnabled(false);
    expect(input.value).toBe(EDITED_BASE);
  });

  it('编辑原文后切 plain：只移除尾部说明，原选区位置保留', async () => {
    const input = createInput();
    const draft = createAugmenter();
    userTypes(input, USER);
    await advance(DEBOUNCE);

    const EDITED_BASE = `${USER}，补充一点`;
    userTypes(input, `${EDITED_BASE}${SEP}${GENUI_PROMPT_TEXT}`);
    input.setSelectionRange(2, 5);

    draft.setMode('plain');
    expect(input.value).toBe(EDITED_BASE);
    expect(draft.getStatus()).toBe('plain');
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(5);

    draft.setMode('auto');
    await advance(DEBOUNCE);
    expect(input.value).toBe(`${EDITED_BASE}${SEP}${GENUI_PROMPT_TEXT}`);
  });

  it('无记录但草稿末尾含完整说明（会话恢复等）：plain 仍按尾部整份移除', () => {
    const input = createInput(`${USER}${SEP}${GENUI_PROMPT_TEXT}`);
    const draft = createAugmenter();

    expect(draft.getStatus()).toBe('appended');
    draft.setMode('plain');
    expect(input.value).toBe(USER);
    expect(draft.getStatus()).toBe('plain');
  });

  it('说明被用户修改：扩展不覆盖；plain 面板残留提示，auto/tool 报 edited', async () => {
    const onPlainNote = vi.fn();
    const input = createInput();
    const draft = createAugmenter({ onPlainNote });

    draft.setMode('tool');
    expect(draft.getStatus()).toBe('idle');

    userTypes(input, USER);
    await advance(DEBOUNCE);
    expect(input.value).toBe(`${USER}${SEP}${TOOL}`);

    const TAMPERED = `${USER}${SEP}${GENUI_TOOL_PROMPT_TEXT.slice(0, 120)}改${GENUI_TOOL_PROMPT_TEXT.slice(121)}`;
    userTypes(input, TAMPERED);
    // 说明被改动：不再自动追加（dismissed）。
    expect(draft.getStatus()).toBe('dismissed');

    draft.setMode('plain');
    expect(input.value).toBe(TAMPERED);
    expect(draft.getStatus()).toBe('plain');
    expect(onPlainNote).toHaveBeenLastCalledWith(GENUI_PLAIN_RESIDUAL_NOTE);

    draft.setMode('tool');
    expect(input.value).toBe(TAMPERED);
    expect(draft.getStatus()).toBe('edited');

    draft.setMode('auto');
    expect(input.value).toBe(TAMPERED);

    // 清空草稿后一切重置，说明提示回到默认。
    userTypes(input, '');
    expect(draft.getStatus()).toBe('idle');
    expect(onPlainNote).toHaveBeenLastCalledWith(null);
  });
});
