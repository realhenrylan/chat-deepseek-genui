/**
 * 阶段 7：默认增强的草稿接线；issue7：本轮模式（auto/tool/plain）状态机。
 *
 * 行为契约：
 * - 只在用户已经输入内容、且停止输入 debounce 之后，把提示词追加到草稿末尾；
 * - 提示词始终是 textarea 中的普通可见文本，不自动发送、不点击发送控件；
 * - 用户手动删除提示词后，本草稿不再重复追加（关闭增强或清空草稿后重置）；
 * - 关闭增强时，只有草稿仍与追加后的逐字节内容完全一致才恢复原文，
 *   任何用户编辑都不会被覆盖；
 * - 原草稿逐字节保留，光标停在提示词之前，避免打断输入。
 *
 * issue7 行为契约（模式是本轮选择，不持久化）：
 * - auto（默认）：沿用 v2.2 完整文本；tool：本轮明确生成工具；plain：本轮不追加任何文本；
 * - 用户在浮标中显式切换模式会清除 dismissed 并重新调度；内部重置（发送/清空、
 *   草稿被外部替换、stop/start、总开关切换）回到 auto 且不改变 dismissed；
 * - 已追加且草稿未被编辑时切换模式：auto↔tool 原地替换说明文本，光标夹取到
 *   用户原内容长度之内；plain 移除说明（restoreDraft）并把状态报为 plain。
 */

import { findChatInput, setNativeValue } from './followup';
import {
  appendGenuiPrompt,
  hasGenuiPrompt,
  type GenuiPromptMode,
} from './prompt';

export type AugmentStatus =
  | 'idle'
  | 'scheduled'
  | 'appended'
  | 'dismissed'
  | 'disabled'
  | 'no-input'
  | 'plain';

export interface DraftAugmentOptions {
  /** 与总开关同步的初始状态。 */
  enabled: boolean;
  /** 停止输入后等待多久追加；生产默认 700ms。 */
  debounceMs?: number;
  window?: Window;
  onStatus?: (status: AugmentStatus) => void;
  /** 用户在浮标中显式切换本轮模式时回调（不含内部重置）。 */
  onModeChange?: (mode: GenuiPromptMode) => void;
}

export interface DraftAugmenter {
  start(): void;
  stop(): void;
  dispose(): void;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  getStatus(): AugmentStatus;
  getMode(): GenuiPromptMode;
  /** 设置本轮模式；内部分支（发送/草稿替换/重启）请用内部 setModeReset。 */
  setMode(next: GenuiPromptMode): void;
  subscribe(listener: (status: AugmentStatus) => void): () => void;
}

interface DraftState {
  input: HTMLTextAreaElement;
  lastValue: string;
  /** 我们追加后的完整值；用户一旦编辑即置空，避免关闭时误覆盖。 */
  appendedValue: string | null;
  /** 追加前的原始草稿，仅用于逐字节恢复。 */
  originalValue: string | null;
  /** 用户手动删除提示词后，本草稿不再自动追加。 */
  dismissed: boolean;
}

/** 已调度但尚未执行的追加目标；执行时必须仍与当前草稿一致。 */
interface PendingAppend {
  input: HTMLTextAreaElement;
  value: string;
  state: DraftState;
}

export function createDraftAugmenter(
  doc: Document,
  options: DraftAugmentOptions,
): DraftAugmenter {
  const win = options.window ?? doc.defaultView;
  if (!win) throw new Error('页面 window 不存在，无法启动默认增强');
  const pageWindow: Window = win;

  const debounceMs = options.debounceMs ?? 700;
  const listeners = new Set<(status: AugmentStatus) => void>();
  let enabled = options.enabled;
  let started = false;
  let timer: number | null = null;
  let status: AugmentStatus = enabled ? 'idle' : 'disabled';
  let draft: DraftState | null = null;
  let pending: PendingAppend | null = null;
  let composing = false;
  /** setNativeValue 会同步派发 input；用它区分扩展自己的写入与用户输入。 */
  let writing = false;
  /** 本轮增强模式；plain 表示本轮不追加任何文本。 */
  let mode: GenuiPromptMode = 'auto';
  /** IME 组合期间用户切换模式时推迟到 compositionend 再应用。 */
  let deferredModeApply = false;

  function setStatus(next: AugmentStatus, force = false): void {
    if (!force && status === next) return;
    status = next;
    options.onStatus?.(next);
    for (const listener of listeners) listener(next);
  }

  function clearTimer(): void {
    if (timer !== null) {
      pageWindow.clearTimeout(timer);
      timer = null;
    }
    pending = null;
  }

  function stateFor(input: HTMLTextAreaElement): DraftState {
    if (!draft || draft.input !== input) {
      draft = {
        input,
        lastValue: input.value,
        appendedValue: null,
        originalValue: null,
        dismissed: false,
      };
    }
    return draft;
  }

  function resetDraftState(input: HTMLTextAreaElement): void {
    draft = {
      input,
      lastValue: input.value,
      appendedValue: null,
      originalValue: null,
      dismissed: false,
    };
  }

  function statusForCurrentDraft(): AugmentStatus {
    if (!enabled) return 'disabled';
    const input = findChatInput(doc);
    if (!input) return 'no-input';
    if (mode === 'plain') {
      return hasGenuiPrompt(input.value) ? 'appended' : 'plain';
    }
    if (hasGenuiPrompt(input.value)) return 'appended';
    if (draft?.input === input && draft.dismissed) return 'dismissed';
    return 'idle';
  }

  function schedule(): void {
    if (!started || !enabled || composing) return;
    clearTimer();
    const input = findChatInput(doc);
    if (!input) {
      setStatus('no-input');
      return;
    }
    const state = stateFor(input);
    const value = input.value;
    if (value.trim() === '') {
      setStatus('idle');
      return;
    }
    if (mode === 'plain') {
      setStatus('plain');
      return;
    }
    if (hasGenuiPrompt(value)) {
      setStatus('appended');
      return;
    }
    if (state.dismissed) {
      setStatus('dismissed');
      return;
    }

    // 把调度时的输入框、草稿内容和草稿记录绑定在一起；等待期间切会话时，
    // 即使页面复用同一个 textarea，也不能把说明写进另一份草稿。
    pending = { input, value, state };
    setStatus('scheduled');
    timer = pageWindow.setTimeout(() => {
      const target = pending;
      timer = null;
      pending = null;
      if (target) appendNow(target);
    }, debounceMs);
  }

  function appendNow(target: PendingAppend): void {
    if (!started || !enabled || composing) return;
    const input = findChatInput(doc);
    if (!input || input !== target.input || !target.input.isConnected) {
      setStatus(statusForCurrentDraft());
      return;
    }
    const value = input.value;
    if (value !== target.value || draft !== target.state || target.state.dismissed) {
      setStatus(statusForCurrentDraft());
      return;
    }
    if (value.trim() === '' || hasGenuiPrompt(value)) {
      setStatus(statusForCurrentDraft());
      return;
    }

    const result = appendGenuiPrompt(value, mode === 'plain' ? 'auto' : mode);
    if (!result.inserted) return;

    const selectionStart = input.selectionStart ?? value.length;
    const selectionEnd = input.selectionEnd ?? value.length;
    const caretAtEnd = selectionStart === value.length && selectionEnd === value.length;
    const scrollTop = input.scrollTop;

    target.state.originalValue = value;
    target.state.appendedValue = result.value;
    target.state.lastValue = result.value;

    writing = true;
    try {
      setNativeValue(input, result.value);
    } finally {
      writing = false;
    }

    // 光标原在末尾时移到增强说明之前；其他位置不受末尾插入影响。
    try {
      if (caretAtEnd) input.setSelectionRange(result.userLength, result.userLength);
      else input.setSelectionRange(selectionStart, selectionEnd);
      input.scrollTop = scrollTop;
    } catch {
      // 某些嵌入环境不支持 selection API，不影响文本本身。
    }
    setStatus('appended');
  }

  /** 切换模式时的状态分支；clearDismissed 仅在用户显式选择时为 true。 */
  function applyModeSwitch(clearDismissed: boolean): void {
    if (!started || !enabled) return;
    clearTimer();
    const input = findChatInput(doc);
    if (!input) {
      setStatus('no-input');
      return;
    }
    const state = stateFor(input);
    const value = input.value;
    if (value.trim() === '') {
      setStatus(mode === 'plain' ? 'plain' : 'idle');
      return;
    }
    if (mode === 'plain') {
      if (state.originalValue !== null && state.appendedValue !== null) {
        restoreDraft();
        setStatus('plain');
      } else {
        setStatus(statusForCurrentDraft());
      }
      return;
    }
    if (
      state.originalValue !== null &&
      state.appendedValue !== null &&
      input.value === state.appendedValue
    ) {
      // 说明未被编辑：换用当前模式的文本，光标仍停在用户内容之前。
      swapAppendedText(state, input);
      setStatus('appended');
      return;
    }
    if (clearDismissed) state.dismissed = false;
    if (state.dismissed) {
      setStatus('dismissed');
      return;
    }
    schedule();
  }

  /** 草稿未被编辑时，把已追加的说明整段换成当前模式文本。 */
  function swapAppendedText(state: DraftState, input: HTMLTextAreaElement): void {
    if (state.originalValue === null) return;
    const result = appendGenuiPrompt(state.originalValue, mode === 'auto' ? 'auto' : mode);
    if (!result.inserted) return;
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? 0;
    const scrollTop = input.scrollTop;

    state.appendedValue = result.value;
    state.lastValue = result.value;
    state.dismissed = false;

    writing = true;
    try {
      setNativeValue(input, result.value);
    } finally {
      writing = false;
    }
    try {
      input.setSelectionRange(
        Math.min(selectionStart, result.userLength),
        Math.min(selectionEnd, result.userLength),
      );
      input.scrollTop = scrollTop;
    } catch {
      // 同 appendNow：selection API 不可用时不影响文本本身。
    }
  }

  /** 用户显式选择模式：记住选择、通知 UI，并立即对当前草稿生效。 */
  function setMode(next: GenuiPromptMode): void {
    if (mode === next) return;
    mode = next;
    options.onModeChange?.(next);
    if (composing) {
      // IME 组合输入期间不改动草稿；组合结束后再应用本次选择。
      deferredModeApply = true;
      return;
    }
    applyModeSwitch(true);
  }

  /** 内部状态复位回 auto（发送/清空、草稿替换、重启、开关切换）；不视为用户选择。 */
  function resetModeToAuto(): void {
    if (mode === 'auto') return;
    mode = 'auto';
    options.onModeChange?.('auto');
  }

  /** 关闭增强时移除自动追加的说明；只动扩展写入的尾部，不覆盖用户内容。 */
  function restoreDraft(): void {
    const input = findChatInput(doc);
    const state = draft;
    if (!input || !state || state.input !== input) return;
    if (state.originalValue === null || state.appendedValue === null) return;

    const suffix = state.appendedValue.slice(state.originalValue.length);
    let restored: string | null = null;
    if (input.value === state.appendedValue) {
      // 草稿完全未被编辑：逐字节恢复追加前的内容。
      restored = state.originalValue;
    } else if (suffix !== '' && input.value.endsWith(suffix)) {
      // 用户在说明之前继续输入过：只移除末尾仍完整的自动追加部分。
      restored = input.value.slice(0, input.value.length - suffix.length);
    }
    if (restored === null) return;

    state.originalValue = null;
    state.appendedValue = null;
    state.lastValue = restored;
    state.dismissed = false;

    writing = true;
    try {
      setNativeValue(input, restored);
    } finally {
      writing = false;
    }
    try {
      input.setSelectionRange(restored.length, restored.length);
    } catch {
      // 同上。
    }
  }

  function handleInput(event: Event): void {
    if (writing) return;
    const input = findChatInput(doc);
    if (!input || event.target !== input) return;
    if (composing) return;

    const state = stateFor(input);
    const value = input.value;

    if (state.appendedValue !== null && value !== state.appendedValue) {
      // 只有「说明尾部仍完整」时继续保留追加记录：用户在说明之前继续输入，
      // 关闭增强仍可安全移除末尾说明；一旦说明本身被改动/删除，就不再自动追加。
      const suffix =
        state.originalValue === null
          ? ''
          : state.appendedValue.slice(state.originalValue.length);
      if (suffix === '' || !value.endsWith(suffix)) {
        state.appendedValue = null;
        state.originalValue = null;
        // 只要草稿仍非空，就记录用户已改动/删除说明；即使起始标记还在，
        // 后续把剩余标记删掉时也不能再次自动追加。
        if (value.trim() !== '') state.dismissed = true;
      }
    }
    state.lastValue = value;

    if (value.trim() === '') {
      state.dismissed = false;
      state.originalValue = null;
      state.appendedValue = null;
      resetModeToAuto();
      clearTimer();
      setStatus(enabled ? 'idle' : 'disabled');
      return;
    }
    if (!enabled) {
      clearTimer();
      setStatus('disabled');
      return;
    }
    if (state.dismissed) {
      clearTimer();
      setStatus('dismissed');
      return;
    }
    if (mode === 'plain') {
      // 本轮选择普通回答：不再追加；若页面上仍有说明文本，状态如实报 appended。
      clearTimer();
      if (hasGenuiPrompt(value)) setStatus('appended');
      else setStatus('plain');
      return;
    }
    if (hasGenuiPrompt(value)) {
      clearTimer();
      setStatus('appended');
      return;
    }
    schedule();
  }

  function handleFocusIn(event: FocusEvent): void {
    const input = findChatInput(doc);
    if (!input || event.target !== input) return;
    // 切回输入框时若值已被外部替换（会话切换/草稿恢复），按新草稿重新判断。
    if (!draft || draft.input !== input || draft.lastValue !== input.value) {
      resetDraftState(input);
      resetModeToAuto();
      clearTimer();
      if (!enabled) {
        setStatus('disabled');
      } else if (hasGenuiPrompt(input.value)) {
        setStatus('appended');
      } else if (mode === 'plain') {
        setStatus('plain');
      } else {
        setStatus('idle');
      }
    }
  }

  function handleCompositionStart(event: CompositionEvent): void {
    if (event.target !== findChatInput(doc)) return;
    composing = true;
    clearTimer();
  }

  function handleCompositionEnd(event: CompositionEvent): void {
    if (event.target !== findChatInput(doc)) return;
    composing = false;
    if (deferredModeApply) {
      deferredModeApply = false;
      applyModeSwitch(true);
      return;
    }
    const input = event.target as HTMLTextAreaElement;
    const state = stateFor(input);
    state.lastValue = input.value;
    if (!enabled || state.dismissed || hasGenuiPrompt(input.value) || input.value.trim() === '')
      return;
    schedule();
  }

  function setEnabled(next: boolean): void {
    if (enabled === next) return;
    enabled = next;
    if (!enabled) {
      clearTimer();
      restoreDraft();
      setStatus('disabled');
      return;
    }
    resetModeToAuto();
    if (draft) draft.dismissed = false;
    const input = findChatInput(doc);
    if (!input) {
      setStatus('no-input');
      return;
    }
    if (hasGenuiPrompt(input.value)) {
      setStatus('appended');
      return;
    }
    if (input.value.trim() !== '') {
      schedule();
      return;
    }
    setStatus('idle');
  }

  function start(): void {
    if (started) return;
    started = true;
    composing = false;
    draft = null;
    resetModeToAuto();
    doc.addEventListener('input', handleInput, true);
    doc.addEventListener('focusin', handleFocusIn, true);
    doc.addEventListener('compositionstart', handleCompositionStart, true);
    doc.addEventListener('compositionend', handleCompositionEnd, true);

    const input = findChatInput(doc);
    setStatus(
      !enabled ? 'disabled' : hasGenuiPrompt(input?.value ?? '') ? 'appended' : 'idle',
      true,
    );
  }

  function stop(): void {
    if (!started) return;
    started = false;
    composing = false;
    clearTimer();
    draft = null;
    resetModeToAuto();
    doc.removeEventListener('input', handleInput, true);
    doc.removeEventListener('focusin', handleFocusIn, true);
    doc.removeEventListener('compositionstart', handleCompositionStart, true);
    doc.removeEventListener('compositionend', handleCompositionEnd, true);
  }

  return {
    start,
    stop,
    dispose() {
      stop();
      listeners.clear();
    },
    setEnabled,
    isEnabled: () => enabled,
    getStatus: () => status,
    getMode: () => mode,
    setMode,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
