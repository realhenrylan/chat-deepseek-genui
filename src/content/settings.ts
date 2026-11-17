import type { FollowupDeliveryMode } from '../render/inline/feedback';

export const GENUI_ENABLED_KEY = 'genuiEnabled';
export const GENUI_FOLLOWUP_MODE_KEY = 'genuiFollowupMode';
export const GENUI_DIRECT_SEND_NOTICED_KEY = 'genuiDirectSendNoticed';

export type { FollowupDeliveryMode };

export interface ExtensionSettingsStore {
  loadGenuiEnabled(): Promise<boolean | undefined>;
  saveGenuiEnabled(enabled: boolean): Promise<void>;
  subscribe(listener: (enabled: boolean) => void): () => void;
  loadFollowupMode?(): Promise<FollowupDeliveryMode | undefined>;
  saveFollowupMode?(mode: FollowupDeliveryMode): Promise<void>;
  subscribeFollowupMode?(listener: (mode: FollowupDeliveryMode) => void): () => void;
  loadDirectSendNoticed?(): Promise<boolean | undefined>;
  saveDirectSendNoticed?(noticed: boolean): Promise<void>;
  subscribeDirectSendNoticed?(listener: (noticed: boolean) => void): () => void;
}

function parseFollowupMode(value: unknown): FollowupDeliveryMode | undefined {
  return value === 'send' || value === 'fill' ? value : undefined;
}

/**
 * 扩展本地设置存储。缺少扩展 API 时返回 null，供单元测试和非扩展页面
 * 使用默认开启状态；设置仅保存在 chrome.storage.local，不传出本机。
 */
export function createExtensionSettingsStore(): ExtensionSettingsStore | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local || !chrome.storage.onChanged) {
    return null;
  }

  const subscribeKey = <T>(
    key: string,
    parse: (value: unknown) => T | undefined,
    listener: (value: T) => void,
  ): (() => void) => {
    const handleChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ): void => {
      if (areaName !== 'local') return;
      const parsed = parse(changes[key]?.newValue);
      if (parsed !== undefined) listener(parsed);
    };
    chrome.storage.onChanged.addListener(handleChanged);
    return () => chrome.storage.onChanged.removeListener(handleChanged);
  };

  return {
    async loadGenuiEnabled() {
      const values = await chrome.storage.local.get(GENUI_ENABLED_KEY);
      const value: unknown = values[GENUI_ENABLED_KEY];
      return typeof value === 'boolean' ? value : undefined;
    },
    async saveGenuiEnabled(enabled) {
      await chrome.storage.local.set({ [GENUI_ENABLED_KEY]: enabled });
    },
    subscribe(listener) {
      return subscribeKey(
        GENUI_ENABLED_KEY,
        (value) => (typeof value === 'boolean' ? value : undefined),
        listener,
      );
    },
    async loadFollowupMode() {
      const values = await chrome.storage.local.get(GENUI_FOLLOWUP_MODE_KEY);
      return parseFollowupMode(values[GENUI_FOLLOWUP_MODE_KEY]);
    },
    async saveFollowupMode(mode) {
      await chrome.storage.local.set({ [GENUI_FOLLOWUP_MODE_KEY]: mode });
    },
    subscribeFollowupMode(listener) {
      return subscribeKey(GENUI_FOLLOWUP_MODE_KEY, parseFollowupMode, listener);
    },
    async loadDirectSendNoticed() {
      const values = await chrome.storage.local.get(GENUI_DIRECT_SEND_NOTICED_KEY);
      const value: unknown = values[GENUI_DIRECT_SEND_NOTICED_KEY];
      return typeof value === 'boolean' ? value : undefined;
    },
    async saveDirectSendNoticed(noticed) {
      await chrome.storage.local.set({ [GENUI_DIRECT_SEND_NOTICED_KEY]: noticed });
    },
    subscribeDirectSendNoticed(listener) {
      return subscribeKey(
        GENUI_DIRECT_SEND_NOTICED_KEY,
        (value) => (typeof value === 'boolean' ? value : undefined),
        listener,
      );
    },
  };
}
