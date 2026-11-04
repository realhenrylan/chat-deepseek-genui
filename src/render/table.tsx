import { useId, useMemo, useState } from 'react';
import type {
  GenuiBasis,
  GenuiSource,
  ModelTableElement,
  TableColumn,
  TableElement,
} from '../protocol/types';
import {
  basisKeyForElement,
  basisKeyForTableColumn,
  basisKeyForTableRow,
} from '../protocol/provenance';
import { lookupModel, modelTable } from '../runtime/evaluate';
import type { CompositeEvaluation } from '../runtime/evaluate';
import { buildTableModel, rowLabel } from './table-model';
import type { TableViewState } from './table-model';
import { BasisBadge } from './provenance';

/**
 * 表格视图（v3/v5）：列定义/条件行，或读取 v5 模型生成的表格快照；
 * 排序、筛选与候选选中属于视图状态。
 *
 * 单元格里的表达式只读取运行时已求值的结果；筛选/排序/选中属于视图状态，
 * 不改变文档参数。渲染与「继续讨论」摘要都走 table-model，保证用户看到的
 * 行、计数与摘要描述来自同一份计算结果。宽表被包在可聚焦的横向滚动容器内。
 */

type AnyTableElement = TableElement | ModelTableElement;

/** v5 模型表格先归一成经典列/行，渲染与摘要只走一条路径。 */
function resolveTableElement(
  element: AnyTableElement,
  evaluation: CompositeEvaluation,
): { element: TableElement; error?: string } {
  if (!('source' in element)) return { element };
  const model = lookupModel(evaluation, element.source.model);
  if (!model) return { element: { kind: 'table', columns: [], rows: [] }, error: '模型未求值' };
  if (!model.ok) {
    return { element: { kind: 'table', columns: [], rows: [] }, error: model.error ?? '模型计算失败' };
  }
  const view = modelTable(model, element.source.view);
  if (!view) {
    return { element: { kind: 'table', columns: [], rows: [] }, error: '模型表格视图不可用' };
  }
  return {
    element: {
      kind: 'table',
      title: element.title,
      columns: view.columns,
      rows: view.rows.map((cells) => ({ cells })),
      sortable: element.sortable,
      selectable: element.selectable,
      initialSort: element.initialSort,
      emptyText: view.emptyText ?? element.emptyText,
      visibleIf: element.visibleIf,
    },
  };
}

export function TableElementView({ element, evaluation, view, onViewChange, sources, basis, basisPath, today }: {
  element: AnyTableElement;
  evaluation: CompositeEvaluation;
  view?: TableViewState;
  onViewChange?: (view: TableViewState) => void;
  sources?: readonly GenuiSource[];
  basis?: Readonly<Record<string, GenuiBasis>>;
  basisPath?: string;
  today?: string;
}) {
  const resolved = useMemo(() => resolveTableElement(element, evaluation), [element, evaluation]);
  const table = resolved.element;
  const [localView, setLocalView] = useState<TableViewState>({
    filter: '',
    sort: table.initialSort ?? null,
    selected: null,
  });
  const groupName = useId();
  const controlled = onViewChange !== undefined;
  // 受控但父级还没写过视图时保持 undefined，让文档的 initialSort 生效；
  // 只有显式视图才覆盖初始排序（重置会删掉该表的视图状态）。
  const current: TableViewState | undefined = controlled ? view : localView;
  const filterText = current?.filter ?? '';

  // 视图状态在每次变化时都会被替换（受控时由父级 Card 生成新对象），因此以对象身份为依赖即可；
  // 单独列出字段反而会掩盖「父级原地修改」这种本组件不支持的行为。
  const model = useMemo(() => buildTableModel(table, evaluation, current), [table, evaluation, current]);

  /** 以当前生效视图（含 initialSort 回退）为基准生成完整视图状态。 */
  const changeView = (patch: Partial<TableViewState>) => {
    const next: TableViewState = {
      filter: current?.filter ?? '',
      sort: model.sort,
      selected: current?.selected ?? null,
      ...patch,
    };
    if (onViewChange) onViewChange(next);
    else setLocalView(next);
  };

  const toggleSort = (column: TableColumn) => {
    if (!table.sortable) return;
    const active = model.sort;
    const dir = active?.key === column.key && active.dir === 'asc' ? 'desc' : 'asc';
    changeView({ sort: { key: column.key, dir } });
  };

  const selectRow = (key: number) => {
    // 选中项与对比项不能是同一行；用户改选后旧对比项自动让位。
    changeView({ selected: key, compare: current?.compare === key ? null : current?.compare ?? null });
  };

  const clearSelection = () => {
    changeView({ selected: null, compare: null });
  };

  const selectable = table.selectable === true;
  const selectedRow =
    model.selectedKey === null ? undefined : model.rows.find((row) => row.key === model.selectedKey);
  const compareRow =
    model.compareKey === null ? undefined : model.rows.find((row) => row.key === model.compareKey);
  const compareOptions = model.sortedRows.filter((row) => row.key !== model.selectedKey);
  const columnCount = table.columns.length + (selectable ? 1 : 0);
  const emptyText =
    table.emptyText ?? (model.rows.length === 0 ? '没有可显示的数据' : '没有符合筛选条件的数据');
  const hasMissingCell = model.rows.some((row) =>
    Object.values(row.views).some((cell) => cell.missing === true),
  );
  const tableBasis =
    basis !== undefined && basisPath !== undefined
      ? basis[basisKeyForElement(basisPath)]
      : undefined;

  if (resolved.error) {
    return (
      <p className="genui-table-warning" role="status">
        {resolved.error}
      </p>
    );
  }

  let selectionNotice: string | null = null;
  if (selectable) {
    if (model.selectedMissing) selectionNotice = '已选候选项已不存在，请重新选择。';
    else if (model.selectedHidden) selectionNotice = '已选候选项不在当前筛选结果中。';
    else if (selectedRow) {
      selectionNotice = `已选候选项：${rowLabel(selectedRow, table.columns)}`;
      if (model.compareMissing) selectionNotice += '；对比候选项已不存在。';
      else if (model.compareHidden) selectionNotice += '；对比候选项不在当前筛选结果中。';
      else if (compareRow) selectionNotice += `；对比候选项：${rowLabel(compareRow, table.columns)}`;
    } else if (model.sortedRows.length > 0) selectionNotice = '可点击行首圆点选中候选项。';
  }

  return (
    <div className="genui-table-block">
      {tableBasis === undefined ? null : (
        <p className="genui-table-basis">
          <BasisBadge basis={tableBasis} sources={sources} today={today} label="表格依据" />
        </p>
      )}
      {model.warnings.length > 0 ? (
        <p className="genui-table-warning" role="status">
          {model.warnings.length === 1
            ? model.warnings[0]
            : `${model.warnings.length} 项无法计算：${model.warnings.join('；')}`}
        </p>
      ) : null}
      {table.sortable || selectable || table.rows.length > 3 ? (
        <div className="genui-table-toolbar">
          <label className="genui-table-filter">
            <span className="genui-visually-hidden">筛选表格</span>
            <input
              type="search"
              value={filterText}
              placeholder="筛选…"
              onChange={(event) => changeView({ filter: event.currentTarget.value })}
            />
          </label>
          {table.sortable ? <span className="genui-table-hint">点击列标题排序</span> : null}
          {selectable && model.selectedKey !== null && compareOptions.length > 0 ? (
            <label className="genui-table-compare">
              <span className="genui-visually-hidden">选择对比候选项</span>
              <select
                value={model.compareKey === null ? '' : String(model.compareKey)}
                aria-label="选择对比候选项"
                onChange={(event) => {
                  const raw = event.currentTarget.value;
                  changeView({ compare: raw === '' ? null : Number(raw) });
                }}
              >
                <option value="">对比项：未指定</option>
                {compareOptions.map((row) => (
                  <option key={row.key} value={String(row.key)}>
                    {`对比：${rowLabel(row, table.columns)}`}
                  </option>
                ))}
                {/* 已指定但被筛选隐藏的对比项仍保留在选项里，避免控件显示成「未指定」。 */}
                {compareRow && !model.sortedRows.some((row) => row.key === compareRow.key) ? (
                  <option value={String(compareRow.key)}>
                    {`对比：${rowLabel(compareRow, table.columns)}（不在筛选结果中）`}
                  </option>
                ) : null}
              </select>
            </label>
          ) : null}
          {selectable && model.selectedKey !== null ? (
            <button type="button" className="genui-table-clear-selection" onClick={clearSelection}>
              清除选择
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        className="genui-table-scroll"
        role="region"
        aria-label={table.title ? `${table.title}（可横向滚动）` : '表格（可横向滚动）'}
        tabIndex={0}
      >
        <table className="genui-table">
          {table.title ? <caption className="genui-table-caption">{table.title}</caption> : null}
          <thead>
            <tr>
              {selectable ? (
                <th scope="col" className="genui-table-select">
                  <span className="genui-visually-hidden">选择候选项</span>
                </th>
              ) : null}
              {table.columns.map((column) => {
                const active = model.sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      active ? (model.sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                  >
                    {table.sortable ? (
                      <button type="button" className="genui-table-sort" onClick={() => toggleSort(column)}>
                        {column.label}
                        <span aria-hidden="true" className="genui-table-sort-icon">
                          {active ? (model.sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    ) : (
                      column.label
                    )}
                    {basis !== undefined && basisPath !== undefined ? (
                      <BasisBadge
                        basis={basis[basisKeyForTableColumn(basisPath, table.columns.indexOf(column))]}
                        sources={sources}
                        today={today}
                        label="列依据"
                      />
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {model.sortedRows.length === 0 ? (
              <tr>
                <td className="genui-table-empty" colSpan={columnCount}>{emptyText}</td>
              </tr>
            ) : (
              model.sortedRows.map((row) => (
                <tr
                  key={row.key}
                  className={
                    model.selectedKey === row.key
                      ? 'genui-table-selected'
                      : model.compareKey === row.key
                        ? 'genui-table-compare-row'
                        : undefined
                  }
                >
                  {selectable ? (
                    <td className="genui-table-select">
                      <input
                        type="radio"
                        className="genui-table-select-input"
                        name={groupName}
                        checked={model.selectedKey === row.key}
                        aria-label={`选择候选项：${rowLabel(row, table.columns)}`}
                        onChange={() => selectRow(row.key)}
                      />
                    </td>
                  ) : null}
                  {table.columns.map((column) => {
                    const cell = row.views[column.key];
                    return (
                      <td
                        key={column.key}
                        className={column.numeric ? 'genui-table-numeric' : undefined}
                        title={cell?.missing ? '缺失值（不是 0）' : undefined}
                      >
                        {cell?.text ?? '—'}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {hasMissingCell ? (
        <p className="genui-table-missing-note">
          — 表示缺失值，不是 0；缺少的单元格不会参与数值比较。
        </p>
      ) : null}
      {basis !== undefined && basisPath !== undefined
        ? (() => {
            const rowsWithBasis = table.rows
              .map((row, index) => ({ row, index }))
              .filter(({ index }) => basis[basisKeyForTableRow(basisPath, index)] !== undefined);
            if (rowsWithBasis.length === 0) return null;
            return (
              <div className="genui-table-row-bases">
                {rowsWithBasis.map(({ index }) => (
                  <p className="genui-table-row-basis" key={index}>
                    第 {index + 1} 行：
                    <BasisBadge
                      basis={basis[basisKeyForTableRow(basisPath, index)]}
                      sources={sources}
                      today={today}
                    />
                  </p>
                ))}
              </div>
            );
          })()
        : null}
      {selectionNotice ? (
        <p className="genui-table-selection" role="status">
          {selectionNotice}
        </p>
      ) : null}
      <p className="genui-table-count" role="status">
        显示 {model.sortedRows.length} / {model.rows.length} 行
      </p>
    </div>
  );
}
