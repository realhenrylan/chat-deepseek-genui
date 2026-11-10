import { useState } from 'react';
import type { PollWidget } from '../../../protocol/widget/types';

export function PollView({ widget }: { widget: PollWidget }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const voted = selectedId !== null;

  return (
    <div className="inline-poll-body">
      <div className="inline-poll-question">{widget.question}</div>
      <div className="inline-poll-options">
        {widget.options.map((opt) => {
          const selected = selectedId === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              className={`inline-poll-option ${voted ? 'voted' : ''} ${selected ? 'selected' : ''}`}
              aria-pressed={selected}
              disabled={voted}
              onClick={() => setSelectedId(opt.id)}
            >
              {voted && (
                <span
                  className="inline-poll-bar"
                  style={{ width: `${opt.ratio}%` }}
                  aria-hidden="true"
                />
              )}
              <span className="inline-poll-label">
                {selected ? `✓ ${opt.label}` : opt.label}
              </span>
              {voted && <span className="inline-poll-ratio">{opt.ratio}%</span>}
            </button>
          );
        })}
      </div>
      {voted && (
        <button
          type="button"
          className="inline-poll-reset"
          onClick={() => setSelectedId(null)}
        >
          重新投票
        </button>
      )}
    </div>
  );
}
