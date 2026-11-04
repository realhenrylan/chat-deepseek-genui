/**
 * 阶段 6/v4：继续讨论摘要（用户主动点击时在卡片本地生成）。
 *
 * 模型输出按不可信输入处理：摘要只汇总已声明的状态变量与派生结果，
 * 不包含 HTML/Markdown 代码围栏之外的内容；数值展示与卡片一致
 * （formatNumber / 选项标签 / 单位），派生失败或缺失时如实标注，不编造数值。
 * v4 还会带上 sources、basis、适用时点与「未核验」声明，避免下游把
 * 模型声称的来源当成已核验事实。全部读取使用 getOwn（自有属性）。
 */

import {
  basisProblem,
  describeBasis,
  findBasisSource,
  formatProvenanceDate,
  isBasisExpired,
  todayLocalDate,
} from '../protocol/provenance';
import type {
  DerivedValue,
  GenuiBasis,
  GenuiSource,
  InteractiveStateValues,
  StateVariable,
} from '../protocol/types';
import { getOwn } from '../runtime/records';
import { formatNumber, stateDisplay } from './format';

export type SummaryStateVariable = StateVariable & { basis?: GenuiBasis };
export type SummaryDerivedValue = DerivedValue & { basis?: GenuiBasis };

export interface ContinueSummaryInput {
  title?: string | null;
  state?: SummaryStateVariable[];
  derived?: SummaryDerivedValue[];
  stateValues?: InteractiveStateValues;
  derivedValues?: Record<string, number>;
  derivedErrors?: Record<string, string>;
  /** 仅 v4 传入；用于在摘要中保留来源与时间。 */
  sources?: GenuiSource[];
  /** 用户已修改的状态 id；当前值不能被说成仍来自模型声明的原始依据。 */
  editedState?: readonly string[];
  /** 本地日期 YYYY-MM-DD；缺省取今天。 */
  today?: string;
}

function basisSuffix(
  basis: GenuiBasis,
  sources: GenuiSource[] | undefined,
  today: string,
): string {
  const description = describeBasis(basis, sources);
  const source = findBasisSource(basis, sources);
  const parts: string[] = [description.label];
  if (source !== undefined) {
    parts.push(`《${source.label}》，未核验`);
  }
  if (basis.asOf !== undefined) {
    parts.push(`适用时点 ${formatProvenanceDate(basis.asOf)}`);
  }
  if (basis.validUntil !== undefined) {
    parts.push(
      isBasisExpired(basis, today)
        ? `已过期（有效期至 ${formatProvenanceDate(basis.validUntil)}）`
        : `有效期至 ${formatProvenanceDate(basis.validUntil)}`,
    );
  }
  const problem = basisProblem(basis, sources, today);
  if (problem !== undefined && !parts.some((part) => part.startsWith('已过期'))) {
    parts.push(problem);
  }
  if (basis.note !== undefined) {
    parts.push(basis.note);
  }
  return `（${parts.join('；')}）`;
}

/** 用户修改后的值：当前依据是「用户修改」，原依据只作为历史信息保留。 */
function editedSuffix(
  basis: GenuiBasis | undefined,
  sources: GenuiSource[] | undefined,
  today: string,
): string {
  if (basis === undefined) {
    return '（用户修改；原依据：未标注）';
  }
  const description = describeBasis(basis, sources);
  const source = findBasisSource(basis, sources);
  const parts: string[] = ['用户修改', `原依据：${description.label}`];
  if (source !== undefined) {
    parts.push(`《${source.label}》，未核验`);
  }
  if (basis.asOf !== undefined) {
    parts.push(`原适用时点 ${formatProvenanceDate(basis.asOf)}`);
  }
  if (basis.validUntil !== undefined) {
    parts.push(
      isBasisExpired(basis, today)
        ? `原有效期至 ${formatProvenanceDate(basis.validUntil)}（已过期）`
        : `原有效期至 ${formatProvenanceDate(basis.validUntil)}`,
    );
  }
  if (basis.note !== undefined) {
    parts.push(`原说明：${basis.note}`);
  }
  return `（${parts.join('；')}）`;
}

export function buildContinueSummary(input: ContinueSummaryInput): string {
  const title =
    typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : null;
  const stateVariables = input.state ?? [];
  const derivedValues = input.derived ?? [];
  const hasProvenance =
    input.sources !== undefined ||
    stateVariables.some((variable) => variable.basis !== undefined) ||
    derivedValues.some((item) => item.basis !== undefined);
  const today = input.today ?? todayLocalDate();
  const editedIds = new Set(input.editedState ?? []);
  const lines: string[] = [title ? `继续讨论「${title}」：` : '继续讨论当前界面：'];

  for (const variable of stateVariables) {
    const value = getOwn(input.stateValues ?? {}, variable.id);
    if (value === undefined) {
      lines.push(`- ${variable.label}：（未确认）`);
      continue;
    }
    const suffix = editedIds.has(variable.id)
      ? editedSuffix(variable.basis, input.sources, today)
      : variable.basis !== undefined
        ? basisSuffix(variable.basis, input.sources, today)
        : hasProvenance
          ? '（未标注依据）'
          : '';
    lines.push(`- ${variable.label}：${stateDisplay(variable, value)}${suffix}`);
  }

  for (const item of derivedValues) {
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
    const suffix =
      item.basis !== undefined
        ? basisSuffix(item.basis, input.sources, today)
        : hasProvenance
          ? '（计算结果）'
          : '';
    lines.push(
      `- ${item.label}：${formatNumber(raw)}${item.unit ? ` ${item.unit}` : ''}${suffix}`,
    );
  }

  if (input.sources !== undefined && input.sources.length > 0) {
    lines.push('声明的来源（模型声称，插件未核验）：');
    for (const source of input.sources) {
      const parts = [`《${source.label}》`];
      if (source.publisher !== undefined) parts.push(source.publisher);
      if (source.url !== undefined) parts.push(source.url);
      parts.push(
        source.publishedAt === undefined
          ? '资料时间未说明'
          : `资料时间 ${formatProvenanceDate(source.publishedAt)}`,
      );
      if (source.retrievedAt !== undefined) {
        parts.push(`声称获取于 ${formatProvenanceDate(source.retrievedAt)}`);
      }
      if (source.note !== undefined) parts.push(source.note);
      lines.push(`- ${parts.join(' · ')}`);
    }
  }

  if (hasProvenance || editedIds.size > 0) {
    const editedNote =
      editedIds.size > 0 ? '；用户修改的输入以当前值为准，原依据仅作历史说明' : '';
    lines.push(
      `依据时点：${today}（来源与假设由模型声明，插件未访问网络；缺失值不是 0${editedNote}）。`,
    );
  }

  lines.push('请基于以上当前条件与结果继续讨论。');
  return lines.join('\n');
}
