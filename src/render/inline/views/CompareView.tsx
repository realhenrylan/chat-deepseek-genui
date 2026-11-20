import { useState, type MouseEvent } from 'react';
import type { CompareWidget } from '../../../protocol/widget/types';
import {
  formatFollowupActionLabel,
  useFollowupDispatcher,
  useFollowupEnvironment,
} from '../../use-followup';
import {
  buildCompareContinue,
  type ContinueHandler,
  type FollowupEnvironmentStore,
  type RequestSendHandler,
} from '../feedback';

export interface CompareViewProps {
  widget: CompareWidget;
  onContinue?: ContinueHandler;
  onRequestSend?: RequestSendHandler;
  followupEnv?: FollowupEnvironmentStore;
  requireTrustedClick?: boolean;
}

export function CompareView({
  widget,
  onContinue,
  onRequestSend,
  followupEnv,
  requireTrustedClick = true,
}: CompareViewProps) {
  const [selected, setSelected] = useState<{ index: number; feedback: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const env = useFollowupEnvironment(followupEnv);
  const { submitting, dispatch } = useFollowupDispatcher({
    onRequestSend,
    onContinue,
    requireTrustedClick,
    unavailableMessage: '未找到聊天输入框',
  });

  const hasSendHandler = Boolean(onRequestSend);
  const disabled = submitting || (hasSendHandler && env.generationActive);
  // 纯概念/信息对比（如“GeForce / GTX / RTX 是什么关系”）没有可采纳的“方案”，不显示采纳按钮；
  // 显式 selectable 优先，否则仅在给出推荐项 highlight 时视为选型对比。
  const selectable = widget.selectable ?? Boolean(widget.highlight);

  const handleSelect = (
    event: MouseEvent<HTMLButtonElement>,
    index: number,
    name: string,
  ) => {
    if (disabled) return;
    setActiveIndex(index);
    dispatch(event, buildCompareContinue(name), (outcome) => {
      setActiveIndex(null);
      if (outcome.kind === 'ignored-untrusted') return;
      setSelected({ index, feedback: outcome.feedback ?? '' });
    });
  };

  return (
    <div className="inline-compare-body">
      {widget.title && (
        <div className="inline-widget-header">
          <div className="inline-widget-title">{widget.title}</div>
        </div>
      )}
      <div className="inline-compare-grid">
        {widget.items.map((item, idx) => {
          const isHighlighted = widget.highlight === item.name;
          const hasList = (item.pros?.length ?? 0) > 0 || (item.cons?.length ?? 0) > 0;
          const label = formatFollowupActionLabel('👉 采用此方案继续细化', env, {
            hasSendHandler,
            submitting: submitting && activeIndex === idx,
          });
          return (
            <div
              key={idx}
              className={`inline-compare-col ${isHighlighted ? 'highlighted' : ''}`}
            >
              <div className="inline-compare-col-head">
                <div className="inline-compare-name">{item.name}</div>
                {isHighlighted && <span className="inline-compare-pill">推荐</span>}
              </div>

              {hasList && (
                <ul className="inline-compare-list">
                  {item.pros?.map((pro, pIdx) => (
                    <li key={`p-${pIdx}`} className="inline-compare-pro">
                      <span>+</span>
                      <span>{pro}</span>
                    </li>
                  ))}
                  {item.cons?.map((con, cIdx) => (
                    <li key={`c-${cIdx}`} className="inline-compare-con">
                      <span>-</span>
                      <span>{con}</span>
                    </li>
                  ))}
                </ul>
              )}

              {item.fields && Object.keys(item.fields).length > 0 && (
                <div className="inline-compare-fields">
                  {Object.entries(item.fields).map(([k, v]) => (
                    <div key={k} className="inline-compare-field-row">
                      <span>{k}</span>
                      <span className="inline-compare-field-val">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}

              {selectable && (
                <div className="inline-compare-actions">
                  {selected?.index === idx && selected.feedback !== '' && (
                    <span className="inline-feedback-status" role="status">
                      {selected.feedback}
                    </span>
                  )}
                  <button
                    type="button"
                    className={`inline-compare-select-btn ${selected?.index === idx ? 'selected' : ''}`}
                    disabled={disabled}
                    onClick={(event) => handleSelect(event, idx, item.name)}
                  >
                    {label}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
