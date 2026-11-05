import { describe, expect, it } from 'vitest';
import {
  CARD_STATE_VERSION,
  type SavedCardState,
} from '../../src/runtime/card-state';
import {
  MAX_SAVED_STATES,
  SAVED_STATE_KEY_PREFIX,
  createSavedStateStore,
  describeStorageError,
  isSavedCardState,
  sortSavedStates,
  type SavedStateStorageArea,
} from '../../src/runtime/saved-card-state-store';

/**
 * 「保存当前界面」的本机存储（issue #2 收尾）。
 *
 * 关注：一条记录一个 storage 键、损坏记录被丢弃、容量淘汰按 savedAt、
 * 存储错误被翻译成用户能理解的提示，以及新记录本身被淘汰时如实失败。
 */

function savedRecord(overrides: Partial<SavedCardState> = {}): SavedCardState {
  return {
    stateVersion: CARD_STATE_VERSION,
    documentHash: 'hash-1',
    stateSignature: 'sig-1',
    accountId: 'acct-1',
    sessionId: '/a/chat/s/session-1',
    messageKey: 'v1',
    duplicateIndex: 0,
    savedAt: 1000,
    values: { budget: 6000 },
    tables: {},
    ...overrides,
  };
}

/** 内存版 chrome.storage.local：get(null) 返回全部条目。 */
function memoryArea(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const area: SavedStateStorageArea & { data: Record<string, unknown> } = {
    data,
    async get(keys) {
      if (keys === null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const key of list) {
        if (Object.hasOwn(data, key)) result[key] = data[key];
      }
      return result;
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
  return area;
}

describe('isSavedCardState', () => {
  it('接受完整记录', () => {
    expect(isSavedCardState(savedRecord())).toBe(true);
  });

  it('拒绝版本不符、缺字段与超限记录', () => {
    expect(isSavedCardState({ ...savedRecord(), stateVersion: 99 })).toBe(false);
    expect(isSavedCardState({ ...savedRecord(), documentHash: '' })).toBe(false);
    expect(isSavedCardState({ ...savedRecord(), values: null })).toBe(false);
    expect(isSavedCardState({ ...savedRecord(), savedAt: Number.NaN })).toBe(false);
    expect(isSavedCardState(null)).toBe(false);
    expect(isSavedCardState('record')).toBe(false);
  });
});

describe('describeStorageError', () => {
  it('把配额错误翻译为可读提示，其余保留原文', () => {
    expect(describeStorageError(new Error('QUOTA_BYTES quota exceeded'))).toBe(
      '本机存储空间不足（QUOTA_BYTES）',
    );
    expect(describeStorageError(new Error('storage unavailable'))).toBe('storage unavailable');
    expect(describeStorageError('')).toBe('本机存储不可用');
  });
});

describe('sortSavedStates', () => {
  it('按 savedAt 从新到旧，同一时间按键排序', () => {
    const ordered = sortSavedStates({
      b: savedRecord({ savedAt: 10 }),
      a: savedRecord({ savedAt: 20 }),
      c: savedRecord({ savedAt: 10 }),
    });
    expect(ordered.map(([key]) => key)).toEqual(['a', 'b', 'c']);
  });
});

describe('createSavedStateStore', () => {
  it('保存后可读回，storage 键带前缀', async () => {
    const area = memoryArea();
    const store = createSavedStateStore(area);
    const result = await store.save('card|v1|msg', savedRecord());

    expect(result).toEqual({ ok: true, savedAt: 1000, evicted: 0 });
    expect(Object.keys(area.data)).toEqual([`${SAVED_STATE_KEY_PREFIX}card|v1|msg`]);
    await expect(store.loadAll()).resolves.toEqual({ 'card|v1|msg': savedRecord() });
  });

  it('读取时丢弃前缀不符、版本不符与损坏记录', async () => {
    const area = memoryArea({
      'other:key': savedRecord(),
      [`${SAVED_STATE_KEY_PREFIX}ok`]: savedRecord(),
      [`${SAVED_STATE_KEY_PREFIX}bad-version`]: { ...savedRecord(), stateVersion: 99 },
      [`${SAVED_STATE_KEY_PREFIX}broken`]: { nope: true },
      [`${SAVED_STATE_KEY_PREFIX}`]: savedRecord(),
    });
    const store = createSavedStateStore(area);
    await expect(store.loadAll()).resolves.toEqual({ ok: savedRecord() });
  });

  it('超过容量时按 savedAt 淘汰最旧记录并报告数量', async () => {
    const area = memoryArea();
    const store = createSavedStateStore(area, 2);

    await store.save('oldest', savedRecord({ savedAt: 100 }));
    await store.save('middle', savedRecord({ savedAt: 200 }));
    const result = await store.save('newest', savedRecord({ savedAt: 300 }));

    expect(result).toEqual({ ok: true, savedAt: 300, evicted: 1 });
    await expect(store.loadAll()).resolves.toEqual({
      middle: savedRecord({ savedAt: 200 }),
      newest: savedRecord({ savedAt: 300 }),
    });
  });

  it('新记录自身被淘汰时返回失败，不留下幽灵状态', async () => {
    const area = memoryArea();
    const store = createSavedStateStore(area, 2);

    await store.save('a', savedRecord({ savedAt: 200 }));
    await store.save('b', savedRecord({ savedAt: 300 }));
    const result = await store.save('stale', savedRecord({ savedAt: 100 }));

    expect(result).toEqual({
      ok: false,
      message: '保存失败：已保存的设置列表已满，当前记录未能保留。',
    });
  });

  it('默认上限为 MAX_SAVED_STATES', () => {
    expect(MAX_SAVED_STATES).toBeGreaterThan(0);
  });

  it('存储错误被翻译成保存/清除失败提示', async () => {
    const area = memoryArea();
    area.set = async () => {
      throw new Error('QUOTA_BYTES quota exceeded');
    };
    const store = createSavedStateStore(area);
    await expect(store.save('card', savedRecord())).resolves.toEqual({
      ok: false,
      message: '保存失败：本机存储空间不足（QUOTA_BYTES）',
    });

    const failingArea = memoryArea();
    failingArea.remove = async () => {
      throw new Error('storage gone');
    };
    const failingStore = createSavedStateStore(failingArea);
    await expect(failingStore.remove('card')).resolves.toEqual({
      ok: false,
      message: '清除失败：storage gone',
    });
  });

  it('remove 删除对应 storage 键', async () => {
    const area = memoryArea();
    const store = createSavedStateStore(area);
    await store.save('card', savedRecord());

    await expect(store.remove('card')).resolves.toEqual({ ok: true });
    expect(area.data).toEqual({});
  });
});
