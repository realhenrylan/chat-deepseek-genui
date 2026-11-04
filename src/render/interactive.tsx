import { useId } from 'react';
import type {
  DerivedCalculation,
  DerivedValue,
  InteractiveElement,
  InteractiveStateValues,
  ModelValueElement,
  StateVariable,
  TextElement,
} from '../protocol/types';
import type { ModelResult } from '../runtime/evaluate';
import { getOwn } from '../runtime/records';
import { UnknownElementView } from './elements';
import { formatNumber, stateDisplay } from './format';

/**
 * v2/v3/v4/v5 共用的交互叶元素视图：数值输入、滑块、下拉选择与结果展示。
 * 文档参数只要求 state/derived 列表，因此各版本文档都可传入。
 */
export interface InteractiveElementProps {
  document: { state: StateVariable[]; derived: DerivedValue[] };
  element: Exclude<InteractiveElement, TextElement> | ModelValueElement;
  state: InteractiveStateValues;
  calculation: DerivedCalculation;
  /** v5 语义模型结果；value 元素可读取模型标量。 */
  models?: Map<string, ModelResult>;
  drafts: Record<string, string>;
  fieldErrors: Record<string, string>;
  onValueChange: (id: string, value: number | string) => void;
  onNumberInput: (id: string, raw: string) => void;
}

export function InteractiveElementView({
  document,
  element,
  state,
  calculation,
  models,
  drafts,
  fieldErrors,
  onValueChange,
  onNumberInput,
}: InteractiveElementProps) {
  const controlId = useId();

  if (element.kind === 'number-input' || element.kind === 'slider' || element.kind === 'select') {
    const variable = document.state.find((item) => item.id === element.bind);
    if (!variable) return <UnknownElementView element={{ kind: element.kind }} />;
    const error = getOwn(fieldErrors, variable.id);
    const errorId = `${controlId}-error`;

    if (element.kind === 'select' && variable.kind === 'select') {
      return (
        <div className="genui-control">
          <div className="genui-control-head">
            <label className="genui-control-label" htmlFor={controlId}>{variable.label}</label>
          </div>
          <select
            id={controlId}
            className="genui-select"
            value={String(getOwn(state, variable.id) ?? '')}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? 'true' : undefined}
            onChange={(event) => onValueChange(variable.id, event.currentTarget.value)}
          >
            {variable.options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {error ? <p className="genui-input-error" id={errorId} role="status">{error}</p> : null}
        </div>
      );
    }

    if (variable.kind !== 'number') return <UnknownElementView element={{ kind: element.kind }} />;
    const current = Number(getOwn(state, variable.id) ?? Number.NaN);
    const currentLabel = `${formatNumber(current)}${variable.unit ? ` ${variable.unit}` : ''}`;

    if (element.kind === 'slider') {
      return (
        <div className="genui-control">
          <div className="genui-control-head">
            <label className="genui-control-label" htmlFor={controlId}>{variable.label}</label>
          </div>
          <div className="genui-slider-row">
            <input
              id={controlId}
              className="genui-slider"
              type="range"
              min={variable.min}
              max={variable.max}
              step={variable.step}
              value={current}
              aria-label={variable.label}
              aria-valuetext={currentLabel}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? 'true' : undefined}
              onChange={(event) => onValueChange(variable.id, Number(event.currentTarget.value))}
            />
            <output className="genui-control-current" htmlFor={controlId}>{currentLabel}</output>
          </div>
          {error ? <p className="genui-input-error" id={errorId} role="status">{error}</p> : null}
        </div>
      );
    }

    const inputValue = getOwn(drafts, variable.id) ?? String(current);
    return (
      <div className="genui-control">
        <div className="genui-control-head">
          <label className="genui-control-label" htmlFor={controlId}>
            {variable.label}{variable.unit ? <span className="genui-control-unit">（{variable.unit}）</span> : null}
          </label>
        </div>
        <input
          id={controlId}
          className="genui-number-input"
          type="number"
          inputMode="decimal"
          min={variable.min}
          max={variable.max}
          step={variable.step}
          value={inputValue}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? 'true' : undefined}
          onChange={(event) => onNumberInput(variable.id, event.currentTarget.value)}
        />
        {error ? <p className="genui-input-error" id={errorId} role="status">{error}</p> : null}
      </div>
    );
  }

  const source = element.source;
  if (source.kind === 'derived') {
    const error = getOwn(calculation.errors, source.id);
    const value = getOwn(calculation.values, source.id);
    const definition = document.derived.find((item) => item.id === source.id);
    const unit = element.unit ?? definition?.unit;
    return (
      <div className="genui-value">
        <div className="genui-value-head">
          <span className="genui-value-label">{element.label}</span>
        </div>
        {error ? (
          <span className="genui-runtime-error" role="status">无法计算：{error}</span>
        ) : (
          <output className="genui-value-output" aria-label={element.label}>
            {formatNumber(value ?? Number.NaN)}{unit ? ` ${unit}` : ''}
          </output>
        )}
      </div>
    );
  }

  if (source.kind === 'model') {
    const model = models?.get(source.model);
    const value = model?.ok ? model.scalars[source.key] : null;
    const error = !model
      ? '模型未求值'
      : !model.ok
        ? (model.error ?? '模型计算失败')
        : value === null || value === undefined
          ? '该模型值在当前数据下不可用'
          : null;
    return (
      <div className="genui-value">
        <div className="genui-value-head">
          <span className="genui-value-label">{element.label}</span>
        </div>
        {error ? (
          <span className="genui-runtime-error" role="status">无法计算：{error}</span>
        ) : (
          <output className="genui-value-output" aria-label={element.label}>
            {formatNumber(value as number)}{element.unit ? ` ${element.unit}` : ''}
          </output>
        )}
      </div>
    );
  }

  const variable = document.state.find((item) => item.id === source.id);
  const value = getOwn(state, source.id);
  if (!variable || value === undefined) return <UnknownElementView element={{ kind: 'value' }} />;
  const unit = element.unit ?? (variable.kind === 'number' ? variable.unit : undefined);
  const display = variable.kind === 'number'
    ? `${formatNumber(Number(value))}${unit ? ` ${unit}` : ''}`
    : stateDisplay(variable, value);

  return (
    <div className="genui-value">
      <div className="genui-value-head">
        <span className="genui-value-label">{element.label}</span>
      </div>
      <output className="genui-value-output" aria-label={element.label}>{display}</output>
    </div>
  );
}
