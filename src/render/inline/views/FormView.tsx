import {
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from 'react';
import { renderFormPrompt } from '../../../protocol/widget/template';
import type { FormField, FormWidget } from '../../../protocol/widget/types';
import {
  CONTINUE_FEEDBACK,
  formatRequestSendFeedback,
  type ContinueHandler,
  type FollowupEnvironmentState,
  type FollowupEnvironmentStore,
  type RequestSendHandler,
} from '../feedback';

const DEFAULT_ENV: FollowupEnvironmentState = {
  generationActive: false,
  hasDraft: false,
  followupMode: 'send',
};

const EMPTY_SUBSCRIBE = () => () => undefined;
const GET_DEFAULT_ENV = () => DEFAULT_ENV;

type FieldStateValue = string | string[];

function createInitialValues(fields: readonly FormField[]): Record<string, FieldStateValue> {
  const initial: Record<string, FieldStateValue> = {};
  for (const field of fields) {
    if (field.type === 'checkbox') {
      initial[field.id] = Array.isArray(field.default) ? [...field.default] : [];
    } else if (field.type === 'choice') {
      // R-F2: 测验类选择字段绝不预选默认值
      initial[field.id] = '';
    } else {
      initial[field.id] = typeof field.default === 'string' ? field.default : '';
    }
  }
  return initial;
}

function isFieldMissing(field: FormField, value: FieldStateValue | undefined): boolean {
  if (field.optional) return false;
  if (field.type === 'checkbox') {
    return !Array.isArray(value) || value.length === 0;
  }
  if (field.type === 'text') {
    return typeof value !== 'string' || value.trim().length === 0;
  }
  return typeof value !== 'string' || value.length === 0;
}

function formatFieldValue(field: FormField, value: FieldStateValue | undefined): string {
  if (field.type === 'text') {
    const raw = typeof value === 'string' ? value : '';
    return raw.trim() === '' ? '' : raw;
  }
  if (field.type === 'checkbox') {
    const selected = Array.isArray(value) ? value : [];
    const labels = selected.map((val) => {
      const opt = field.options.find((o) => o.value === val);
      return opt ? opt.label : val;
    });
    return labels.join('、');
  }
  const rawVal = typeof value === 'string' ? value : '';
  if (!rawVal) return '';
  const opt = field.options.find((o) => o.value === rawVal);
  if (!opt) return rawVal;
  if (field.type === 'choice' && opt.value !== opt.label && !opt.label.startsWith(opt.value)) {
    return `${opt.value}（${opt.label}）`;
  }
  return opt.label;
}

export interface FormViewProps {
  widget: FormWidget;
  onRequestSend?: RequestSendHandler;
  onContinue?: ContinueHandler;
  followupEnv?: FollowupEnvironmentStore;
  requireTrustedClick?: boolean;
}

export function FormView({
  widget,
  onRequestSend,
  onContinue,
  followupEnv,
  requireTrustedClick = true,
}: FormViewProps) {
  const instanceId = useId();
  const [values, setValues] = useState<Record<string, FieldStateValue>>(() =>
    createInitialValues(widget.fields),
  );
  const [locked, setLocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const env = useSyncExternalStore(
    followupEnv ? followupEnv.subscribe : EMPTY_SUBSCRIBE,
    followupEnv ? followupEnv.getSnapshot : GET_DEFAULT_ENV,
  );

  const missingFields = useMemo(
    () => widget.fields.filter((field) => isFieldMissing(field, values[field.id])),
    [widget.fields, values],
  );

  const canSubmit = !locked && !submitting && !env.generationActive && missingFields.length === 0;

  const updateRadio = (fieldId: string, optionValue: string) => {
    if (locked || submitting) return;
    setValues((prev) => ({ ...prev, [fieldId]: optionValue }));
    setFeedback(null);
  };

  const toggleCheckbox = (fieldId: string, optionValue: string) => {
    if (locked || submitting) return;
    setValues((prev) => {
      const existing = Array.isArray(prev[fieldId]) ? (prev[fieldId] as string[]) : [];
      const next = existing.includes(optionValue)
        ? existing.filter((v) => v !== optionValue)
        : [...existing, optionValue];
      return { ...prev, [fieldId]: next };
    });
    setFeedback(null);
  };

  const updateText = (fieldId: string, textValue: string) => {
    if (locked || submitting) return;
    setValues((prev) => ({ ...prev, [fieldId]: textValue }));
    setFeedback(null);
  };

  const handlePrimaryClick = async (event: MouseEvent<HTMLButtonElement>) => {
    if (requireTrustedClick && !event.nativeEvent.isTrusted) return;
    if (!canSubmit) return;

    const formatted: Record<string, string> = {};
    for (const field of widget.fields) {
      formatted[field.id] = formatFieldValue(field, values[field.id]);
    }
    const prompt = renderFormPrompt(widget, formatted);

    if (onRequestSend) {
      setSubmitting(true);
      try {
        const result = await onRequestSend(prompt, {
          isTrusted: event.nativeEvent.isTrusted,
        });
        if (result.status === 'untrusted') return;
        setFeedback(formatRequestSendFeedback(result));
        if (result.status === 'sent') {
          setLocked(true);
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (onContinue) {
      const result = onContinue(prompt);
      setFeedback(CONTINUE_FEEDBACK[result]);
      return;
    }

    setFeedback('当前环境不支持发送消息');
  };

  const handleUnlock = () => {
    setLocked(false);
    setFeedback(null);
  };

  const baseLabel = widget.submit.label.replace(/\s*→\s*$/, '').trim() || '提交并继续';
  const fillOnly = env.followupMode === 'fill' || env.hasDraft;
  const primaryLabel = env.generationActive
    ? '等待当前回答结束'
    : submitting
      ? '正在发送…'
      : fillOnly
        ? `${baseLabel}（带入输入框）`
        : `${baseLabel} →`;

  const disabledHint = env.generationActive
    ? '模型正在回答中，回答结束后可继续发送'
    : missingFields.length > 0
      ? widget.intent === 'quiz'
        ? '请先完成全部题目后再提交批改'
        : `请先完成必填项：${missingFields.map((f) => f.label).join('、')}`
      : null;

  const draftHint =
    !locked && !env.generationActive && env.followupMode === 'send' && env.hasDraft
      ? '检测到输入框已有草稿，点击将追加到草稿末尾而不直接发送'
      : null;

  return (
    <div className="inline-form-body" data-form-locked={locked ? 'true' : 'false'}>
      <div className="inline-widget-header">
        <div className="inline-widget-heading">
          <div className="inline-widget-title">{widget.title}</div>
          {widget.subtitle && <div className="inline-widget-subtitle">{widget.subtitle}</div>}
        </div>
      </div>

      <div className="inline-form-fields">
        {widget.fields.map((field) => {
          const val = values[field.id];
          const fieldDomId = `${instanceId}-${field.id}`;
          return (
            <div key={field.id} className="inline-form-field">
              <div className="inline-form-field-label" id={`${fieldDomId}-label`}>
                {field.label}
              </div>

              {(field.type === 'radio' || field.type === 'choice') && (
                <div
                  role="radiogroup"
                  aria-labelledby={`${fieldDomId}-label`}
                  className={`inline-form-options ${field.layout === 'inline' ? 'inline' : 'vertical'}`}
                >
                  {field.options.map((opt) => {
                    const isSelected = val === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        disabled={locked || submitting}
                        className={`inline-form-option ${isSelected ? 'selected' : ''}`}
                        onClick={() => updateRadio(field.id, opt.value)}
                      >
                        <span className="inline-form-radio-dot" aria-hidden="true" />
                        <span className="inline-form-option-label">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {field.type === 'checkbox' && (
                <div
                  role="group"
                  aria-labelledby={`${fieldDomId}-label`}
                  className={`inline-form-options ${field.layout === 'inline' ? 'inline' : 'vertical'}`}
                >
                  {field.options.map((opt) => {
                    const selectedList = Array.isArray(val) ? val : [];
                    const isChecked = selectedList.includes(opt.value);
                    return (
                      <label
                        key={opt.value}
                        className={`inline-form-checkbox-item ${isChecked ? 'selected' : ''} ${locked || submitting ? 'disabled' : ''}`}
                      >
                        <input
                          type="checkbox"
                          className="inline-form-checkbox-input"
                          checked={isChecked}
                          disabled={locked || submitting}
                          onChange={() => toggleCheckbox(field.id, opt.value)}
                        />
                        <span className="inline-form-option-label">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {field.type === 'text' && (
                <textarea
                  id={fieldDomId}
                  aria-labelledby={`${fieldDomId}-label`}
                  className="inline-form-textarea"
                  rows={2}
                  disabled={locked || submitting}
                  placeholder={field.placeholder ?? '输入补充说明…'}
                  maxLength={field.maxLength}
                  value={typeof val === 'string' ? val : ''}
                  onChange={(e) => updateText(field.id, e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="inline-form-actions">
        {!locked ? (
          <>
            {disabledHint && (
              <div className="inline-form-hint" role="note">
                {disabledHint}
              </div>
            )}
            {!disabledHint && draftHint && (
              <div className="inline-form-hint" role="note">
                {draftHint}
              </div>
            )}
            <button
              type="button"
              className="inline-primary-btn"
              disabled={!canSubmit}
              onClick={handlePrimaryClick}
            >
              {primaryLabel}
            </button>
          </>
        ) : (
          <div className="inline-form-locked-bar">
            <span className="inline-form-submitted-badge">✓ 已提交</span>
            <button
              type="button"
              className="inline-secondary-btn"
              onClick={handleUnlock}
            >
              修改后重新提交
            </button>
          </div>
        )}

        {feedback && (
          <div className="inline-feedback-status" role="status">
            {feedback}
          </div>
        )}
      </div>
    </div>
  );
}
