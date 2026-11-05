import { useId, type ReactNode } from 'react';
import type {
  ComposableInteractiveElement,
  DerivedCalculation,
  DerivedValue,
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
  element: Exclude<ComposableInteractiveElement, TextElement> | ModelValueElement;
  state: InteractiveStateValues;
  calculation: DerivedCalculation;
  /** v5 语义模型结果；value 元素可读取模型标量。 */
  models?: Map<string, ModelResult>;
  drafts: Record<string, string>;
  fieldErrors: Record<string, string>;
  onValueChange: (id: string, value: number | string) => void;
  onNumberInput: (id: string, raw: string) => void;
  /** 展示层计算出的强调资格；省略时按普通结果呈现。 */
  emphasized?: boolean;
}

/** 数值与单位分开排版，textContent 仍保留“数值 空格 单位”的完整文本。 */
function NumericValueOutput({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit?: string;
}) {
  const numberText = formatNumber(value);
  const unitText = unit ? ` ${unit}` : '';
  return (
    <output
      className="genui-value-output"
      aria-label={`${label}：${numberText}${unitText}`}
    >
      <span className="genui-value-number">{numberText}</span>
      {unit ? <span className="genui-value-unit">{unitText}</span> : null}
    </output>
  );
}

function TextValueOutput({ label, display }: { label: string; display: string }) {
  return (
    <output className="genui-value-output" aria-label={`${label}：${display}`}>
      {display}
    </output>
  );
}

/** 结果卡片的共同外壳：强调只改展示层级；错误就地显示，绝不伪装成 0。 */
function ValueRow({
  label,
  emphasized,
  error,
  children,
}: {
  label: string;
  emphasized: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={emphasized ? 'genui-value genui-value-primary' : 'genui-value'}
      data-emphasis={emphasized ? 'primary' : undefined}
    >
      <div className="genui-value-head">
        <span className="genui-value-label">{label}</span>
      </div>
      {error ? (
        <span className="genui-runtime-error" role="status">无法计算：{error}</span>
      ) : (
        children
      )}
    </div>
  );
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
  emphasized = false,
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
      <ValueRow label={element.label} emphasized={emphasized} error={error}>
        <NumericValueOutput
          label={element.label}
          value={value ?? Number.NaN}
          unit={unit}
        />
      </ValueRow>
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
      <ValueRow label={element.label} emphasized={emphasized} error={error ?? undefined}>
        <NumericValueOutput
          label={element.label}
          value={value as number}
          unit={element.unit}
        />
      </ValueRow>
    );
  }

  const variable = document.state.find((item) => item.id === source.id);
  const value = getOwn(state, source.id);
  if (!variable || value === undefined) return <UnknownElementView element={{ kind: 'value' }} />;
  const unit = element.unit ?? (variable.kind === 'number' ? variable.unit : undefined);

  return (
    <ValueRow label={element.label} emphasized={emphasized}>
      {variable.kind === 'number' ? (
        <NumericValueOutput label={element.label} value={Number(value)} unit={unit} />
      ) : (
        <TextValueOutput label={element.label} display={stateDisplay(variable, value)} />
      )}
    </ValueRow>
  );
}
