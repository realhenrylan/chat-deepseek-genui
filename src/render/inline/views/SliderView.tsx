import { useEffect, useState } from 'react';
import type { SliderWidget } from '../../../protocol/widget/types';
import { MathText } from '../../math';
import type { InlineStateBus } from '../store';

function resolveSliderHint(widget: SliderWidget, val: number): string {
  if (widget.hints && widget.hints.length > 0) {
    const matched = widget.hints.find(
      (item) =>
        (item.min === undefined || val >= item.min) &&
        (item.max === undefined || val <= item.max),
    );
    if (matched) return matched.text;
  }
  return widget.hint ?? '拖动滑块仅在本地计算，不会重新向模型发起请求。';
}

export function SliderView({
  widget,
  bus,
}: {
  widget: SliderWidget;
  bus?: InlineStateBus;
}) {
  const initialVal = widget.value ?? widget.min;
  const [val, setVal] = useState<number>(() => initialVal);

  useEffect(() => {
    if (widget.id && bus) {
      bus.set(widget.id, val);
    }
  }, [bus, val, widget.id]);

  const handleChange = (next: number) => {
    setVal(next);
    if (widget.id && bus) {
      bus.set(widget.id, next);
    }
  };

  const handleReset = () => {
    handleChange(initialVal);
  };

  const showLocalBadge = widget.localBadge !== false;
  const hintText = resolveSliderHint(widget, val);
  const isDirty = val !== initialVal;

  return (
    <div className="inline-slider-body">
      <div className="inline-slider-top">
        <div className="inline-slider-title-group">
          <span className="inline-slider-label">
            <MathText text={widget.label || '调节参数'} />
          </span>
          {showLocalBadge && (
            <span
              className="inline-local-badge"
              title="拖动滑块仅在浏览器本地计算，不会重新向模型发起请求"
            >
              本地计算
            </span>
          )}
        </div>
        <div>
          <span className="inline-slider-val">{val}</span>
          {widget.unit && <span className="inline-slider-unit">{widget.unit}</span>}
        </div>
      </div>

      <input
        type="range"
        className="inline-slider-input"
        min={widget.min}
        max={widget.max}
        step={widget.step ?? 1}
        value={val}
        onChange={(e) => handleChange(Number(e.target.value))}
      />

      <div className="inline-slider-range-labels">
        <span>{widget.minLabel ?? widget.min}</span>
        <span>{widget.maxLabel ?? widget.max}</span>
      </div>

      <div className="inline-slider-footer">
        <span className="inline-slider-hint">
          <MathText text={hintText} />
        </span>
        <button
          type="button"
          className="inline-slider-reset"
          disabled={!isDirty}
          onClick={handleReset}
        >
          重置参数
        </button>
      </div>
    </div>
  );
}
