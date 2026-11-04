import type {
  GenuiV3Element,
  GenuiV4Element,
  GenuiV5Element,
  GenuiDocument,
  InteractiveStateValues,
  TableElement,
} from '../protocol/types';
import type { CompositeEvaluation } from '../runtime/evaluate';
import { lookupCondition } from '../runtime/evaluate';
import { buildTableModel, rowLabel } from './table-model';
import type { TableRowView, TableViewState } from './table-model';
import type {
  ContinueCandidate,
  ContinueSummaryInput,
  ContinueTableSnapshot,
} from './summarize';

/**
 * 点击「继续讨论」时冻结业务状态，生成摘要输入。
 *
 * 界面上的参数、派生结果、表格筛选/排序/选中项与草稿分别存在不同组件里；
 * 如果摘要每次预览都重新读取，用户改一个参数后旧摘要就可能配上新数值。
 * 因此这里只在点击瞬间读一次，之后预览与编辑只使用这份快照。
 * 表格路径必须与 composite.tsx 的渲染路径完全一致，否则会取错表格的视图状态。
 */

const MAX_TABLES = 4;
const MAX_DRAFT_CELLS = 6;
const MAX_DRAFT_LENGTH = 40;
const MAX_TABLE_ERRORS = 3;
/** 单元格文本进入摘要前的上限：避免单个超长单元格挤掉选中项与请求。 */
const MAX_CELL_TEXT = 40;

export interface ContinueSnapshotOptions {
  document: GenuiDocument;
  evaluation: CompositeEvaluation | null;
  stateValues: InteractiveStateValues;
  derivedValues: Record<string, number>;
  derivedErrors: Record<string, string>;
  drafts: Record<string, string>;
  fieldErrors: Record<string, string>;
  tables: Record<string, TableViewState>;
  /** v6：用户修改过的状态 id。 */
  editedState?: readonly string[];
  /** v6：生成摘要时的本地日期。 */
  today?: string;
}

export interface ContinueSnapshot {
  input: ContinueSummaryInput;
  hasSelection: boolean;
  hasAlternative: boolean;
}

interface TableSlot {
  path: string;
  element: TableElement;
  ordinal: number;
}

/** 与 CompositeElementsView 相同的遍历顺序与路径规则。 */
type SnapshotElement = GenuiV3Element | GenuiV4Element | GenuiV5Element;

function collectTables(
  elements: SnapshotElement[],
  path: string,
  slots: TableSlot[],
): void {
  elements.forEach((element, index) => {
    const elementPath = `${path}-${index}`;
    if (element.kind === 'table') {
      // v5 模型表格的数据来自模型快照，没有可选择的经典行；不进入摘要。
      if (!('rows' in element) || !Array.isArray(element.rows)) return;
      slots.push({ path: elementPath, element, ordinal: slots.length + 1 });
      return;
    }
    if (element.kind === 'section') {
      collectTables(element.children, `${elementPath}-section`, slots);
      return;
    }
    if (element.kind === 'columns') {
      element.columns.forEach((column, columnIndex) => {
        collectTables(column, `${elementPath}-col-${columnIndex}`, slots);
      });
    }
  });
}

function hasTableViewState(view: TableViewState | undefined): boolean {
  if (!view) return false;
  return (
    (typeof view.filter === 'string' && view.filter.trim() !== '') ||
    view.sort !== null ||
    typeof view.selected === 'number' ||
    typeof view.compare === 'number'
  );
}

function toCandidate(
  row: TableRowView,
  element: TableElement,
): ContinueCandidate {
  const cells = element.columns.slice(0, MAX_DRAFT_CELLS).map((column) => {
    const cell = row.views[column.key]!;
    const text =
      cell.text.length > MAX_CELL_TEXT ? `${cell.text.slice(0, MAX_CELL_TEXT)}…` : cell.text;
    return {
      column: column.label,
      text,
      ...(typeof cell.numeric === 'number' ? { numeric: cell.numeric } : {}),
      ...(cell.unit ? { unit: cell.unit } : {}),
      // 缺失/无法计算的单元格必须保留标记，摘要才能说「无法比较」而不是「相同」。
      ...(cell.missing ? { missing: true } : {}),
      ...(cell.error ? { error: cell.error } : {}),
    };
  });
  return { rowKey: row.key, label: rowLabel(row, element.columns), cells };
}

/** 与渲染一致的表格显示条件：false 时整张表不出现，快照也不能把它当成当前结果。 */
function tableVisibility(
  element: TableElement,
  evaluation: CompositeEvaluation,
): { visible: boolean; error?: string } {
  if (!element.visibleIf) return { visible: true };
  const result = lookupCondition(evaluation, element.visibleIf);
  return result.ok
    ? { visible: result.value }
    : { visible: true, error: `表格显示条件无法计算：${result.error}` };
}

function toTableSnapshot(
  slot: TableSlot,
  view: TableViewState | undefined,
  evaluation: CompositeEvaluation,
  visibilityError?: string,
): {
  snapshot: ContinueTableSnapshot;
  selected: ContinueCandidate | null;
  alternative: ContinueCandidate | null;
} {
  const { element } = slot;
  const model = buildTableModel(element, evaluation, view);
  const selectedRow =
    model.selectedKey === null
      ? undefined
      : model.sortedRows.find((row) => row.key === model.selectedKey);
  // 显式指定的对比项优先；只有恰好两行可见且选中其一，才自动把另一行当作对比项。
  const explicitCompareRow =
    model.compareKey === null
      ? undefined
      : model.sortedRows.find((row) => row.key === model.compareKey);
  const alternativeRow =
    explicitCompareRow ??
    (selectedRow && model.sortedRows.length === 2
      ? model.sortedRows.find((row) => row.key !== selectedRow.key)
      : undefined);
  const selected = selectedRow ? toCandidate(selectedRow, element) : null;
  const alternative = alternativeRow ? toCandidate(alternativeRow, element) : null;
  const sortColumn = model.sort
    ? element.columns.find((column) => column.key === model.sort!.key)
    : undefined;
  const errors = [...new Set([...model.conditionErrors, ...model.cellErrors])].slice(
    0,
    MAX_TABLE_ERRORS,
  );
  if (visibilityError) errors.unshift(visibilityError);

  return {
    snapshot: {
      title: element.title?.trim() || `表格 ${slot.ordinal}`,
      selectable: element.selectable === true,
      filter: model.filter,
      sort: model.sort ? { label: sortColumn?.label ?? model.sort.key, dir: model.sort.dir } : null,
      totalRows: model.rows.length,
      visibleRows: model.sortedRows.length,
      selected,
      alternative,
      selectionHidden: model.selectedHidden,
      selectionMissing: model.selectedMissing,
      compareHidden: model.compareHidden,
      compareMissing: model.compareMissing,
      errors,
      ...(element.emptyText ? { emptyText: element.emptyText } : {}),
    },
    selected,
    alternative,
  };
}

export function createContinueSnapshot(options: ContinueSnapshotOptions): ContinueSnapshot {
  const { document: doc, evaluation } = options;
  const stateFields = doc.version === 1 ? [] : doc.state;
  const derivedFields = doc.version === 1 ? [] : doc.derived;

  const tables: ContinueTableSnapshot[] = [];
  let hasSelection = false;
  let hasAlternative = false;

  if (doc.version === 3 && evaluation) {
    const slots: TableSlot[] = [];
    collectTables(doc.elements, 'root', slots);
    const prepared = slots
      .map((slot) => ({ slot, view: options.tables[slot.path] }))
      .filter(({ slot, view }) => slot.element.selectable === true || hasTableViewState(view))
      .flatMap(({ slot, view }) => {
        // 表格被 visibleIf 隐藏时，即便用户之前选过行，也不能把旧选择带进摘要。
        const gate = tableVisibility(slot.element, evaluation);
        if (!gate.visible) return [];
        return [toTableSnapshot(slot, view, evaluation, gate.error)];
      })
      // 选中项优先进入摘要，剩余名额再按文档顺序补齐。
      .sort((left, right) => Number(right.selected !== null) - Number(left.selected !== null));
    for (const item of prepared) {
      if (tables.length >= MAX_TABLES) break;
      tables.push(item.snapshot);
      if (item.selected) hasSelection = true;
      if (item.alternative) hasAlternative = true;
    }
  }

  const drafts = stateFields
    .map((variable) => {
      const raw = options.drafts[variable.id];
      if (typeof raw !== 'string') return null;
      return {
        label: variable.label,
        raw: raw.length > MAX_DRAFT_LENGTH ? `${raw.slice(0, MAX_DRAFT_LENGTH)}…` : raw,
        ...(options.fieldErrors[variable.id] ? { invalid: true } : {}),
      };
    })
    .filter((draft): draft is NonNullable<typeof draft> => draft !== null)
    .slice(0, MAX_DRAFT_CELLS);

  return {
    input: {
      title: doc.title,
      state: stateFields,
      derived: derivedFields,
      stateValues: options.stateValues,
      derivedValues: options.derivedValues,
      derivedErrors: options.derivedErrors,
      tables,
      drafts,
      ...(doc.version === 6
        ? {
            sources: doc.sources ?? [],
            basis: doc.basis ?? {},
            editedState: options.editedState,
            today: options.today,
          }
        : {}),
    },
    hasSelection,
    hasAlternative,
  };
}
