import {
  REQUEST_DELIVERED_EVENT,
  REQUEST_SENT_EVENT,
  clearPendingRepairIfMatches,
  readBridgeModeRevision,
  syncBridgeState,
  type RequestDeliveredDetail,
  type RequestSentDetail,
} from './bridge.ts';
import type { GenuiPromptMode } from './prompt.ts';

/**
 * 静默增强状态桥。
 *
 * 不再监听输入框、不再防抖、不再改写草稿：这里只维护「总开关 + 本轮模式」，
 * 并把状态同步到 `document.documentElement`，供 MAIN world 拦截器在发送时读取。
 *
 * 事件消费：
 * - `genui:request-sent` 在请求发起后立即到达，携带模式版本号；版本号不一致说明
 *   用户已经选择了新一轮模式，迟到的旧请求不会复位它。
 * - `genui:request-delivered` 只在该请求成功返回后到达，且只清除同 id 的修复暂存，
 *   避免旧请求清掉用户新点的修复详情。
 */

/** 静默增强对外暴露的三种状态；具体的「等待输入/已追加」等草稿状态已随改写逻辑移除。 */
export type AugmentStatus = 'ready' | 'plain' | 'disabled';

export interface DraftAugmentOptions {
  enabled: boolean;
  /** 保留字段：静默桥不再读写草稿，仅为兼容既有调用方。 */
  adapter?: unknown;
  window?: Window;
  onStatus?: (status: AugmentStatus) => void;
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
  setMode(mode: GenuiPromptMode): void;
  subscribe(listener: (status: AugmentStatus) => void): () => void;
}

const SINGLE_ROUND_MODES: readonly GenuiPromptMode[] = ['tool', 'plain'];

export function createDraftAugmenter(
  doc: Document,
  options: DraftAugmentOptions,
): DraftAugmenter {
  let enabled = options.enabled;
  let mode: GenuiPromptMode = 'auto';
  let modeRevision = 0;
  let started = false;
  const listeners = new Set<(status: AugmentStatus) => void>();

  function root(): Element | null {
    return doc.documentElement;
  }

  function status(): AugmentStatus {
    if (!enabled) return 'disabled';
    return mode === 'plain' ? 'plain' : 'ready';
  }

  function notifyStatus(): void {
    const next = status();
    options.onStatus?.(next);
    for (const listener of listeners) listener(next);
  }

  function sync(): void {
    syncBridgeState(root(), enabled, mode, modeRevision);
  }

  function setModeInternal(next: GenuiPromptMode, notify: boolean): void {
    if (next !== 'auto' && next !== 'tool' && next !== 'plain') return;
    const changed = mode !== next;
    if (changed) {
      mode = next;
      // 版本号只在模式真正变化时递增：旧请求携带的版本号随即过期。
      modeRevision += 1;
    }
    sync();
    if (changed && notify) {
      options.onModeChange?.(mode);
      notifyStatus();
    }
  }

  const handleRequestSent = (event: Event): void => {
    const detail = (event as CustomEvent<RequestSentDetail | undefined>).detail;
    if (!detail || typeof detail.modeRevision !== 'number') return;
    if (detail.modeRevision !== readBridgeModeRevision(root())) return;

    const active = detail.mode;
    if (SINGLE_ROUND_MODES.includes(active) || SINGLE_ROUND_MODES.includes(mode)) {
      setModeInternal('auto', true);
    }
    notifyStatus();
  };

  const handleRequestDelivered = (event: Event): void => {
    const detail = (event as CustomEvent<RequestDeliveredDetail | undefined>).detail;
    clearPendingRepairIfMatches(root(), detail?.repairStashId ?? null);
  };

  function stopListening(): void {
    if (!started) return;
    started = false;
    doc.removeEventListener(REQUEST_SENT_EVENT, handleRequestSent, true);
    doc.removeEventListener(REQUEST_DELIVERED_EVENT, handleRequestDelivered, true);
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      sync();
      doc.addEventListener(REQUEST_SENT_EVENT, handleRequestSent, true);
      doc.addEventListener(REQUEST_DELIVERED_EVENT, handleRequestDelivered, true);
      notifyStatus();
    },
    stop: stopListening,
    dispose(): void {
      stopListening();
      listeners.clear();
    },
    setEnabled(next: boolean): void {
      if (enabled === next) {
        sync();
        return;
      }
      enabled = next;
      // 重新开启时回到自动适配，并同步回执给浮标，避免按钮停留在上一轮的临时选择。
      if (enabled) {
        if (mode !== 'auto') {
          mode = 'auto';
          modeRevision += 1;
          sync();
          options.onModeChange?.(mode);
        } else {
          sync();
        }
        notifyStatus();
        return;
      }
      sync();
      notifyStatus();
    },
    isEnabled(): boolean {
      return enabled;
    },
    getStatus: status,
    getMode(): GenuiPromptMode {
      return mode;
    },
    setMode(next: GenuiPromptMode): void {
      setModeInternal(next, true);
    },
    subscribe(listener: (status: AugmentStatus) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
