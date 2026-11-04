import { describe, expect, it } from 'vitest';
import type { GenuiDocument } from '../../src/protocol/types';
import {
  CARD_STATE_VERSION,
  createCardUiState,
  documentStateSignature,
  isCompatibleSavedPlan,
  restoreCardUiState,
  sanitizeCardValues,
  sanitizeTableViews,
  type SavedCardPlan,
} from '../../src/runtime/card-state';

/**
 * issue #2：卡片状态结构与校验。
 *
 * 重点覆盖「不兼容就重置」：结构版本、文档哈希与状态范围任一不符时，
 * 保存的记录都不能套用到新文档。
 */

const DOC: GenuiDocument = {
  type: 'genui',
  version: 2,
  title: '预算',
  state: [
    {
      id: 'budget',
      label: '总预算',
      kind: 'number',
      initial: 5000,
      min: 0,
      max: 10000,
      step: 100,
      unit: '元',
    },
    {
      id: 'category',
      label: '类别',
      kind: 'select',
      initial: 'food',
      options: [
        { label: '餐饮', value: 'food' },
        { label: '交通', value: 'transport' },
      ],
    },
  ],
  derived: [],
  elements: [{ kind: 'value', label: '当前预算', source: { kind: 'state', id: 'budget' } }],
};

const V1: GenuiDocument = {
  type: 'genui',
  version: 1,
  elements: [{ kind: 'text', value: '旧卡片' }],
};

function savedPlan(overrides: Partial<SavedCardPlan> = {}): SavedCardPlan {
  return {
    stateVersion: CARD_STATE_VERSION,
    documentHash: 'hash-1',
    stateSignature: documentStateSignature(DOC),
    accountId: 'acct-user',
    sessionId: '/a/chat/s/session-1',
    messageKey: 'vl:1',
    duplicateIndex: 0,
    savedAt: 1_700_000_000_000,
    values: { budget: 5000, category: 'food' },
    tables: {},
    ...overrides,
  };
}

describe('卡片状态：初始值与文档签名', () => {
  it('初始值来自协议 state；v1 没有交互状态', () => {
    expect(createCardUiState(DOC)).toEqual({
      values: { budget: 5000, category: 'food' },
      tables: {},
    });
    expect(createCardUiState(V1)).toEqual({ values: {}, tables: {} });
  });

  it('状态签名对同一文档稳定，取值域变化后失效', () => {
    const signature = documentStateSignature(DOC);
    expect(documentStateSignature(DOC)).toBe(signature);
    expect(signature).not.toBe('v1');

    const widened: GenuiDocument = {
      ...DOC,
      state: DOC.state.map((item) =>
        item.id === 'budget' ? { ...item, max: 20000 } : item,
      ),
    };
    expect(documentStateSignature(widened)).not.toBe(signature);
    expect(documentStateSignature(V1)).toBe('v1');
  });
});

describe('卡片状态：按当前文档清洗输入', () => {
  it('只保留仍在范围内、类型匹配且步长对齐的值', () => {
    const result = sanitizeCardValues(DOC, {
      budget: 7000,
      category: 'transport',
      unknown: 1,
    });

    expect(result.values).toEqual({ budget: 7000, category: 'transport' });
    expect(result.dropped).toEqual([]);
  });

  it('越界、步长不符、选项失效与类型错误回落初始值并记录', () => {
    const outOfRange = sanitizeCardValues(DOC, { budget: 20000, category: 'food' });
    expect(outOfRange.values.budget).toBe(5000);
    expect(outOfRange.dropped).toEqual(['budget']);

    const misaligned = sanitizeCardValues(DOC, { budget: 5050, category: 'food' });
    expect(misaligned.values.budget).toBe(5000);
    expect(misaligned.dropped).toEqual(['budget']);

    const badSelect = sanitizeCardValues(DOC, { budget: 5000, category: 'hotel' });
    expect(badSelect.values.category).toBe('food');
    expect(badSelect.dropped).toEqual(['category']);

    const wrongType = sanitizeCardValues(DOC, { budget: '7000', category: 1 });
    expect(wrongType.values).toEqual({ budget: 5000, category: 'food' });
    expect(wrongType.dropped).toEqual(['budget', 'category']);
  });

  it('缺失字段使用初始值且不视为丢弃；非对象输入安全重置', () => {
    expect(sanitizeCardValues(DOC, {})).toEqual({
      values: { budget: 5000, category: 'food' },
      dropped: [],
    });
    expect(sanitizeCardValues(DOC, null).values).toEqual({ budget: 5000, category: 'food' });
    expect(sanitizeCardValues(V1, { budget: 1 })).toEqual({ values: {}, dropped: [] });
  });
});

describe('卡片状态：表格视图清洗', () => {
  it('保留合法筛选与排序，丢弃非法排序形状', () => {
    expect(
      sanitizeTableViews({
        'root-1': { filter: '房租', sort: { key: 'amount', dir: 'desc' } },
        'root-2': { filter: '餐饮', sort: { key: 'amount', dir: 'sideways' } },
      }),
    ).toEqual({
      'root-1': { filter: '房租', sort: { key: 'amount', dir: 'desc' } },
      'root-2': { filter: '餐饮', sort: null },
    });
  });

  it('限制筛选长度、条目数量与键长', () => {
    const views = sanitizeTableViews({
      [`x${'a'.repeat(200)}`]: { filter: 'f', sort: null },
      'root-0': { filter: 'a'.repeat(300), sort: { key: 'k'.repeat(80), dir: 'asc' } },
    });
    expect(Object.keys(views)).toEqual(['root-0']);
    expect(views['root-0']?.filter).toHaveLength(200);
    expect(views['root-0']?.sort).toBeNull();

    const many = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [`p-${index}`, { filter: `${index}`, sort: null }]),
    );
    expect(Object.keys(sanitizeTableViews(many))).toHaveLength(40);
  });
});

describe('卡片状态：保存记录的兼容性与恢复', () => {
  const hash = 'hash-1';

  it('同状态版本、同文档哈希、同状态签名才兼容', () => {
    expect(isCompatibleSavedPlan(savedPlan(), DOC, hash)).toBe(true);
    expect(isCompatibleSavedPlan(savedPlan({ documentHash: 'other' }), DOC, hash)).toBe(false);
    expect(
      isCompatibleSavedPlan(savedPlan({ stateSignature: 'stale' }), DOC, hash),
    ).toBe(false);
    expect(
      isCompatibleSavedPlan(savedPlan({ stateVersion: CARD_STATE_VERSION + 1 }), DOC, hash),
    ).toBe(false);
  });

  it('恢复时再次清洗字段，保留下来的表格视图可用', () => {
    const restored = restoreCardUiState(DOC, savedPlan({
      values: { budget: 9000, category: 'invalid' },
      tables: { 'root-0': { filter: '交通', sort: { key: 'amount', dir: 'asc' } } },
    }));

    expect(restored.state.values).toEqual({ budget: 9000, category: 'food' });
    expect(restored.dropped).toEqual(['category']);
    expect(restored.state.tables).toEqual({
      'root-0': { filter: '交通', sort: { key: 'amount', dir: 'asc' } },
    });
  });
});
