/**
 * 阶段 6 / 一键回流：把摘要、修复请求或表单回流消息写入聊天输入框并按策略触发发送。
 *
 * 取证（docs/compatibility-investigation.md §3.5 / §4 / §5）：
 * - 输入框本体是 `textarea[name="search"]`，placeholder「给 DeepSeek 发送消息」；
 * - 已有草稿绝不覆盖：追加到原草稿之后，或在直接发送模式下主动降级为带入输入框；
 * - 直接发送仅在用户主动点击回流主按钮（isTrusted === true）时触发，通过站点自身的
 *   发送按钮完成，不在拦截器中伪造请求；找不到按钮、按钮禁用或超时未发出请求时
 *   降级为保留在输入框内由用户手动发送。
 */

import { REQUEST_DELIVERED_EVENT, REQUEST_SENT_EVENT } from './bridge';
import {
  DEEPSEEK_SITE_ADAPTER,
  isSendButtonDisabled,
  type SiteAdapter,
} from './site-adapter';
import type {
  FollowupDeliveryMode,
  RequestSendMeta,
  RequestSendResult,
} from '../render/inline/feedback';

export type FillResult = 'filled' | 'appended' | 'no-input';

export const SEND_DEBOUNCE_MS = 1000;
export const SEND_CONFIRM_TIMEOUT_MS = 1500;

export interface SendCoordinatorOptions {
  adapter?: SiteAdapter;
  getMode?: () => FollowupDeliveryMode;
  isDirectSendNoticed?: () => boolean;
  onFirstDirectSendNotice?: () => void;
  onNoInput?: () => void;
  onSendButtonMissing?: () => void;
  requireTrusted?: boolean;
  debounceMs?: number;
  confirmTimeoutMs?: number;
  now?: () => number;
  window?: Window;
}

export interface RequestSendOptions extends SendCoordinatorOptions {
  mode?: FollowupDeliveryMode;
  directSendNoticed?: boolean;
}

export interface SendCoordinator {
  send(message: string, meta?: RequestSendMeta): Promise<RequestSendResult>;
}

export function setNativeValue(textarea: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * 选框顺序：name=search → placeholder 含「发送消息」（标记定义在站点适配层）。
 * 不确定时不猜测（null → no-input）。
 */
export function findChatInput(
  doc: Document,
  adapter: SiteAdapter = DEEPSEEK_SITE_ADAPTER,
): HTMLTextAreaElement | null {
  return adapter.findChatInput(doc);
}

/**
 * 追加一段文本到聊天草稿：保留现有草稿逐字节不变，相同内容不重复追加。
 * 找不到确定的输入框时返回 no-input，由调用方决定复制等退路。
 */
export function appendDraftIntoInput(
  doc: Document,
  text: string,
  adapter: SiteAdapter = DEEPSEEK_SITE_ADAPTER,
): FillResult {
  const textarea = findChatInput(doc, adapter);
  if (!textarea) return 'no-input';

  const existing = textarea.value;
  // 只有真正的空串才直接填入：仅含空格/换行的草稿也是用户输入，必须逐字保留。
  if (existing.length === 0) {
    setNativeValue(textarea, text);
    return 'filled';
  }
  // 已含同一内容时不再追加（重复点击去重），也不改变原草稿。
  if (existing.includes(text)) return 'appended';
  // 原草稿逐字节保留：不裁剪末尾空白；草稿以换行结尾时直接在其后另起一行，
  // 否则补一个空行分隔，避免改变原有换行或 Markdown 结构。
  const separator = /\n$/.test(existing) ? '' : '\n\n';
  setNativeValue(textarea, existing + separator + text);
  return 'appended';
}

export function fillContinueIntoInput(
  doc: Document,
  summary: string,
  adapter: SiteAdapter = DEEPSEEK_SITE_ADAPTER,
): FillResult {
  return appendDraftIntoInput(doc, summary, adapter);
}

function waitForRequestSignal(
  doc: Document,
  win: Window | null,
  timeoutMs: number,
  trigger: () => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | number | null = null;

    const cleanup = () => {
      doc.removeEventListener(REQUEST_SENT_EVENT, onSignal, true);
      doc.removeEventListener(REQUEST_DELIVERED_EVENT, onSignal, true);
      if (timer !== null) {
        if (win) win.clearTimeout(timer as number);
        else globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>);
        timer = null;
      }
    };

    const finish = (observed: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(observed);
    };

    const onSignal = () => {
      finish(true);
    };

    doc.addEventListener(REQUEST_SENT_EVENT, onSignal, true);
    doc.addEventListener(REQUEST_DELIVERED_EVENT, onSignal, true);

    try {
      trigger();
    } catch {
      finish(false);
      return;
    }

    if (settled) return;
    if (timeoutMs <= 0) {
      finish(false);
      return;
    }
    timer = win
      ? win.setTimeout(() => finish(false), timeoutMs)
      : globalThis.setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * 创建遵循护栏 G1–G9 的回流发送协调器。
 * - G1：要求显式点击事件 isTrusted === true（除非测试显式覆盖）
 * - G2：模型生成中拒绝发送
 * - G3：已有草稿时不覆盖，退回追加到输入框末尾
 * - G4：1 秒防抖 + 进行中互斥，防止重复发送
 * - G7：支持直接发送 / 仅填入输入框两种模式
 * - G8：找不到发送按钮、按钮禁用或超时未观察到请求时，降级保留在输入框
 * - G9：首次直接发送先提示一次并等待用户再次确认点击
 */
export function createSendCoordinator(
  doc: Document,
  options: SendCoordinatorOptions = {},
): SendCoordinator {
  const adapter = options.adapter ?? DEEPSEEK_SITE_ADAPTER;
  const requireTrusted = options.requireTrusted ?? true;
  const debounceMs = options.debounceMs ?? SEND_DEBOUNCE_MS;
  const confirmTimeoutMs = options.confirmTimeoutMs ?? SEND_CONFIRM_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const win = options.window ?? doc.defaultView;

  let lastSendAt = 0;
  let inFlight = false;

  return {
    async send(message: string, meta: RequestSendMeta = { isTrusted: false }): Promise<RequestSendResult> {
      // G1: 仅响应来自真实用户交互的主按钮点击
      if (requireTrusted && meta.isTrusted !== true) {
        return { status: 'untrusted' };
      }

      // G2: 生成过程中禁止发起发送
      if (adapter.isGenerationActive(doc)) {
        return { status: 'busy' };
      }

      const textarea = findChatInput(doc, adapter);
      if (!textarea) {
        options.onNoInput?.();
        return { status: 'no-input' };
      }

      const mode = options.getMode?.() ?? 'send';
      // G7: 用户设为「仅填入输入框」时只写入/追加而不发送
      if (mode === 'fill') {
        const res = appendDraftIntoInput(doc, message, adapter);
        return { status: res === 'filled' ? 'filled' : res === 'appended' ? 'appended' : 'no-input' };
      }

      // G4: 1 秒防抖与并发保护（先于草稿检查，防止站点清空输入框的瞬时窗口被连击穿透）
      const currentAt = now();
      if (inFlight || (lastSendAt > 0 && currentAt - lastSendAt < debounceMs)) {
        return { status: 'debounced' };
      }

      // G3: 输入框已有用户草稿时，不能覆盖，改为追加到末尾并提示手动发送
      if (textarea.value.length > 0) {
        const res = appendDraftIntoInput(doc, message, adapter);
        return { status: res === 'no-input' ? 'no-input' : 'draft-protected' };
      }

      // G9: 首次直接发送先提示一次，避免在用户未认知变更前直接发出消息
      const noticed = options.isDirectSendNoticed?.() ?? true;
      if (!noticed) {
        options.onFirstDirectSendNotice?.();
        return { status: 'first-time-notice' };
      }

      const sendButton = adapter.findSendButton(doc);
      if (!sendButton) {
        options.onSendButtonMissing?.();
        setNativeValue(textarea, message);
        return { status: 'fallback-filled', reason: 'missing-send-button' };
      }

      inFlight = true;
      lastSendAt = currentAt;
      try {
        setNativeValue(textarea, message);
        // 站点在空输入时常将发送按钮置于禁用态；给页面一轮微任务更新按钮可用性。
        if (isSendButtonDisabled(sendButton)) {
          await Promise.resolve();
        }
        if (isSendButtonDisabled(sendButton)) {
          return { status: 'fallback-filled', reason: 'send-button-disabled' };
        }

        const sent = await waitForRequestSignal(doc, win, confirmTimeoutMs, () => {
          sendButton.click();
        });
        return sent
          ? { status: 'sent' }
          : { status: 'fallback-filled', reason: 'send-timeout' };
      } finally {
        inFlight = false;
      }
    },
  };
}

/** 单次调用便捷入口（供无状态调用方与单测使用）。 */
export function requestSend(
  doc: Document,
  message: string,
  options: RequestSendOptions = {},
  meta: RequestSendMeta = { isTrusted: false },
): Promise<RequestSendResult> {
  const coordinator = createSendCoordinator(doc, {
    ...options,
    getMode: options.getMode ?? (options.mode ? () => options.mode! : undefined),
    isDirectSendNoticed:
      options.isDirectSendNoticed ??
      (options.directSendNoticed !== undefined ? () => options.directSendNoticed! : undefined),
  });
  return coordinator.send(message, meta);
}
