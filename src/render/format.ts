import type { StateVariable } from '../protocol/types';

/** 数值展示：保留 12 位有效数字，避免浮点尾差；负零归零。 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Number(value.toPrecision(12));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** 状态值展示：选择状态显示选项标签，数值状态附带单位。 */
export function stateDisplay(variable: StateVariable, value: number | string): string {
  if (variable.kind === 'select') {
    return variable.options.find((option) => option.value === value)?.label ?? String(value);
  }
  return `${formatNumber(Number(value))}${variable.unit ? ` ${variable.unit}` : ''}`;
}
