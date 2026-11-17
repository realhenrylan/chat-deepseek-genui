import type { NoteWidget } from '../../../protocol/widget/types';

export function NoteView({ widget }: { widget: NoteWidget }) {
  const tone = widget.tone ?? 'info';

  const toneIcons: Record<string, string> = {
    info: 'ℹ',
    warn: '⚠',
    error: '✕',
  };

  return (
    <div className={`inline-note-box ${tone}`}>
      <span className="inline-note-icon">{toneIcons[tone] ?? 'ℹ'}</span>
      <div className="inline-note-text">{widget.text}</div>
    </div>
  );
}
