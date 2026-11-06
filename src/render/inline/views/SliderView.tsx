import { useEffect, useState } from 'react';
import type { SliderWidget } from '../../../protocol/widget/types';
import type { InlineStateBus } from '../store';

export function SliderView({
  widget,
  bus,
}: {
  widget: SliderWidget;
  bus?: InlineStateBus;
}) {
  const [val, setVal] = useState<number>(() => widget.value ?? widget.min);

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

  return (
    <div className="inline-slider-body">
      <div className="inline-slider-top">
        <span className="inline-slider-label">{widget.label || '调节参数'}</span>
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
        <span>{widget.min}</span>
        <span>{widget.max}</span>
      </div>
    </div>
  );
}
