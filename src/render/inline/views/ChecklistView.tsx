import { useState } from 'react';
import type { ChecklistWidget } from '../../../protocol/widget/types';

export function ChecklistView({ widget }: { widget: ChecklistWidget }) {
  const [checkedMap, setCheckedMap] = useState<Record<number, boolean>>(() => {
    const initial: Record<number, boolean> = {};
    widget.items.forEach((item, idx) => {
      if (item.checked) initial[idx] = true;
    });
    return initial;
  });

  const toggleCheck = (idx: number) => {
    setCheckedMap((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const total = widget.items.length;
  const completed = Object.values(checkedMap).filter(Boolean).length;

  return (
    <div className="inline-checklist-body">
      <div className="inline-widget-header">
        <div className="inline-widget-title">{widget.title || '任务清单'}</div>
        <div className="inline-checklist-progress">
          {completed} / {total} 已完成
        </div>
      </div>

      <div className="inline-checklist-items">
        {widget.items.map((item, idx) => {
          const isChecked = !!checkedMap[idx];
          return (
            <label key={idx} className="inline-checklist-item">
              <input
                type="checkbox"
                className="inline-checklist-checkbox"
                checked={isChecked}
                onChange={() => toggleCheck(idx)}
              />
              <div className="inline-checklist-content">
                <div className={`inline-checklist-text ${isChecked ? 'checked' : ''}`}>
                  {item.text}
                </div>
                {item.note && <div className="inline-checklist-note">{item.note}</div>}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
