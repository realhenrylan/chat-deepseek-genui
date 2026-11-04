/**
 * 表格数据 → CSV 导出（issue #6）。
 *
 * 安全要点（模型输出按不可信输入处理）：
 * - 单元格内容一律按不可信文本转义：分隔符、引号、换行用 RFC 4180 双引号
 *   包裹并把内部引号翻倍；
 * - 以 = + - @ 或制表符/回车开头且不是纯数字的单元格加 `'` 前缀，防止
 *   表格软件把导出内容当公式执行（公式注入）；
 * - 纯数字（含符号、小数、指数）保持原样，保证导出后仍可参与计算。
 *
 * 导出口径与 table.tsx 屏幕呈现同源（visibleIf 行过滤、表达式求值、
 * Object.hasOwn 取单元格），但只导出数据本身：单元格不带单位后缀
 * （单位并入表头），空值/求值失败输出空单元格，行按文档顺序输出全部
 * 可见行（不套用筛选/排序视图，导出的是完整数据）。
 */
import type {
  GenuiDocument,
  GenuiV3Element,
  GenuiV4Element,
  GenuiV5Element,
  TableCell,
  TableColumn,
  TableElement,
} from '../protocol/types';

/** v3/v4/v5 组合元素（表格、章节与分栏布局同构）。 */
type AnyElement = GenuiV3Element | GenuiV4Element | GenuiV5Element;
import { evaluateComposite, lookupCondition, lookupExpression, lookupModel, modelTable } from './evaluate';
import type { CompositeEvaluation } from './evaluate';

/** UTF-8 BOM：让 Excel 等软件正确识别中文 CSV。 */
export const CSV_BOM = '\uFEFF';
/** RFC 4180 行分隔符。 */
export const CSV_EOL = '\r\n';

/** 公式注入防护的危险首字符（OWASP 口径）。 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
/** 纯数字不构成公式威胁，保持原样以便继续参与计算。 */
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** 需要 RFC 4180 引号包裹的字符。 */
const NEEDS_QUOTE = /["\r\n,]/;

/**
 * 转义一个 CSV 单元格：先做公式前缀防护，再按 RFC 4180 包裹。
 * 导入的字符串与模型输出的字符串都必须经过这里。
 */
export function escapeCsvCell(raw: string): string {
  const lead = raw.trimStart();
  let value = raw;
  if (FORMULA_LEAD.test(lead) && !PLAIN_NUMBER.test(lead)) {
    value = `'${value}`;
  }
  if (NEEDS_QUOTE.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 拼接二维数组为 CSV 文本（不含 BOM；行内逗号、行间 CRLF）。 */
export function buildCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join(CSV_EOL);
}

function isExpression(cell: TableCell): cell is Exclude<TableCell, string | number | null> {
  return typeof cell === 'object' && cell !== null;
}

/** 单元格 → CSV 值：数值保持原始数值文本，字符串原样（转义交给 buildCsv）。 */
function cellToCsvValue(
  cell: TableCell | undefined,
  evaluation: CompositeEvaluation,
): string {
  if (cell === null || cell === undefined) return '';
  if (isExpression(cell)) {
    const result = lookupExpression(evaluation, cell);
    return result.ok ? String(result.value) : '';
  }
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? String(cell) : '';
  }
  return cell;
}

/** 表头：列名并入单位（单元格内不再重复单位，导出后仍可参与计算）。 */
function headerText(column: TableColumn): string {
  return column.unit ? `${column.label}（${column.unit}）` : column.label;
}

/** 元素级 visibleIf：求值失败保持可见（与 composite.tsx 口径一致）。 */
function isElementVisible(
  element: AnyElement,
  evaluation: CompositeEvaluation,
): boolean {
  if (!('visibleIf' in element) || !element.visibleIf) return true;
  const result = lookupCondition(evaluation, element.visibleIf);
  return result.ok ? result.value : true;
}

/**
 * v5 模型表格归一成经典列/行（与 table.tsx 的 resolveTableElement 同口径）。
 * 模型未求值/视图不可用时返回 null：CSV 不导出无数据的空壳表。
 */
function resolveTable(element: AnyElement, evaluation: CompositeEvaluation): TableElement | null {
  if (element.kind !== 'table') return null;
  if (!('source' in element)) return element;
  const model = lookupModel(evaluation, element.source.model);
  if (!model || !model.ok) return null;
  const view = modelTable(model, element.source.view);
  if (!view) return null;
  return {
    kind: 'table',
    title: element.title,
    columns: view.columns,
    rows: view.rows.map((cells) => ({ cells })),
    sortable: element.sortable,
    initialSort: element.initialSort,
    emptyText: view.emptyText ?? element.emptyText,
    visibleIf: element.visibleIf,
  };
}

/** 按文档顺序收集全部可见表格（section/columns 递归，隐藏子树整棵跳过）。 */
function collectTables(
  elements: AnyElement[],
  evaluation: CompositeEvaluation,
): TableElement[] {
  const tables: TableElement[] = [];
  for (const element of elements) {
    if (!isElementVisible(element, evaluation)) continue;
    if (element.kind === 'table') {
      const table = resolveTable(element, evaluation);
      if (table) tables.push(table);
    } else if (element.kind === 'section') {
      tables.push(...collectTables(element.children, evaluation));
    } else if (element.kind === 'columns') {
      for (const column of element.columns) {
        tables.push(...collectTables(column, evaluation));
      }
    }
  }
  return tables;
}

/**
 * 生成方案的表格 CSV：单文件分节导出全部可见表格（节间空行，多表时
 * 每节先写标题行）。没有表格（v1/v2 文档或无 table 元素）返回 null，
 * 由调用方给出反馈。
 */
export function buildTablesCsv(
  document: GenuiDocument,
  values: Record<string, number | string>,
): string | null {
  if (document.version === 1 || document.version === 2) return null;
  const evaluation = evaluateComposite(document, values);
  const tables = collectTables(document.elements, evaluation);
  if (tables.length === 0) return null;

  const rows: string[][] = [];
  tables.forEach((table, index) => {
    if (index > 0) rows.push([]);
    if (table.title || tables.length > 1) {
      rows.push([table.title ?? `表格 ${index + 1}`]);
    }
    rows.push(table.columns.map(headerText));
    for (const row of table.rows) {
      if (row.visibleIf) {
        const condition = lookupCondition(evaluation, row.visibleIf);
        // 求值失败保留该行（与 table.tsx 一致：错误上报但不隐藏数据）。
        if (condition.ok && !condition.value) continue;
      }
      rows.push(
        table.columns.map((column) =>
          cellToCsvValue(
            Object.hasOwn(row.cells, column.key) ? row.cells[column.key] : null,
            evaluation,
          ),
        ),
      );
    }
  });

  return CSV_BOM + buildCsv(rows);
}
