import type {
  NumericExpression,
  TableCell,
  TableColumn,
  TableElement,
  TableRow,
} from '../protocol/types';
import { lookupCondition, lookupExpression } from '../runtime/evaluate';
import type { CompositeEvaluation } from '../runtime/evaluate';
import { formatNumber } from './format';

/**
 * 表格视图模型（issue #5）：把「文档 + 求值快照 + 筛选/排序/选中」折叠成
 * 一份可复用的只读结果。
 *
 * 渲染与「继续讨论」摘要必须消费同一个模型，避免用户看到的行、计数、
 * 选中项与摘要里的描述来自两次不同的计算（例如旧人数配新金额）。
 * 这里不持有 React 状态，也不修改文档。
 */

/** 表格的筛选、排序与选中项（视图状态，不改变文档 state）。 */
export interface TableViewState {
  filter: string;
  sort: TableSortState | null;
  /** 选中的候选项：文档中的原始行序号（0 基），排序/筛选不改变它。 */
  selected?: number | null;
}

export interface CellView {
  text: string;
  numeric?: number;
  /** 仅数值单元格携带单位，供摘要比较差异时使用。 */
  unit?: string;
  error?: string;
}

export interface TableRowView {
  /** 文档中的原始行序号（0 基），排序/筛选后仍保持不变。 */
  key: number;
  views: Record<string, CellView>;
}

export interface TableSortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface TableModel {
  /** 通过显示条件的行（未筛选）。 */
  rows: TableRowView[];
  /** 经过筛选、未排序的行。 */
  filteredRows: TableRowView[];
  /** 最终显示顺序。 */
  sortedRows: TableRowView[];
  conditionErrors: string[];
  cellErrors: string[];
  warnings: string[];
  /** 生效的筛选文本（未裁剪）。 */
  filter: string;
  /** 生效的排序；列不存在时忽略，回退 initialSort。 */
  sort: TableSortState | null;
  /** 已选候选项的原始行序号；未选择或表格不可选时为 null。 */
  selectedKey: number | null;
  /** 已选行仍能通过显示条件，但被当前筛选隐藏。 */
  selectedHidden: boolean;
  /** 已选行在当前文档中已不存在（显示条件失败或行被改写）。 */
  selectedMissing: boolean;
}

function isExpression(cell: TableCell): cell is NumericExpression {
  return typeof cell === 'object' && cell !== null;
}

export function evaluateCell(
  cell: TableCell,
  column: TableColumn,
  evaluation: CompositeEvaluation,
): CellView {
  if (cell === null || cell === undefined) return { text: '—' };
  if (isExpression(cell)) {
    const result = lookupExpression(evaluation, cell);
    if (!result.ok) return { text: '—', error: result.error };
    const unit = column.unit ? ` ${column.unit}` : '';
    return {
      text: `${formatNumber(result.value)}${unit}`,
      numeric: result.value,
      unit: column.unit,
    };
  }
  if (typeof cell === 'number') {
    const unit = column.unit ? ` ${column.unit}` : '';
    return {
      text: Number.isFinite(cell) ? `${formatNumber(cell)}${unit}` : '—',
      numeric: cell,
      unit: column.unit,
    };
  }
  return { text: cell };
}

export function compareTableRows(
  left: TableRowView,
  right: TableRowView,
  column: TableColumn,
  direction: 'asc' | 'desc',
): number {
  const a = left.views[column.key];
  const b = right.views[column.key];
  const aValue = a?.numeric;
  const bValue = b?.numeric;
  const numeric = column.numeric === true || aValue !== undefined || bValue !== undefined;
  let result: number;
  if (numeric) {
    if (aValue === undefined && bValue === undefined) result = 0;
    else if (aValue === undefined) return 1;
    else if (bValue === undefined) return -1;
    else result = aValue - bValue;
  } else {
    result = (a?.text ?? '').localeCompare(b?.text ?? '', 'zh-Hans-CN');
  }
  return direction === 'asc' ? result : -result;
}

/** 筛选/排序的生效值：列已不存在时忽略排序，缺省回退 initialSort。 */
export function resolveTableView(
  element: TableElement,
  view: TableViewState | undefined,
): { filter: string; sort: TableSortState | null } {
  const filter = typeof view?.filter === 'string' ? view.filter : '';
  const valid = (candidate: TableSortState | null | undefined): TableSortState | null =>
    candidate && element.columns.some((column) => column.key === candidate.key)
      ? { key: candidate.key, dir: candidate.dir }
      : null;
  // view 未提供时使用文档初始排序；显式 null 表示「不排序」；
  // 提供的排序键在列定义中已不存在时回退初始排序。
  const sort =
    view === undefined
      ? valid(element.initialSort)
      : view.sort === null
        ? null
        : valid(view.sort) ?? valid(element.initialSort);
  return { filter, sort };
}

/** 候选行的可见名称：取第一个有内容的文本单元格，缺失时退回行号。 */
export function rowLabel(row: TableRowView, columns: TableColumn[]): string {
  for (const column of columns) {
    const text = row.views[column.key]?.text;
    if (text && text !== '—') return text;
  }
  return `第 ${row.key + 1} 行`;
}

export function buildTableModel(
  element: TableElement,
  evaluation: CompositeEvaluation,
  view: TableViewState | undefined,
): TableModel {
  const { filter, sort } = resolveTableView(element, view);
  const conditionErrors: string[] = [];
  const cellErrors: string[] = [];

  const rows = element.rows.flatMap((row: TableRow, index: number) => {
    if (row.visibleIf) {
      const condition = lookupCondition(evaluation, row.visibleIf);
      if (!condition.ok) {
        conditionErrors.push(`第 ${index + 1} 行显示条件无法计算：${condition.error}`);
      } else if (!condition.value) {
        return [];
      }
    }
    const views: Record<string, CellView> = {};
    for (const column of element.columns) {
      // 只读取行对象自己的属性：列 key 允许 constructor 等名称，直接下标
      // 访问会命中 Object.prototype，把继承来的函数当成单元格内容。
      const cell = Object.hasOwn(row.cells, column.key) ? row.cells[column.key]! : null;
      const cellView = evaluateCell(cell, column, evaluation);
      if (cellView.error && !cellErrors.includes(cellView.error)) cellErrors.push(cellView.error);
      views[column.key] = cellView;
    }
    return [{ key: index, views }];
  });

  const normalizedFilter = filter.trim().toLocaleLowerCase('zh-Hans-CN');
  const filteredRows = normalizedFilter
    ? rows.filter((row) =>
        element.columns.some((column) =>
          (row.views[column.key]?.text ?? '').toLocaleLowerCase('zh-Hans-CN').includes(normalizedFilter),
        ),
      )
    : rows;

  const sortedRows = [...filteredRows];
  if (sort) {
    const column = element.columns.find((item) => item.key === sort.key);
    if (column) {
      sortedRows.sort((left, right) => compareTableRows(left, right, column, sort.dir));
    }
  }

  const rawSelected = view?.selected;
  const selectedKey =
    element.selectable === true &&
    typeof rawSelected === 'number' &&
    Number.isInteger(rawSelected) &&
    rawSelected >= 0
      ? rawSelected
      : null;
  const selectedVisible = selectedKey !== null && sortedRows.some((row) => row.key === selectedKey);
  const selectedKnown = selectedKey !== null && rows.some((row) => row.key === selectedKey);

  return {
    rows,
    filteredRows,
    sortedRows,
    conditionErrors,
    cellErrors,
    warnings: [...conditionErrors, ...cellErrors],
    filter,
    sort,
    selectedKey,
    selectedHidden: selectedKey !== null && !selectedVisible && selectedKnown,
    selectedMissing: selectedKey !== null && !selectedKnown,
  };
}
