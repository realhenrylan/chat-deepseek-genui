/**
 * 阶段 6：继续讨论摘要（用户主动点击时在卡片本地生成）。
 *
 * 模型输出按不可信输入处理：摘要只汇总已声明的状态变量与派生结果，
 * 不包含 HTML/Markdown 代码围栏之外的内容；数值展示与卡片一致
 * （formatNumber / 选项标签 / 单位），派生失败或缺失时如实标注，不编造数值。
 * 全部读取使用 getOwn（自有属性），防原型同名 ID 注入。
 */

import type { DerivedValue, InteractiveStateValues, StateVariable } from '../protocol/types';
import { getOwn } from '../runtime/records';
import { formatNumber, stateDisplay } from './format';

export interface ContinueSummaryInput {
  title?: string | null;
  state?: StateVariable[];
  derived?: DerivedValue[];
  stateValues?: InteractiveStateValues;
  derivedValues?: Record<string, number>;
  derivedErrors?: Record<string, string>;
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

  lines.push('请基于以上当前条件与结果继续讨论。');
  return lines.join('\n');
}
