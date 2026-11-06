import { useState } from 'react';
import type { QuizWidget } from '../../../protocol/widget/types';

export function QuizView({ widget }: { widget: QuizWidget }) {
  const [selected, setSelected] = useState<string | null>(null);

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
