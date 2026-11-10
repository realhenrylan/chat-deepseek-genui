import { useState } from 'react';
import type { ChecklistWidget } from '../../../protocol/widget/types';
import { CONTINUE_FEEDBACK, buildChecklistContinue, type ContinueHandler } from '../feedback';

export function ChecklistView({
  widget,
  onContinue,
}: {
  widget: ChecklistWidget;
  onContinue?: ContinueHandler;
}) {
  const [checkedMap, setCheckedMap] = useState<Record<number, boolean>>(() => {
    const initial: Record<number, boolean> = {};
    widget.items.forEach((item, idx) => {
      if (item.checked) initial[idx] = true;
    });
    return initial;
  });
  const [feedback, setFeedback] = useState<string | null>(null);

  const toggleCheck = (idx: number) => {
    setCheckedMap((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
    // 勾选状态已变，旧的「已带入输入框」提示不再有效。
    setFeedback(null);
  };

  const total = widget.items.length;
  const completed = Object.values(checkedMap).filter(Boolean).length;

  const handleContinue = () => {
    const done: string[] = [];
    const todo: string[] = [];
    widget.items.forEach((item, idx) => {
      if (checkedMap[idx]) done.push(item.text);
      else todo.push(item.text);
    });
    const result = onContinue?.(buildChecklistContinue(done, todo)) ?? 'unavailable';
    setFeedback(CONTINUE_FEEDBACK[result]);
  };

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

      {total > 0 && completed > 0 && (
        <div className="inline-feedback-bar">
          <button type="button" className="inline-feedback-btn" onClick={handleContinue}>
            {completed === total
              ? '📋 将已完成清单带入下一步规划'
              : '📋 将未完成任务带入下一步规划'}
          </button>
          {feedback && (
            <span className="inline-feedback-status" role="status">
              {feedback}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
