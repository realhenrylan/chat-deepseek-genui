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
const TRUNCATION_NOTE = '\n……（摘要过长，已省略部分内容）';

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
  const count = Math.min(selected.cells.length, alternative.cells.length);
  for (let index = 0; index < count && diffs.length < MAX_DIFFS; index += 1) {
    const left = selected.cells[index]!;
    const right = alternative.cells[index]!;
    // 名称列就是候选标签本身，不应算作「主要差异」。
    if (left.text === selected.label && right.text === alternative.label) continue;
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
  if (diffs.length === 0) return '主要差异：两项的数值与主要字段相同。';
  return `主要差异：${diffs.join('；')}。`;
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

export function buildContinueSummary(input: ContinueSummaryInput): string {
  const title =
    typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : null;
  const lines: string[] = [title ? `继续讨论「${title}」：` : '继续讨论当前界面：'];

  for (const variable of input.state ?? []) {
    const value = getOwn(input.stateValues ?? {}, variable.id);
    if (value === undefined) {
      lines.push(`- ${variable.label}：（未确认）`);
      continue;
    }
    lines.push(`- ${variable.label}：${stateDisplay(variable, value)}`);
  }

  for (const item of input.derived ?? []) {
    const error = getOwn(input.derivedErrors ?? {}, item.id);
    if (typeof error === 'string' && error !== '') {
      lines.push(`- ${item.label}：无法计算（${error}）`);
      continue;
    }
    const raw = getOwn(input.derivedValues ?? {}, item.id);
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      lines.push(`- ${item.label}：无法计算（暂无结果）`);
      continue;
    }
    lines.push(`- ${item.label}：${formatNumber(raw)}${item.unit ? ` ${item.unit}` : ''}`);
  }

  for (const draft of (input.drafts ?? []).slice(0, 6)) {
    const invalid = draft.invalid ? '格式无效，' : '';
    lines.push(`- ${draft.label}：输入框中未提交「${draft.raw}」，${invalid}尚未生效。`);
  }

  for (const table of (input.tables ?? []).slice(0, MAX_TABLES)) {
    lines.push(...describeTable(table));
  }

  const request = typeof input.request === 'string' ? input.request.trim() : '';
  lines.push(request !== '' ? request : '请基于以上当前条件与结果继续讨论。');

  const summary = lines.join('\n');
  if (summary.length <= MAX_CONTINUE_SUMMARY_LENGTH) return summary;
  const budget = MAX_CONTINUE_SUMMARY_LENGTH - TRUNCATION_NOTE.length;
  return `${summary.slice(0, Math.max(0, budget)).trimEnd()}${TRUNCATION_NOTE}`;
}
