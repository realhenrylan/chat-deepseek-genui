import {
  CARD_STATE_VERSION,
  type SavedCardState,
  type SavedStateClearResult,
  type SavedStateSaveResult,
} from './card-state';

/**
 * 「保存当前界面」的本机存储（issue #2 收尾）。
 *
 * - 只在用户点击保存时写入；关闭扩展或未点击时不留任何卡片状态；
 * - 一条记录一个 storage 键，避免多标签页同时保存时互相覆盖整份映射；
 * - 保存后按 savedAt 保留最近 MAX_SAVED_STATES 条，超出时删除最旧记录；
 * - 读取时丢弃版本不符、字段缺失或异常巨大的记录，避免损坏数据占用容量；
 * - 只使用 chrome.storage.local，不做云同步或上传。
 */

export const SAVED_STATE_KEY_PREFIX = 'genuiSavedState:';
export const MAX_SAVED_STATES = 50;
/** 单条记录的字符数上限（存储损坏/异常值防护）。 */
export const MAX_SAVED_STATE_CHARS = 32 * 1024;
const MAX_STATE_FIELDS = 64;
const MAX_TABLE_VIEWS = 40;

/** chrome.storage.local 的最小异步接口，便于单测注入内存实现。 */
export interface SavedStateStorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface SavedStateStore {
  loadAll(): Promise<Record<string, SavedCardState>>;
  save(key: string, saved: SavedCardState): Promise<SavedStateSaveResult>;
  remove(key: string): Promise<SavedStateClearResult>;
}

export function describeStorageError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/quota/i.test(message)) return '本机存储空间不足（QUOTA_BYTES）';
  return message.trim() || '本机存储不可用';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  return typeof value === 'string' && value.length > 0;
}

/** 校验一条持久化记录；版本不符或结构异常时拒绝，不做猜测性迁移。 */
export function isSavedCardState(value: unknown): value is SavedCardState {
  if (!isPlainRecord(value)) return false;
  if (value.stateVersion !== CARD_STATE_VERSION) return false;
  if (!hasString(value, 'documentHash')) return false;
  if (!hasString(value, 'stateSignature')) return false;
  if (!hasString(value, 'accountId')) return false;
  if (!hasString(value, 'sessionId')) return false;
  if (!hasString(value, 'messageKey')) return false;
  if (typeof value.duplicateIndex !== 'number' || !Number.isInteger(value.duplicateIndex)) {
    return false;
  }
  if (value.duplicateIndex < 0) return false;
  if (typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) return false;
  if (!isPlainRecord(value.values)) return false;
  if (Object.keys(value.values).length > MAX_STATE_FIELDS) return false;
  if (!isPlainRecord(value.tables)) return false;
  if (Object.keys(value.tables).length > MAX_TABLE_VIEWS) return false;
  if (JSON.stringify(value).length > MAX_SAVED_STATE_CHARS) return false;
  return true;
}

/** 按 savedAt 从新到旧排序；读取与容量淘汰共用同一口径。 */
export function sortSavedStates(
  saved: Record<string, SavedCardState>,
): Array<[string, SavedCardState]> {
  return Object.entries(saved).sort((left, right) => {
    const delta = right[1].savedAt - left[1].savedAt;
    return delta !== 0 ? delta : left[0].localeCompare(right[0]);
  });
}

function storageKey(key: string): string {
  return `${SAVED_STATE_KEY_PREFIX}${key}`;
}

function identityKey(key: string): string | null {
  if (!key.startsWith(SAVED_STATE_KEY_PREFIX)) return null;
  const trimmed = key.slice(SAVED_STATE_KEY_PREFIX.length);
  return trimmed.length > 0 ? trimmed : null;
}

export function createSavedStateStore(
  area: SavedStateStorageArea,
  limit = MAX_SAVED_STATES,
): SavedStateStore {
  const max = Math.max(1, limit);

  async function loadAll(): Promise<Record<string, SavedCardState>> {
    const stored = await area.get(null);
    const saved: Record<string, SavedCardState> = {};
    for (const [key, value] of Object.entries(stored)) {
      const id = identityKey(key);
      if (!id || !isSavedCardState(value)) continue;
      saved[id] = value;
    }
    return saved;
  }

  return {
    loadAll,

    async save(key, record) {
      try {
        const saved = await loadAll();
        saved[key] = record;
        const ordered = sortSavedStates(saved);
        const kept = ordered.slice(0, max);
        const evicted = ordered.slice(max);

        await area.set({ [storageKey(key)]: record });
        if (evicted.length > 0) {
          await area.remove(evicted.map(([id]) => storageKey(id)));
        }
        // 新记录本身也可能因时间戳异常被淘汰；如实反馈，不留下幽灵状态。
        const retained = kept.some(([id]) => id === key);
        if (!retained) {
          return { ok: false, message: '保存失败：已保存的设置列表已满，当前记录未能保留。' };
        }
        return { ok: true, savedAt: record.savedAt, evicted: evicted.length };
      } catch (error) {
        return { ok: false, message: `保存失败：${describeStorageError(error)}` };
      }
    },

    async remove(key) {
      try {
        await area.remove(storageKey(key));
        return { ok: true };
      } catch (error) {
        return { ok: false, message: `清除失败：${describeStorageError(error)}` };
      }
    },
  };
}

/** 生产适配：缺少扩展存储 API（单测/非扩展页面）时返回 null。 */
export function createChromeSavedStateStore(): SavedStateStore | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null;
  }
  const area: SavedStateStorageArea = {
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove(keys),
  };
  return createSavedStateStore(area);
}
