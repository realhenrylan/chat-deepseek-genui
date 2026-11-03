import { describe, expect, it } from 'vitest';
import type { GenuiV3Document, TableElement } from '../../src/protocol/types';
import { createInitialState, evaluateComposite } from '../../src/runtime/evaluate';
import { createContinueSnapshot } from '../../src/render/continue-snapshot';

/**
 * issue #5：继续讨论快照。
 *
 * 快照必须把参数、表格筛选/排序/选中项与草稿折叠成同一份输入，
 * 之后的预览编辑不再读取实时界面状态。
 */

const DOC: GenuiV3Document = {
  type: 'genui',
  version: 3,
  title: '选购比较',
  state: [
    { id: 'budget', label: '预算', kind: 'number', initial: 6000, min: 0, max: 20000, step: 100, unit: '元' },
  ],
  derived: [],
  elements: [
    {
      kind: 'table',
      title: '候选方案',
      sortable: true,
      selectable: true,
      columns: [
        { key: 'name', label: '方案' },
        { key: 'price', label: '价格', numeric: true, unit: '元' },
        { key: 'weight', label: '重量', numeric: true, unit: 'kg' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        { cells: { name: 'A', price: 4800, weight: 1.4, status: '在售' } },
        { cells: { name: 'C', price: 5200, weight: 1.3, status: '在售' } },
      ],
    },
  ],
};

const state = createInitialState(DOC);
const evaluation = evaluateComposite(DOC, state);

function snapshot(overrides: {
  drafts?: Record<string, string>;
  fieldErrors?: Record<string, string>;
  tables?: Record<string, { filter: string; sort: { key: string; dir: 'asc' | 'desc' } | null; selected?: number | null }>;
}) {
  return createContinueSnapshot({
    document: DOC,
    evaluation,
    stateValues: state,
    derivedValues: {},
    derivedErrors: {},
    drafts: overrides.drafts ?? {},
    fieldErrors: overrides.fieldErrors ?? {},
    tables: overrides.tables ?? {},
  });
}

describe('createContinueSnapshot', () => {
  it('把表格筛选/排序/选中项冻结成候选快照', () => {
    const result = snapshot({
      drafts: { budget: '6500' },
      fieldErrors: { budget: '输入超出允许范围或步长；当前状态值未更改。' },
      tables: {
        'root-0': { filter: '在售', sort: { key: 'price', dir: 'desc' }, selected: 1 },
      },
    });

    expect(result.hasSelection).toBe(true);
    expect(result.hasAlternative).toBe(true);
    expect(result.input.tables).toHaveLength(1);
    const table = result.input.tables![0]!;
    expect(table.title).toBe('候选方案');
    expect(table.filter).toBe('在售');
    expect(table.sort).toEqual({ label: '价格', dir: 'desc' });
    expect(table.totalRows).toBe(2);
    expect(table.visibleRows).toBe(2);
    expect(table.selected?.label).toBe('C');
    expect(table.selected?.cells).toContainEqual({ column: '价格', text: '5200 元', numeric: 5200, unit: '元' });
    expect(table.alternative?.label).toBe('A');
    expect(result.input.drafts).toEqual([{ label: '预算', raw: '6500', invalid: true }]);
    expect(result.input.stateValues).toBe(state);
  });

  it('已选行被筛选隐藏时如实标记，不再提供「已选」候选', () => {
    const result = snapshot({ tables: { 'root-0': { filter: 'A', sort: null, selected: 1 } } });
    const table = result.input.tables![0]!;
    expect(table.selectionHidden).toBe(true);
    expect(table.selected).toBeNull();
    expect(table.alternative).toBeNull();
    expect(result.hasSelection).toBe(false);
    expect(result.hasAlternative).toBe(false);
  });

  it('选中且恰有两行可见时生成对比候选', () => {
    const selected = snapshot({ tables: { 'root-0': { filter: '在售', sort: null, selected: 0 } } });
    const table = selected.input.tables![0]!;
    expect(table.selected?.label).toBe('A');
    expect(table.alternative?.label).toBe('C');
    expect(selected.hasAlternative).toBe(true);
  });

  it('没有筛选/排序/选中且不可选的表格不进入摘要', () => {
    const table = DOC.elements[0] as TableElement;
    const plainDoc: GenuiV3Document = {
      ...DOC,
      elements: [{ ...table, selectable: false }],
    };
    const result = createContinueSnapshot({
      document: plainDoc,
      evaluation: evaluateComposite(plainDoc, state),
      stateValues: state,
      derivedValues: {},
      derivedErrors: {},
      drafts: {},
      fieldErrors: {},
      tables: {},
    });
    expect(result.input.tables).toEqual([]);
  });

  it('草稿原文被截断且保留「无效」标记，不把未提交输入当已生效参数', () => {
    const longRaw = '1'.repeat(60);
    const result = snapshot({ drafts: { budget: longRaw } });
    expect(result.input.drafts?.[0]?.raw).toHaveLength(41);
    expect(result.input.drafts?.[0]?.raw.endsWith('…')).toBe(true);
    expect(result.input.drafts?.[0]?.invalid).toBeUndefined();
  });
});
