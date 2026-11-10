import { useState } from 'react';
import type { SpoilerWidget } from '../../../protocol/widget/types';

export function SpoilerView({ widget }: { widget: SpoilerWidget }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="inline-spoiler-body">
      <div className="inline-widget-header">
        <div className="inline-spoiler-summary">{widget.summary}</div>
      </div>
      {widget.hint && <div className="inline-spoiler-hint">{widget.hint}</div>}
      <button
        type="button"
        className="inline-spoiler-toggle"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? '收起思考与解析' : '展开思考与解析'}
      </button>
      {open && <div className="inline-spoiler-content">{widget.content}</div>}
    </div>
  );
}
