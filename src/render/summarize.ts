/**
 * 阶段 6：继续讨论摘要（用户主动点击时在卡片本地生成）。
 *
 * 模型输出按不可信输入处理：摘要只汇总已声明的状态变量与派生结果，
 * 不包含 HTML/Markdown 代码围栏之外的内容；数值展示与卡片一致
 * （formatNumber / 选项标签 / 单位），派生失败或缺失时如实标注，不编造数值。
 * 全部读取使用 getOwn（自有属性），防原型同名 ID 注入。
 *
 * issue #5 起摘要还会带上：未提交的数字草稿、表格的筛选/排序/选中项，
 * 以及（可选）当前结果的两个候选方案及其差异。数据由 continue-snapshot
 * 在点击瞬间冻结，避免预览编辑期间与界面状态脱节。
 */

import type { DerivedValue, InteractiveStateValues, StateVariable } from '../protocol/types';
import { getOwn } from '../runtime/records';
import { formatNumber, stateDisplay } from './format';

export type ContinueIntent = 'explain' | 'selected' | 'compare';

export interface ContinueIntentOption {
  id: ContinueIntent;
  label: string;
  request: string;
}

/** 预览面板里的讨论入口；request 会替代默认结尾句，明确告诉模型要做什么。 */
export const CONTINUE_INTENTS: ContinueIntentOption[] = [
  {
    id: 'explain',
    label: '解释当前结果',
    request: '请解释以上当前结果的含义、主要影响因素和需要注意的限制。',
  },
  {
    id: 'selected',
    label: '讨论选中方案',
    request: '请讨论已选候选项的取舍，并说明它相对对比项的优缺点。',
  },
  {
    id: 'compare',
    label: '比较两个方案',
    request: '请比较以上两个候选方案的差异与取舍。',
  },
];

export function getContinueIntent(id: ContinueIntent): ContinueIntentOption {
  return CONTINUE_INTENTS.find((item) => item.id === id) ?? CONTINUE_INTENTS[0]!;
}

export interface ContinueCandidateCell {
  column: string;
  text: string;
  numeric?: number;
  unit?: string;
  /** 单元格缺失；存在时不能把该字段当成「相同」。 */
  missing?: boolean;
  /** 单元格无法计算；存在时不能把该字段当成「相同」。 */
  error?: string;
}

export interface ContinueCandidate {
  /** 文档中的原始行序号（0 基）。 */
  rowKey: number;
  label: string;
  cells: ContinueCandidateCell[];
}

export interface ContinueTableSnapshot {
  title: string;
  selectable: boolean;
  filter: string;
  sort: { label: string; dir: 'asc' | 'desc' } | null;
  totalRows: number;
  visibleRows: number;
  selected: ContinueCandidate | null;
  alternative: ContinueCandidate | null;
  selectionHidden: boolean;
  selectionMissing: boolean;
  /** 显式对比项被筛选隐藏/已不存在；用于如实说明，而不是悄悄换一个对比对象。 */
  compareHidden: boolean;
  compareMissing: boolean;
  errors: string[];
  emptyText?: string;
}

export interface ContinueDraft {
  label: string;
  raw: string;
  /** 输入框里有校验错误：草稿未提交且格式无效。 */
  invalid?: boolean;
}

export interface ContinueSummaryInput {
  title?: string | null;
  state?: StateVariable[];
  derived?: DerivedValue[];
  stateValues?: InteractiveStateValues;
  derivedValues?: Record<string, number>;
  derivedErrors?: Record<string, string>;
  /** 最多使用前 4 张表格；更多表格会被省略。 */
  tables?: ContinueTableSnapshot[];
  /** 最多使用前 6 个未提交草稿。 */
  drafts?: ContinueDraft[];
  /** 讨论意图对应的请求句；缺省时使用通用结尾。 */
  request?: string;
}

/** 摘要总长上限；超出时截断并明确标注，避免把整张卡片倒进输入框。 */
export const MAX_CONTINUE_SUMMARY_LENGTH = 1200;
const MAX_TABLES = 4;
const MAX_CELLS = 6;
const MAX_DIFFS = 3;
/** 单行上限：超长单元格不能挤掉选中项与请求句。 */
const MAX_TABLE_LINE = 240;
/** 请求句上限：即使调用方传入超长文本，也不能把摘要顶出上限。 */
const MAX_REQUEST_LENGTH = 300;
const OMITTED_NOTE = '……（部分参数与结果已省略）';

function formatCandidate(candidate: ContinueCandidate, selectedLabel: string): string {
  const cells = candidate.cells
    // 与标签完全相同的单元格（通常是名称列）不再重复一次。
    .filter((cell) => cell.text !== '' && cell.text !== '—' && cell.text !== selectedLabel)
    .slice(0, MAX_CELLS)
    .map((cell) => `${cell.column} ${cell.text}`);
  return `${candidate.label}${cells.length > 0 ? ` — ${cells.join('；')}` : ''}`;
}

function describeDifferences(selected: ContinueCandidate, alternative: ContinueCandidate): string {
  const diffs: string[] = [];
  const missing: string[] = [];
  let compared = 0;
  const count = Math.min(selected.cells.length, alternative.cells.length);
  for (let index = 0; index < count && diffs.length < MAX_DIFFS; index += 1) {
    const left = selected.cells[index]!;
    const right = alternative.cells[index]!;
    // 名称列就是候选标签本身，不应算作「主要差异」。
    if (left.text === selected.label && right.text === alternative.label) continue;
    // 缺失或无法计算的字段无从比较：不能当成「相同」，也不能伪造差异。
    if (left.missing || right.missing || left.error || right.error) {
      missing.push(left.column);
      continue;
    }
    compared += 1;
    if (typeof left.numeric === 'number' && typeof right.numeric === 'number') {
      const delta = Math.abs(left.numeric - right.numeric);
      if (delta > 0) {
        const unit = left.unit && left.unit === right.unit ? ` ${left.unit}` : '';
        diffs.push(`${left.column}相差 ${formatNumber(delta)}${unit}`);
      }
      continue;
    }
    if (left.text !== right.text) {
      diffs.push(`${left.column}不同（${left.text} / ${right.text}）`);
    }
  }
  if (diffs.length > 0) {
    const suffix =
      missing.length > 0 ? `；${missing.join('、')} 缺失或无法计算，未参与比较` : '';
    return `主要差异：${diffs.join('；')}${suffix}。`;
  }
  if (missing.length > 0) {
    return `主要差异：资料不足，无法可靠比较（${missing.join('、')} 缺失或无法计算）。`;
  }
  if (compared === 0) return '主要差异：没有可比较的字段。';
  return '主要差异：两项的数值与主要字段相同。';
}

function describeTable(table: ContinueTableSnapshot): string[] {
  const parts: string[] = [];
  const filter = table.filter.trim();
  if (filter !== '') parts.push(`筛选「${filter}」`);
  if (table.sort) {
    parts.push(`按“${table.sort.label}”${table.sort.dir === 'asc' ? '升序' : '降序'}`);
  }
  parts.push(`显示 ${table.visibleRows} / ${table.totalRows} 行`);
  const lines = [`表格「${table.title}」：${parts.join('；')}。`];

  if (table.selected) {
    lines.push(`- 已选：${formatCandidate(table.selected, table.selected.label)}`);
  }
  if (table.alternative) {
    lines.push(`- 对比：${formatCandidate(table.alternative, table.alternative.label)}`);
  }
  if (table.selected && table.alternative) {
    lines.push(describeDifferences(table.selected, table.alternative));
  }
  if (table.selectable && table.selected) {
    if (table.compareMissing) lines.push('- 指定的对比候选项已不存在。');
    else if (table.compareHidden) lines.push('- 指定的对比候选项被当前筛选隐藏。');
  }

  if (table.selectable) {
    if (table.selectionMissing) lines.push('- 已选候选项已不存在。');
    else if (table.selectionHidden) lines.push('- 已选候选项被当前筛选隐藏。');
    else if (!table.selected) {
      if (table.visibleRows === 0) {
        lines.push(table.totalRows === 0 ? '- 没有候选项。' : '- 没有符合筛选条件的候选项。');
      } else {
        lines.push(`- 未选择候选项（${table.visibleRows} 个可选）`);
      }
    }
  }

  if (table.errors.length > 0) {
    const shown = table.errors.slice(0, 2).join('；');
    const rest = table.errors.length > 2 ? `；等 ${table.errors.length} 项` : '';
    lines.push(`- 无法计算：${shown}${rest}。`);
  }
  return lines;
}

function clipLine(line: string): string {
  return line.length > MAX_TABLE_LINE ? `${line.slice(0, MAX_TABLE_LINE - 1)}…` : line;
}

/** 按预算填充参数/结果行；放不下时追加省略标记，绝不把表格与请求挤出去。 */
function fitHead(lines: string[], budget: number): string[] {
  const fullCost = lines.reduce((sum, line) => sum + line.length, Math.max(0, lines.length - 1));
  const truncated = fullCost > budget;
  // 预留省略提示的位置，避免「刚好差一点」时既不提示、又悄悄丢掉后面的参数。
  const limit = truncated ? Math.max(0, budget - (OMITTED_NOTE.length + 1)) : budget;
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = line.length + (kept.length > 0 ? 1 : 0);
    if (used + cost > limit) break;
    kept.push(line);
    used += cost;
  }
  if (truncated && kept.length > 0) kept.push(OMITTED_NOTE);
  return kept;
}

export function buildContinueSummary(input: ContinueSummaryInput): string {
  const title =
    typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : null;
  const headLines: string[] = [title ? `继续讨论「${title}」：` : '继续讨论当前界面：'];

  for (const variable of input.state ?? []) {
    const value = getOwn(input.stateValues ?? {}, variable.id);
    if (value === undefined) {
      headLines.push(`- ${variable.label}：（未确认）`);
      continue;
    }
    headLines.push(`- ${variable.label}：${stateDisplay(variable, value)}`);
  }

  for (const item of input.derived ?? []) {
    const error = getOwn(input.derivedErrors ?? {}, item.id);
    if (typeof error === 'string' && error !== '') {
      headLines.push(`- ${item.label}：无法计算（${error}）`);
      continue;
    }
    const raw = getOwn(input.derivedValues ?? {}, item.id);
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      headLines.push(`- ${item.label}：无法计算（暂无结果）`);
      continue;
    }
    headLines.push(`- ${item.label}：${formatNumber(raw)}${item.unit ? ` ${item.unit}` : ''}`);
  }

  for (const draft of (input.drafts ?? []).slice(0, 6)) {
    const invalid = draft.invalid ? '格式无效，' : '';
    headLines.push(`- ${draft.label}：输入框中未提交「${draft.raw}」，${invalid}尚未生效。`);
  }

  const tableBlocks = (input.tables ?? [])
    .slice(0, MAX_TABLES)
    .map((table) => describeTable(table).map((line) => clipLine(line)));

  const rawRequest = typeof input.request === 'string' ? input.request.trim() : '';
  const request =
    rawRequest.length > MAX_REQUEST_LENGTH
      ? `${rawRequest.slice(0, MAX_REQUEST_LENGTH - 1)}…`
      : rawRequest;
  const requestLine = request !== '' ? request : '请基于以上当前条件与结果继续讨论。';

  const full = [...headLines, ...tableBlocks.flat(), requestLine].join('\n');
  if (full.length <= MAX_CONTINUE_SUMMARY_LENGTH) return full;

  // 超长时先保表格与结尾请求，再用剩余预算放参数/结果。
  // 这样长参数列表不会把「已选 C」「筛选 A/C」和「请比较两个方案」截掉。
  const requestCost = requestLine.length + 1;
  const tableBudget = MAX_CONTINUE_SUMMARY_LENGTH - requestCost;
  const keptTables: string[] = [];
  let tableUsed = 0;
  for (const block of tableBlocks) {
    const cost = block.join('\n').length + 1;
    if (tableUsed + cost <= tableBudget) {
      keptTables.push(...block);
      tableUsed += cost;
      continue;
    }
    // 空间不足时至少保留表头（含筛选与计数）和已选项。
    const compact = block.filter((line, index) => index === 0 || line.startsWith('- 已选：'));
    const compactCost = compact.join('\n').length + 1;
    if (compact.length > 0 && tableUsed + compactCost <= tableBudget) {
      keptTables.push(...compact);
      tableUsed += compactCost;
      continue;
    }
    if (keptTables.length === 0 && compact.length > 0) {
      // 第一张表也放不下：截短每行，仍然让选中项与筛选条件留在摘要里。
      const remaining = Math.max(0, tableBudget - tableUsed);
      const share = Math.max(24, Math.floor(remaining / compact.length) - 1);
      const clipped = compact.map((line) =>
        line.length > share ? `${line.slice(0, Math.max(8, share - 1))}…` : line,
      );
      keptTables.push(...clipped);
      tableUsed += clipped.join('\n').length + 1;
    }
    break;
  }

  const headBudget = MAX_CONTINUE_SUMMARY_LENGTH - requestCost - tableUsed - 1;
  const keptHead = fitHead(headLines, headBudget);
  let summary = [...keptHead, ...keptTables, requestLine].join('\n');
  if (summary.length > MAX_CONTINUE_SUMMARY_LENGTH) {
    // 兜底：仍要保留结尾请求，只裁剪正文。
    const bodyBudget = MAX_CONTINUE_SUMMARY_LENGTH - requestCost;
    const body = [...keptHead, ...keptTables].join('\n').slice(0, Math.max(0, bodyBudget)).trimEnd();
    summary = body !== '' ? `${body}\n${requestLine}` : requestLine;
  }
  return summary;
}
