import { useMemo, useState } from 'react';
import type { FormField, FormWidget, QuizWidget } from '../../../protocol/widget/types';
import type {
  ContinueHandler,
  FollowupEnvironmentStore,
  RequestSendHandler,
} from '../feedback';
import { FormView } from './FormView';

function quizToModelForm(widget: QuizWidget): FormWidget {
  const questions =
    widget.questions && widget.questions.length > 0
      ? widget.questions
      : [{ id: 'q1', question: widget.question, options: widget.options }];

  const fields: FormField[] = questions.map((item, idx) => ({
    id: item.id || `q${idx + 1}`,
    type: 'choice',
    label: questions.length > 1 ? `${idx + 1}. ${item.question}` : item.question,
    options: item.options,
    layout: 'vertical',
    optional: false,
  }));

  const includeReason = widget.reason !== false;
  if (includeReason) {
    fields.push({
      id: 'reason',
      type: 'text',
      label: widget.reasonLabel || '简要解释理由（选填）',
      placeholder: '可简述判断依据或不确定之处（选填）',
      optional: true,
    });
  }

  const lines = questions.map((item, idx) => {
    const id = item.id || `q${idx + 1}`;
    const prefix = questions.length > 1 ? `${idx + 1}. ` : '';
    return `${prefix}${item.question} → 我的选择：{${id}}`;
  });
  const defaultPrompt =
    `请帮我批改以下测验作答，判断正误并解释原因：\n${lines.join('\n')}` +
    (includeReason ? '\n{reason?我的理由：{reason}}' : '');

  const customPrompt = widget.submit?.prompt?.trim() ?? '';
  const hasSeparateTitle =
    questions.length > 1 && widget.question.trim() !== '' && widget.question !== questions[0].question;

  return {
    w: 'form',
    id: widget.id,
    title: hasSeparateTitle ? widget.question : '理解检测',
    subtitle: '暂时不直接给出正确选项，提交后由模型批改并讲解',
    intent: 'quiz',
    fields,
    submit: {
      label: widget.submit?.label || '提交答案并批改',
      prompt: customPrompt || defaultPrompt,
    },
  };
}

export interface QuizViewProps {
  widget: QuizWidget;
  onRequestSend?: RequestSendHandler;
  onContinue?: ContinueHandler;
  followupEnv?: FollowupEnvironmentStore;
  requireTrustedClick?: boolean;
}

export function QuizView({
  widget,
  onRequestSend,
  onContinue,
  followupEnv,
  requireTrustedClick = true,
}: QuizViewProps) {
  const modelForm = useMemo(
    () => (widget.grade === 'model' ? quizToModelForm(widget) : null),
    [widget],
  );
  const [selected, setSelected] = useState<string | null>(null);

  if (modelForm) {
    return (
      <FormView
        widget={modelForm}
        onRequestSend={onRequestSend}
        onContinue={onContinue}
        followupEnv={followupEnv}
        requireTrustedClick={requireTrustedClick}
      />
    );
  }

  const hasAnswer = typeof widget.answer === 'string' && widget.answer.trim().length > 0;
  const isAnswered = selected !== null;

  const handleSelect = (val: string) => {
    setSelected(val);
  };

  const handleRetry = () => {
    setSelected(null);
  };

  return (
    <div className="inline-quiz-body">
      <div className="inline-quiz-question">{widget.question}</div>
      <div className="inline-quiz-options">
        {widget.options.map((opt) => {
          const isCurrentSelected = selected === opt.value;
          let optClass = 'inline-quiz-option';
          let badgeText: string | null = null;
          let badgeClass = '';

          if (isAnswered && hasAnswer) {
            const isCorrectOption = opt.value === widget.answer;
            if (isCurrentSelected) {
              if (isCorrectOption) {
                optClass += ' correct';
                badgeText = '✓ 正确';
                badgeClass = 'correct';
              } else {
                optClass += ' incorrect';
                badgeText = '✕ 你的选择';
                badgeClass = 'incorrect';
              }
            } else if (isCorrectOption) {
              optClass += ' correct';
              badgeText = '正确答案';
              badgeClass = 'correct';
            }
          } else if (isCurrentSelected) {
            optClass += ' selected';
          }

          return (
            <button
              key={opt.value}
              type="button"
              className={optClass}
              onClick={() => handleSelect(opt.value)}
            >
              <span>{opt.label}</span>
              {badgeText && <span className={`inline-quiz-badge ${badgeClass}`}>{badgeText}</span>}
            </button>
          );
        })}
      </div>

      {isAnswered && widget.explain && (
        <div className="inline-quiz-explain">
          <strong>解析：</strong>
          {widget.explain}
        </div>
      )}

      {isAnswered && (
        <div className="inline-quiz-footer">
          <button type="button" className="inline-quiz-retry" onClick={handleRetry}>
            重新作答
          </button>
        </div>
      )}
    </div>
  );
}
