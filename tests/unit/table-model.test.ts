import { describe, expect, it } from 'vitest';
import type { GenuiV3Document } from '../../src/protocol/types';
import { createInitialState, evaluateComposite } from '../../src/runtime/evaluate';
import { buildTableModel, resolveTableView, rowLabel } from '../../src/render/table-model';

/**
 * issue #5：表格视图模型。
 *
 * 渲染与「继续讨论」摘要共享这份模型；这里重点验证筛选/排序/选中项
 * 与行身份（文档原始序号）在视图变化后仍然一致。
 */

const DOC: GenuiV3Document = {
  type: 'genui',
  version: 3,
  title: '选购比较',
  state: [
    { id: 'threshold', label: '阈值', kind: 'number', initial: 1, min: 0, max: 10, step: 1 },
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
      ],
      rows: [
        { cells: { name: 'A', price: 4800, weight: 1.4 } },
        {
          cells: { name: 'B', price: 5600, weight: 1.6 },
          visibleIf: { op: 'num-gt', left: { op: 'state', id: 'threshold' }, right: { op: 'const', value: 0 } },
        },
        { cells: { name: 'C', price: 5200, weight: 1.3 } },
      ],
    },
  ],
};

const evaluation = evaluateComposite(DOC, createInitialState(DOC));
const table = DOC.elements[0];
if (table?.kind !== 'table') throw new Error('测试文档缺少表格元素');

describe('table-model', () => {
  it('默认视图按初始排序/筛选生成，行身份保持文档原始序号', () => {
    const model = buildTableModel(table, evaluation, undefined);
    expect(model.rows.map((row) => row.key)).toEqual([0, 1, 2]);
    expect(model.sortedRows.map((row) => row.views.name?.text)).toEqual(['A', 'B', 'C']);
    expect(model.filter).toBe('');
    expect(model.sort).toBeNull();
    expect(model.selectedKey).toBeNull();
  });

  it('筛选对任一列做大小写不敏感匹配，计数基于筛选后行数', () => {
    const model = buildTableModel(table, evaluation, { filter: ' a ', sort: null, selected: null });
    expect(model.sortedRows).toHaveLength(1);
    expect(model.sortedRows[0]?.views.name?.text).toBe('A');
    expect(model.rows).toHaveLength(3);
  });

  it('排序使用列单位/数值；选中项不随排序改变身份', () => {
    const model = buildTableModel(table, evaluation, {
      filter: '',
      sort: { key: 'price', dir: 'desc' },
      selected: 2,
    });
    expect(model.sortedRows.map((row) => row.views.name?.text)).toEqual(['B', 'C', 'A']);
    expect(model.selectedKey).toBe(2);
    expect(model.selectedHidden).toBe(false);
    expect(rowLabel(model.rows[2]!, table.columns)).toBe('C');
  });

  it('已选行被筛选隐藏时明确标记，而不是悄悄当成未选择', () => {
    const model = buildTableModel(table, evaluation, {
      filter: 'A',
      sort: null,
      selected: 2,
    });
    expect(model.selectedKey).toBe(2);
    expect(model.selectedHidden).toBe(true);
    expect(model.selectedMissing).toBe(false);
    expect(model.sortedRows).toHaveLength(1);
  });

  it('已选行在文档中不存在时标记 selectedMissing', () => {
    const model = buildTableModel(table, evaluation, { filter: '', sort: null, selected: 9 });
    expect(model.selectedHidden).toBe(false);
    expect(model.selectedMissing).toBe(true);
  });

  it('不可选的表格忽略选中值，避免摘要引用不存在的选择', () => {
    const plain = {
      ...table,
      selectable: undefined,
    };
    const model = buildTableModel(plain, evaluation, { filter: '', sort: null, selected: 1 });
    expect(model.selectedKey).toBeNull();
  });

  it('排序列不存在时回退 initialSort；initialSort 也无效时忽略排序', () => {
    const withInitial = { ...table, initialSort: { key: 'weight', dir: 'asc' as const } };
    expect(resolveTableView(withInitial, { filter: '', sort: { key: 'missing', dir: 'desc' }, selected: null }))
      .toEqual({ filter: '', sort: { key: 'weight', dir: 'asc' } });
    expect(resolveTableView(table, { filter: '', sort: { key: 'missing', dir: 'desc' }, selected: null }))
      .toEqual({ filter: '', sort: null });
  });

  it('显示条件失败时保留行并收集错误文案，不静默丢弃', () => {
    const broken = {
      ...table,
      rows: [
        {
          cells: { name: 'D', price: 1, weight: 1 },
          visibleIf: { op: 'num-gt' as const, left: { op: 'state' as const, id: 'missing' }, right: { op: 'const' as const, value: 0 } },
        },
      ],
    };
    const model = buildTableModel(broken, evaluation, undefined);
    expect(model.rows).toHaveLength(1);
    expect(model.conditionErrors[0]).toContain('第 1 行显示条件无法计算');
  });
});
