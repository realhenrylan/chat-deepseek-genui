import { useMemo, useState } from 'react';
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
 * 表格视图（v3）：列定义、条件行、数值单元格、排序与筛选。
 *
 * 单元格里的表达式只读取运行时已求值的结果；排序/筛选纯本地状态，
 * 不改变文档状态。宽表被包在可聚焦的横向滚动容器内，键盘用户可平移。
 */

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

function isExpression(cell: TableCell): cell is NumericExpression {
  return typeof cell === 'object' && cell !== null;
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

export function TableElementView({ element, evaluation }: {
  element: TableElement;
  evaluation: CompositeEvaluation;
}) {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortState | null>(element.initialSort ?? null);

  const rendered = useMemo(() => {
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
        const view = evaluateCell(cell, column, evaluation);
        if (view.error && !cellErrors.includes(view.error)) cellErrors.push(view.error);
        views[column.key] = view;
      }
      return [{ key: index, views }];
    });
    return { rows, conditionErrors, cellErrors };
  }, [element, evaluation]);

  const normalizedFilter = filter.trim().toLocaleLowerCase('zh-Hans-CN');
  const filtered = rendered.rows.filter((row) => {
    if (!normalizedFilter) return true;
    return element.columns.some((column) =>
      (row.views[column.key]?.text ?? '').toLocaleLowerCase('zh-Hans-CN').includes(normalizedFilter),
    );
  });

  const sorted = [...filtered];
  if (sort) {
    const column = element.columns.find((item) => item.key === sort.key);
    if (column) {
      sorted.sort((left, right) => compareRows(left, right, column, sort.dir));
    }
  }

  const warnings = [...rendered.conditionErrors, ...rendered.cellErrors];
  const columnCount = element.columns.length;
  const emptyText = element.emptyText ?? (rendered.rows.length === 0 ? '没有可显示的数据' : '没有符合筛选条件的数据');

  const toggleSort = (column: TableColumn) => {
    if (!element.sortable) return;
    setSort((previous) => {
      if (previous?.key !== column.key) return { key: column.key, dir: 'asc' };
      return { key: column.key, dir: previous.dir === 'asc' ? 'desc' : 'asc' };
    });
  };

  return (
    <div className="genui-table-block">
      {warnings.length > 0 ? (
        <p className="genui-table-warning" role="status">
          {warnings.length === 1 ? warnings[0] : `${warnings.length} 项无法计算：${warnings.join('；')}`}
        </p>
      ) : null}
      {element.sortable || element.rows.length > 3 ? (
        <div className="genui-table-toolbar">
          <label className="genui-table-filter">
            <span className="genui-visually-hidden">筛选表格</span>
            <input
              type="search"
              value={filter}
              placeholder="筛选…"
              onChange={(event) => setFilter(event.currentTarget.value)}
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
              {element.columns.map((column) => {
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
                  {element.columns.map((column) => (
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
