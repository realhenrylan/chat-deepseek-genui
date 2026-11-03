import {
  CARD_STATE_VERSION,
  type PlanClearResult,
  type PlanSaveResult,
  type SavedCardPlan,
} from '../runtime/card-state';

/**
 * 「保存方案」的本机存储（issue #2）。
 *
 * - 只在用户点击保存时写入；关闭扩展或未点击时不留任何卡片状态；
 * - 一条方案一个 storage 键，避免多标签页同时保存时互相覆盖整份映射；
 * - 保存后按 savedAt 保留最近 MAX_SAVED_PLANS 条，超出时删除最旧记录；
 * - 读取时丢弃版本不符、字段缺失或异常巨大的记录，避免损坏数据占用容量；
 * - 只使用 chrome.storage.local，不做云同步或上传。
 */

export const SAVED_PLAN_KEY_PREFIX = 'genuiPlan:';
export const MAX_SAVED_PLANS = 50;
/** 单条记录的字符数上限（存储损坏/异常值防护）。 */
export const MAX_SAVED_PLAN_CHARS = 32 * 1024;
const MAX_STATE_FIELDS = 64;
const MAX_TABLE_VIEWS = 40;

/** chrome.storage.local 的最小异步接口，便于单测注入内存实现。 */
export interface PlanStorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface PlanStore {
  loadAll(): Promise<Record<string, SavedCardPlan>>;
  save(key: string, plan: SavedCardPlan): Promise<PlanSaveResult>;
  remove(key: string): Promise<PlanClearResult>;
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
export function isSavedCardPlan(value: unknown): value is SavedCardPlan {
  if (!isPlainRecord(value)) return false;
  if (value.stateVersion !== CARD_STATE_VERSION) return false;
  if (!hasString(value, 'documentHash')) return false;
  if (!hasString(value, 'stateSignature')) return false;
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
  if (JSON.stringify(value).length > MAX_SAVED_PLAN_CHARS) return false;
  return true;
}

/** 按 savedAt 从新到旧排序；读取与容量淘汰共用同一口径。 */
export function sortSavedPlans(
  plans: Record<string, SavedCardPlan>,
): Array<[string, SavedCardPlan]> {
  return Object.entries(plans).sort((left, right) => {
    const delta = right[1].savedAt - left[1].savedAt;
    return delta !== 0 ? delta : left[0].localeCompare(right[0]);
  });
}

function storageKey(key: string): string {
  return `${SAVED_PLAN_KEY_PREFIX}${key}`;
}

function identityKey(key: string): string | null {
  if (!key.startsWith(SAVED_PLAN_KEY_PREFIX)) return null;
  const trimmed = key.slice(SAVED_PLAN_KEY_PREFIX.length);
  return trimmed.length > 0 ? trimmed : null;
}

export function createPlanStore(
  area: PlanStorageArea,
  limit = MAX_SAVED_PLANS,
): PlanStore {
  const max = Math.max(1, limit);

  return {
    async loadAll() {
      const stored = await area.get(null);
      const plans: Record<string, SavedCardPlan> = {};
      for (const [key, value] of Object.entries(stored)) {
        const id = identityKey(key);
        if (!id || !isSavedCardPlan(value)) continue;
        plans[id] = value;
      }
      return plans;
    },

    async save(key, plan) {
      try {
        const plans = await this.loadAll();
        plans[key] = plan;
        const ordered = sortSavedPlans(plans);
        const kept = ordered.slice(0, max);
        const evicted = ordered.slice(max);

        await area.set({ [storageKey(key)]: plan });
        if (evicted.length > 0) {
          await area.remove(evicted.map(([id]) => storageKey(id)));
        }
        // 新记录本身也可能因时间戳异常被淘汰；如实反馈，不留下幽灵状态。
        const retained = kept.some(([id]) => id === key);
        if (!retained) {
          return { ok: false, message: '保存失败：方案列表已满，当前记录未能保留。' };
        }
        return { ok: true, savedAt: plan.savedAt, evicted: evicted.length };
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
export function createChromePlanStore(): PlanStore | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null;
  }
  const area: PlanStorageArea = {
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove(keys),
  };
  return createPlanStore(area);
}
