export const GENUI_ENABLED_KEY = 'genuiEnabled';

export interface ExtensionSettingsStore {
  loadGenuiEnabled(): Promise<boolean | undefined>;
  saveGenuiEnabled(enabled: boolean): Promise<void>;
  subscribe(listener: (enabled: boolean) => void): () => void;
}

/**
 * 扩展本地设置存储。缺少扩展 API 时返回 null，供单元测试和非扩展页面
 * 使用默认开启状态；设置仅保存在 chrome.storage.local，不传出本机。
 */
export function createExtensionSettingsStore(): ExtensionSettingsStore | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local || !chrome.storage.onChanged) {
    return null;
  }

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
      const handleChanged = (
        changes: { [key: string]: chrome.storage.StorageChange },
        areaName: string,
      ): void => {
        if (areaName !== 'local') return;
        const value: unknown = changes[GENUI_ENABLED_KEY]?.newValue;
        if (typeof value === 'boolean') listener(value);
      };
      chrome.storage.onChanged.addListener(handleChanged);
      return () => chrome.storage.onChanged.removeListener(handleChanged);
    },
  };
}
