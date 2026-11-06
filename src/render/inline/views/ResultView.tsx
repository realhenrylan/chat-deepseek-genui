import { useEffect, useState } from 'react';
import type { ResultWidget } from '../../../protocol/widget/types';
import type { InlineStateBus } from '../store';

export function ResultView({
  widget,
  bus,
}: {
  widget: ResultWidget;
  bus?: InlineStateBus;
}) {
  const isPrimary = widget.emphasis === 'primary';
  const [val, setVal] = useState<number | string>(() => {
    if (widget.bind && bus) {
      const fromBus = bus.get(widget.bind);
      if (fromBus !== undefined) return fromBus;
    }
    return widget.value;
  });

  useEffect(() => {
    if (!widget.bind || !bus) return;
    const unsubscribe = bus.subscribe(widget.bind, (latest) => {
      setVal(latest);
    });
    return unsubscribe;
  }, [bus, widget.bind]);

  return (
    <div className="inline-result-body">
      {widget.label && <div className="inline-widget-subtitle">{widget.label}</div>}
      <div className="inline-result-content">
        <span className={`inline-result-val ${isPrimary ? 'primary' : ''}`}>
          {val}
        </span>
        {widget.unit && <span className="inline-result-unit">{widget.unit}</span>}
      </div>
    </div>
  );
}
