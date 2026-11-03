import { describe, expect, it } from 'vitest';
import {
  MAX_SAVED_PLANS,
  SAVED_PLAN_KEY_PREFIX,
  createPlanStore,
  isSavedCardPlan,
  sortSavedPlans,
  type PlanStorageArea,
} from '../../src/content/plan-store';
import {
  CARD_STATE_VERSION,
  type SavedCardPlan,
} from '../../src/runtime/card-state';

/**
 * issue #2：「保存方案」本机存储。
 *
 * 只验证存储契约：前缀、容量淘汰、损坏记录丢弃与失败反馈；
 * 不触碰真实 chrome.storage（生产适配器只做薄包装）。
 */

class FakeArea implements PlanStorageArea {
  readonly items = new Map<string, unknown>();
  failGet: Error | null = null;
  failSet: Error | null = null;
  failRemove: Error | null = null;

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (this.failGet) throw this.failGet;
    if (keys === null) return Object.fromEntries(this.items);
    const list = typeof keys === 'string' ? [keys] : keys;
    const result: Record<string, unknown> = {};
    for (const key of list) {
      if (this.items.has(key)) result[key] = this.items.get(key);
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (this.failSet) throw this.failSet;
    for (const [key, value] of Object.entries(items)) this.items.set(key, value);
  }

  async remove(keys: string | string[]): Promise<void> {
    if (this.failRemove) throw this.failRemove;
    for (const key of typeof keys === 'string' ? [keys] : keys) this.items.delete(key);
  }
}

function savedPlan(savedAt: number, overrides: Partial<SavedCardPlan> = {}): SavedCardPlan {
  return {
    stateVersion: CARD_STATE_VERSION,
    documentHash: 'doc-hash',
    stateSignature: 'sig',
    sessionId: '/a/chat/s/session',
    messageKey: 'vl:1',
    duplicateIndex: 0,
    savedAt,
    values: { budget: 7000 },
    tables: {},
    ...overrides,
  };
}

describe('保存方案存储：写入与读取', () => {
  it('一条记录一个前缀键，loadAll 还原身份键', async () => {
    const area = new FakeArea();
    const store = createPlanStore(area);

    const result = await store.save('card|1|s|vl:1|0|h', savedPlan(100));
    expect(result).toEqual({ ok: true, savedAt: 100, evicted: 0 });
    expect([...area.items.keys()]).toEqual([`${SAVED_PLAN_KEY_PREFIX}card|1|s|vl:1|0|h`]);

    const loaded = await store.loadAll();
    expect(Object.keys(loaded)).toEqual(['card|1|s|vl:1|0|h']);
    expect(loaded['card|1|s|vl:1|0|h']?.values).toEqual({ budget: 7000 });
  });

  it('同一身份再次保存会覆盖旧记录', async () => {
    const area = new FakeArea();
    const store = createPlanStore(area);

    await store.save('key', savedPlan(100, { values: { budget: 3000 } }));
    await store.save('key', savedPlan(200, { values: { budget: 8000 } }));

    expect(area.items.size).toBe(1);
    expect((await store.loadAll()).key?.values).toEqual({ budget: 8000 });
  });

  it('读取时丢弃损坏、版本不符与超长记录', async () => {
    const area = new FakeArea();
    area.items.set('unrelated', { any: true });
    area.items.set(`${SAVED_PLAN_KEY_PREFIX}bad`, { stateVersion: 99 });
    area.items.set(`${SAVED_PLAN_KEY_PREFIX}empty`, null);
    area.items.set(`${SAVED_PLAN_KEY_PREFIX}huge`, savedPlan(1, {
      tables: {
        'root-0': { filter: 'x'.repeat(40 * 1024), sort: null },
      },
    }));

    const loaded = await createPlanStore(area).loadAll();
    expect(loaded).toEqual({});
    expect(isSavedCardPlan(savedPlan(1))).toBe(true);
  });
});

describe('保存方案存储：容量与淘汰', () => {
  it('超过上限时删除最旧记录并返回淘汰数量', async () => {
    const area = new FakeArea();
    const store = createPlanStore(area, 2);

    await store.save('oldest', savedPlan(100));
    await store.save('middle', savedPlan(200));
    const result = await store.save('newest', savedPlan(300));

    expect(result).toEqual({ ok: true, savedAt: 300, evicted: 1 });
    expect(Object.keys(await store.loadAll()).sort()).toEqual(['middle', 'newest']);
    expect(area.items.has(`${SAVED_PLAN_KEY_PREFIX}oldest`)).toBe(false);
  });

  it('默认上限为 50，按 savedAt 从新到旧排序并稳定处理同一时刻', () => {
    expect(MAX_SAVED_PLANS).toBe(50);
    const ordered = sortSavedPlans({
      b: savedPlan(100),
      a: savedPlan(100),
      c: savedPlan(300),
    });
    expect(ordered.map(([key]) => key)).toEqual(['c', 'a', 'b']);
  });

  it('新记录时间戳异常而未被保留时如实反馈失败', async () => {
    const area = new FakeArea();
    const store = createPlanStore(area, 1);

    await store.save('current', savedPlan(500));
    const result = await store.save('stale', savedPlan(1));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('未能保留');
    expect(Object.keys(await store.loadAll())).toEqual(['current']);
  });
});

describe('保存方案存储：失败反馈', () => {
  it('写入配额不足时给出容量提示', async () => {
    const area = new FakeArea();
    area.failSet = new Error('QUOTA_BYTES quota exceeded');
    const result = await createPlanStore(area).save('key', savedPlan(1));

    expect(result).toEqual({
      ok: false,
      message: '保存失败：本机存储空间不足（QUOTA_BYTES）',
    });
  });

  it('读取异常时 loadAll 抛出，由调用方决定降级', async () => {
    const area = new FakeArea();
    area.failGet = new Error('storage unavailable');
    await expect(createPlanStore(area).loadAll()).rejects.toThrow('storage unavailable');
  });

  it('清除失败返回带前缀的提示', async () => {
    const area = new FakeArea();
    area.failRemove = new Error('permission denied');

    expect(await createPlanStore(area).remove('key')).toEqual({
      ok: false,
      message: '清除失败：permission denied',
    });
  });
});
