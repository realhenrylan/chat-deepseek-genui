import { useState, type MouseEvent } from 'react';
import type { ChecklistWidget } from '../../../protocol/widget/types';
import {
  formatFollowupActionLabel,
  useFollowupDispatcher,
  useFollowupEnvironment,
} from '../../use-followup';
import {
  buildChecklistContinue,
  type ContinueHandler,
  type FollowupEnvironmentStore,
  type RequestSendHandler,
} from '../feedback';

export interface ChecklistViewProps {
  widget: ChecklistWidget;
  onContinue?: ContinueHandler;
  onRequestSend?: RequestSendHandler;
  followupEnv?: FollowupEnvironmentStore;
  requireTrustedClick?: boolean;
}

export function ChecklistView({
  widget,
  onContinue,
  onRequestSend,
  followupEnv,
  requireTrustedClick = true,
}: ChecklistViewProps) {
  const [checkedMap, setCheckedMap] = useState<Record<number, boolean>>(() => {
    const initial: Record<number, boolean> = {};
    widget.items.forEach((item, idx) => {
      if (item.checked) initial[idx] = true;
    });
    return initial;
  });
  const [feedback, setFeedback] = useState<string | null>(null);

  const env = useFollowupEnvironment(followupEnv);
  const { submitting, dispatch } = useFollowupDispatcher({
    onRequestSend,
    onContinue,
    requireTrustedClick,
    unavailableMessage: '未找到聊天输入框',
  });

  const toggleCheck = (idx: number) => {
    setCheckedMap((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
    // 勾选状态已变，旧的回流状态提示不再有效。
    setFeedback(null);
  };

  const total = widget.items.length;
  const completed = Object.values(checkedMap).filter(Boolean).length;
  const hasSendHandler = Boolean(onRequestSend);
  const disabled = submitting || (hasSendHandler && env.generationActive);

  const handleContinue = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const done: string[] = [];
    const todo: string[] = [];
    widget.items.forEach((item, idx) => {
      if (checkedMap[idx]) done.push(item.text);
      else todo.push(item.text);
    });
    dispatch(event, buildChecklistContinue(done, todo), (outcome) => {
      if (outcome.kind === 'ignored-untrusted') return;
      setFeedback(outcome.feedback);
    });
  };

  const fallbackLabel =
    completed === total
      ? '📋 将已完成清单带入下一步规划'
      : '📋 将未完成任务带入下一步规划';
  const sendBaseLabel =
    completed === total
      ? '📋 按已完成清单规划下一步'
      : '📋 按未完成任务规划下一步';
  const buttonLabel = formatFollowupActionLabel(sendBaseLabel, env, {
    hasSendHandler,
    submitting,
    fallbackLabel,
  });

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
          <button
            type="button"
            className="inline-feedback-btn"
            disabled={disabled}
            onClick={handleContinue}
          >
            {buttonLabel}
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
