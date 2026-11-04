import { useMemo, useState } from 'react';
import type {
  ModelTableElement,
  NumericExpression,
  TableCell,
  TableColumn,
  TableElement,
  TableRow,
} from '../protocol/types';
import { lookupCondition, lookupExpression, lookupModel, modelTable } from '../runtime/evaluate';
import type { CompositeEvaluation } from '../runtime/evaluate';
import type { TableViewState } from '../runtime/card-state';
import { formatNumber } from './format';

/**
 * 表格视图（v3/v5）：显式列定义/条件行，或读取 v5 模型生成的表格快照。
 * 单元格里的表达式只读取运行时已求值的结果；排序/筛选纯本地状态，
 * 不改变文档状态。宽表被包在可聚焦的横向滚动容器内，键盘用户可平移。
 */

type AnyTableElement = TableElement | ModelTableElement;

interface CellView {
  text: string;
  numeric?: number;
  error?: string;
}

type SortDirection = 'asc' | 'desc';

interface SortState {
  key: string;
  dir: SortDirection;
}

interface ResolvedTable {
  columns: TableColumn[];
  rows: TableRow[];
  emptyText?: string;
  error?: string;
}

function isExpression(cell: TableCell): cell is NumericExpression {
  return typeof cell === 'object' && cell !== null;
}

/** 把显式表格或模型视图归一成同一份列/行数据，渲染层只走一条路径。 */
function resolveTable(element: AnyTableElement, evaluation: CompositeEvaluation): ResolvedTable {
  if (!('source' in element)) {
    return { columns: element.columns, rows: element.rows, emptyText: element.emptyText };
  }
  const model = lookupModel(evaluation, element.source.model);
  if (!model) return { columns: [], rows: [], error: '模型未求值' };
  if (!model.ok) {
    return { columns: [], rows: [], error: model.error ?? '模型计算失败' };
  }
  const table = modelTable(model, element.source.view);
  if (!table) return { columns: [], rows: [], error: '模型表格视图不可用' };
  return {
    columns: table.columns,
    rows: table.rows.map((cells) => ({ cells })),
    emptyText: table.emptyText ?? element.emptyText,
  };
}

function evaluateCell(cell: TableCell, column: TableColumn, evaluation: CompositeEvaluation): CellView {
  if (cell === null || cell === undefined) return { text: '—' };
  if (isExpression(cell)) {
    const result = lookupExpression(evaluation, cell);
    if (!result.ok) return { text: '—', error: result.error };
    const unit = column.unit ? ` ${column.unit}` : '';
    return { text: `${formatNumber(result.value)}${unit}`, numeric: result.value };
  }
  if (typeof cell === 'number') {
    const unit = column.unit ? ` ${column.unit}` : '';
    return { text: Number.isFinite(cell) ? `${formatNumber(cell)}${unit}` : '—', numeric: cell };
  }
  return { text: cell };
}

function compareRows(
  left: { views: Record<string, CellView> },
  right: { views: Record<string, CellView> },
  column: TableColumn,
  direction: SortDirection,
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

export function TableElementView({ element, evaluation, view, onViewChange }: {
  element: AnyTableElement;
  evaluation: CompositeEvaluation;
  /** 卡片级表格视图状态；提供 onViewChange 时受控（筛选/排序跨挂载保留）。 */
  view?: TableViewState;
  onViewChange?: (view: TableViewState) => void;
}) {
  const data = useMemo(() => resolveTable(element, evaluation), [element, evaluation]);
  const controlled = onViewChange !== undefined;
  const [localFilter, setLocalFilter] = useState('');
  const [localSort, setLocalSort] = useState<SortState | null>(element.initialSort ?? null);
  const filter = controlled ? (view?.filter ?? '') : localFilter;
  // 没有表格视图记录时回退文档的 initialSort，保持首次渲染与重置后的行为。
  const rawSort = controlled ? (view?.sort ?? element.initialSort ?? null) : localSort;
  const sort =
    rawSort && data.columns.some((column) => column.key === rawSort.key) ? rawSort : null;

  const rendered = useMemo(() => {
    const conditionErrors: string[] = [];
    const cellErrors: string[] = [];
    const rows = data.rows.flatMap((row: TableRow, index: number) => {
      if (row.visibleIf) {
        const condition = lookupCondition(evaluation, row.visibleIf);
        if (!condition.ok) {
          conditionErrors.push(`第 ${index + 1} 行显示条件无法计算：${condition.error}`);
        } else if (!condition.value) {
          return [];
        }
      }
      const views: Record<string, CellView> = {};
      for (const column of data.columns) {
        // 只读取行对象自己的属性：列 key 允许 constructor 等名称，直接下标
        // 访问会命中 Object.prototype，把继承来的函数当成单元格内容。
        const cell = Object.hasOwn(row.cells, column.key) ? row.cells[column.key]! : null;
        const view = evaluateCell(cell, column, evaluation);
        if (view.error && !cellErrors.includes(view.error)) cellErrors.push(view.error);
        views[column.key] = view;
      }
      return [{ key: index, views }];
    });
    return { rows, conditionErrors, cellErrors };
  }, [data, evaluation]);

  const normalizedFilter = filter.trim().toLocaleLowerCase('zh-Hans-CN');
  const filtered = rendered.rows.filter((row) => {
    if (!normalizedFilter) return true;
    return data.columns.some((column) =>
      (row.views[column.key]?.text ?? '').toLocaleLowerCase('zh-Hans-CN').includes(normalizedFilter),
    );
  });

  const sorted = [...filtered];
  if (sort) {
    const column = data.columns.find((item) => item.key === sort.key);
    if (column) {
      sorted.sort((left, right) => compareRows(left, right, column, sort.dir));
    }
  }

  const warnings = [...rendered.conditionErrors, ...rendered.cellErrors];
  const columnCount = data.columns.length;
  const emptyText =
    data.emptyText ?? (rendered.rows.length === 0 ? '没有可显示的数据' : '没有符合筛选条件的数据');

  const changeFilter = (value: string) => {
    if (!controlled) {
      setLocalFilter(value);
      return;
    }
    onViewChange({ filter: value, sort });
  };

  const toggleSort = (column: TableColumn) => {
    if (!element.sortable) return;
    const next: SortState =
      sort?.key !== column.key
        ? { key: column.key, dir: 'asc' }
        : { key: column.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
    if (controlled) onViewChange({ filter, sort: next });
    else setLocalSort(next);
  };

  if (data.error) {
    return (
      <div className="genui-table-block">
        <p className="genui-table-warning" role="status">{data.error}</p>
      </div>
    );
  }

  return (
    <div className="genui-table-block">
      {warnings.length > 0 ? (
        <p className="genui-table-warning" role="status">
          {warnings.length === 1 ? warnings[0] : `${warnings.length} 项无法计算：${warnings.join('；')}`}
        </p>
      ) : null}
      {element.sortable || data.rows.length > 3 ? (
        <div className="genui-table-toolbar">
          <label className="genui-table-filter">
            <span className="genui-visually-hidden">筛选表格</span>
            <input
              type="search"
              value={filter}
              placeholder="筛选…"
              onChange={(event) => changeFilter(event.currentTarget.value)}
            />
          </label>
          {element.sortable ? <span className="genui-table-hint">点击列标题排序</span> : null}
        </div>
      ) : null}
      <div
        className="genui-table-scroll"
        role="region"
        aria-label={element.title ? `${element.title}（可横向滚动）` : '表格（可横向滚动）'}
        tabIndex={0}
      >
        <table className="genui-table">
          {element.title ? <caption className="genui-table-caption">{element.title}</caption> : null}
          <thead>
            <tr>
              {data.columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {element.sortable ? (
                      <button type="button" className="genui-table-sort" onClick={() => toggleSort(column)}>
                        {column.label}
                        <span aria-hidden="true" className="genui-table-sort-icon">
                          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td className="genui-table-empty" colSpan={columnCount}>{emptyText}</td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr key={row.key}>
                  {data.columns.map((column) => (
                    <td key={column.key} className={column.numeric ? 'genui-table-numeric' : undefined}>
                      {row.views[column.key]?.text ?? '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="genui-table-count" role="status">
        显示 {sorted.length} / {rendered.rows.length} 行
      </p>
    </div>
  );
}
