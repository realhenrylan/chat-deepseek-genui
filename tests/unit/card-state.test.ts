import { describe, expect, it } from 'vitest';
import {
  CARD_STATE_VERSION,
  documentStateSignature,
  isCompatibleSavedState,
  restoreCardUiState,
  sanitizeCardValues,
  sanitizeTableViews,
  type SavedCardState,
} from '../../src/runtime/card-state';
import type {
  GenuiDocument,
  NumberStateVariable,
  SelectStateVariable,
  StateVariable,
} from '../../src/protocol/types';

/**
 * issue #2 收尾：保存记录的校验、清洗与恢复。
 *
 * 关注「零串值」：范围外、步长不对齐、选项已删除、结构变更的记录
 * 一律回落初始值，并如实报告被丢弃的字段。
 */

function numberVar(overrides: Partial<NumberStateVariable> = {}): NumberStateVariable {
  return {
    id: 'budget',
    label: '总预算',
    kind: 'number',
    initial: 5000,
    min: 0,
    max: 10000,
    step: 100,
    ...overrides,
  };
}

function selectVar(overrides: Partial<SelectStateVariable> = {}): SelectStateVariable {
  return {
    id: 'plan',
    label: '方案',
    kind: 'select',
    initial: 'basic',
    options: [
      { label: '基础', value: 'basic' },
      { label: '进阶', value: 'pro' },
    ],
    ...overrides,
  };
}

function v2Doc(state: StateVariable[] = [numberVar(), selectVar()]): GenuiDocument {
  return { type: 'genui', version: 2, state, derived: [], elements: [] };
}

function savedRecord(overrides: Partial<SavedCardState> = {}): SavedCardState {
  const doc = v2Doc();
  return {
    stateVersion: CARD_STATE_VERSION,
    documentHash: 'hash-1',
    stateSignature: documentStateSignature(doc),
    accountId: 'acct-1',
    sessionId: '/a/chat/s/session-1',
    messageKey: 'v1',
    duplicateIndex: 0,
    savedAt: 1_700_000_000_000,
    values: { budget: 6000, plan: 'pro' },
    tables: {},
    ...overrides,
  };
}

describe('documentStateSignature', () => {
  it('v1 使用固定签名', () => {
    const doc: GenuiDocument = { type: 'genui', version: 1, elements: [] };
    expect(documentStateSignature(doc)).toBe('v1');
  });

  it('同结构文档签名稳定，不同结构签名变化', () => {
    const base = documentStateSignature(v2Doc());
    expect(documentStateSignature(v2Doc())).toBe(base);

    // 数值范围变化（同文档哈希的极端情况）也必须被视为不兼容。
    const wider = v2Doc([numberVar({ max: 12000 }), selectVar()]);
    expect(documentStateSignature(wider)).not.toBe(base);

    // 选项集合变化同样改变签名。
    const reordered = v2Doc([
      numberVar(),
      selectVar({
        options: [
          { label: '进阶', value: 'pro' },
          { label: '基础', value: 'basic' },
        ],
      }),
    ]);
    expect(documentStateSignature(reordered)).not.toBe(base);
  });
});

describe('sanitizeCardValues', () => {
  it('保留合法值', () => {
    const { values, dropped } = sanitizeCardValues(v2Doc(), { budget: 7000, plan: 'pro' });
    expect(values).toEqual({ budget: 7000, plan: 'pro' });
    expect(dropped).toEqual([]);
  });

  it('范围外与步长不对齐的数值回落初始值并报告', () => {
    const doc = v2Doc();
    const outOfRange = sanitizeCardValues(doc, { budget: 12000 });
    expect(outOfRange.values.budget).toBe(5000);
    expect(outOfRange.dropped).toEqual(['budget']);

    const misaligned = sanitizeCardValues(doc, { budget: 5050 });
    expect(misaligned.values.budget).toBe(5000);
    expect(misaligned.dropped).toEqual(['budget']);
  });

  it('已删除的选项回落初始值并报告', () => {
    const doc = v2Doc();
    const { values, dropped } = sanitizeCardValues(doc, { plan: 'legacy' });
    expect(values.plan).toBe('basic');
    expect(dropped).toEqual(['plan']);
  });

  it('缺失字段使用初始值且不报告丢弃', () => {
    const { values, dropped } = sanitizeCardValues(v2Doc(), {});
    expect(values).toEqual({ budget: 5000, plan: 'basic' });
    expect(dropped).toEqual([]);
  });

  it('v1 文档不保留任何状态值', () => {
    const doc: GenuiDocument = { type: 'genui', version: 1, elements: [] };
    expect(sanitizeCardValues(doc, { anything: 1 })).toEqual({ values: {}, dropped: [] });
  });
});

describe('sanitizeTableViews', () => {
  it('保留合法的筛选、排序与选中项', () => {
    const views = sanitizeTableViews({
      'elements[0]': {
        filter: '房租',
        sort: { key: 'amount', dir: 'desc' },
        selected: 2,
        compare: 0,
      },
    });
    expect(views).toEqual({
      'elements[0]': {
        filter: '房租',
        sort: { key: 'amount', dir: 'desc' },
        selected: 2,
        compare: 0,
      },
    });
  });

  it('截断超长筛选文本并丢弃非法排序形状', () => {
    const longFilter = 'x'.repeat(260);
    const views = sanitizeTableViews({
      'elements[0]': { filter: longFilter, sort: { key: '', dir: 'asc' } },
      'elements[1]': { filter: '', sort: { key: 'amount', dir: 'sideways' } },
    });
    expect(views['elements[0]']?.filter).toHaveLength(200);
    expect(views['elements[0]']?.sort).toBeNull();
    expect(views['elements[1]']?.sort).toBeNull();
  });

  it('对比项与选中项相同时省略，非法行序号视为未指定', () => {
    const views = sanitizeTableViews({
      'elements[0]': { filter: '', sort: null, selected: 1, compare: 1 },
      'elements[1]': { filter: '', sort: null, selected: -1, compare: 1.5 },
    });
    expect(views['elements[0]']).toEqual({ filter: '', sort: null, selected: 1 });
    expect(views['elements[1]']).toEqual({ filter: '', sort: null });
  });

  it('丢弃空路径并限制条目数', () => {
    const input: Record<string, unknown> = { '': { filter: 'a' } };
    for (let index = 0; index < 45; index += 1) {
      input[`elements[${index}]`] = { filter: '', sort: null };
    }
    const views = sanitizeTableViews(input);
    expect(Object.hasOwn(views, '')).toBe(false);
    expect(Object.keys(views)).toHaveLength(40);
  });

  it('非对象输入返回空映射', () => {
    expect(sanitizeTableViews(null)).toEqual({});
    expect(sanitizeTableViews('x')).toEqual({});
  });
});

describe('restoreCardUiState', () => {
  it('组合清洗后的值与表格视图', () => {
    const restored = restoreCardUiState(v2Doc(), {
      values: { budget: 9000, plan: 'missing' },
      tables: { 'elements[0]': { filter: '房租', sort: null } },
    });
    expect(restored.state.values).toEqual({ budget: 9000, plan: 'basic' });
    expect(restored.state.tables).toEqual({ 'elements[0]': { filter: '房租', sort: null } });
    expect(restored.dropped).toEqual(['plan']);
  });
});

describe('isCompatibleSavedState', () => {
  it('版本、文档哈希与结构签名全部匹配时才兼容', () => {
    const doc = v2Doc();
    const saved = savedRecord();
    expect(isCompatibleSavedState(saved, doc, 'hash-1')).toBe(true);

    expect(isCompatibleSavedState({ ...saved, stateVersion: 99 }, doc, 'hash-1')).toBe(false);
    expect(isCompatibleSavedState(saved, doc, 'hash-2')).toBe(false);
    expect(
      isCompatibleSavedState({ ...saved, stateSignature: 'stale' }, doc, 'hash-1'),
    ).toBe(false);
  });
});
