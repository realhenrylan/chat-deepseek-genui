import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { ResultWidget } from '../../../protocol/widget/types';
import { extractFormulaVars, interpolateFormula, MathFormula, MathText } from '../../math';
import type { InlineStateBus } from '../store';

export function ResultView({
  widget,
  bus,
}: {
  widget: ResultWidget;
  bus?: InlineStateBus;
}) {
  const isPrimary = widget.emphasis === 'primary';
  const formulaVars = useMemo(
    () => (widget.formula ? extractFormulaVars(widget.formula) : []),
    [widget.formula],
  );
  const watchIds = useMemo(() => {
    const ids = new Set<string>(formulaVars);
    if (widget.bind) ids.add(widget.bind);
    return Array.from(ids);
  }, [formulaVars, widget.bind]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!bus || watchIds.length === 0) return () => undefined;
      const unsubs = watchIds.map((id) => bus.subscribe(id, onStoreChange));
      return () => {
        for (const unsub of unsubs) unsub();
      };
    },
    [bus, watchIds],
  );

  // 返回稳定字符串快照，确保同批次挂载的兄弟滑块写入 bus 后立即同步渲染。
  const snapshotKey = useSyncExternalStore(
    subscribe,
    () => {
      if (!bus || watchIds.length === 0) return '';
      return watchIds.map((id) => `${id}=${String(bus.get(id) ?? '')}`).join('\u0001');
    },
    () => '',
  );

  const val: number | string = useMemo(() => {
    void snapshotKey;
    if (widget.bind && bus) {
      const fromBus = bus.get(widget.bind);
      if (fromBus !== undefined) return fromBus;
    }
    return widget.value;
  }, [bus, snapshotKey, widget.bind, widget.value]);

  const renderedFormula = useMemo(() => {
    void snapshotKey;
    if (!widget.formula) return null;
    const vars: Record<string, number | string> = { value: val };
    if (widget.bind) vars[widget.bind] = val;
    if (bus) {
      for (const id of formulaVars) {
        const cur = bus.get(id);
        if (cur !== undefined) vars[id] = cur;
      }
    }
    return interpolateFormula(widget.formula, vars);
  }, [bus, formulaVars, snapshotKey, val, widget.bind, widget.formula]);

  const showValue = !renderedFormula || String(val).trim() !== '';

  return (
    <div className="inline-result-body">
      {widget.label && (
        <div className="inline-widget-subtitle">
          <MathText text={widget.label} />
        </div>
      )}
      {renderedFormula && (
        <div className="inline-result-formula">
          <MathFormula tex={renderedFormula} displayMode />
        </div>
      )}
      {showValue && (
        <div className="inline-result-content">
          <span className={`inline-result-val ${isPrimary ? 'primary' : ''}`}>
            {typeof val === 'string' ? <MathText text={val} /> : val}
          </span>
          {widget.unit && <span className="inline-result-unit">{widget.unit}</span>}
        </div>
      )}
      {widget.caption && (
        <div className="inline-widget-caption">
          <MathText text={widget.caption} />
        </div>
      )}
    </div>
  );
}
