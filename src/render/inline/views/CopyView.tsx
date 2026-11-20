import { useState } from 'react';
import type { CopyWidget } from '../../../protocol/widget/types';
import { MathText } from '../../math';

async function copyPlainText(text: string, doc: Document): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 剪贴板 API 不可用或被拒时走 execCommand 回退
  }

  try {
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    area.style.opacity = '0';
    doc.body.appendChild(area);
    area.select();
    const ok = typeof doc.execCommand === 'function' ? doc.execCommand('copy') : false;
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyView({ widget }: { widget: CopyWidget }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleCopy = async (doc: Document) => {
    const ok = await copyPlainText(widget.text, doc);
    setStatus(ok ? 'copied' : 'failed');
  };

  return (
    <div className="inline-copy-body">
      {widget.title && (
        <div className="inline-widget-header">
          <div className="inline-widget-title">
            <MathText text={widget.title} />
          </div>
        </div>
      )}

      <blockquote className="inline-copy-quote">{widget.text}</blockquote>

      <div className="inline-copy-footer">
        <div className="inline-copy-meta">
          {widget.note && (
            <span className="inline-copy-note">
              <MathText text={widget.note} />
            </span>
          )}
          {status !== 'idle' && (
            <span className="inline-feedback-status" role="status">
              {status === 'copied' ? '✓ 已复制到剪贴板' : '复制失败，请手动选中复制'}
            </span>
          )}
        </div>
        <button
          type="button"
          className="inline-copy-btn"
          onClick={(event) => {
            void handleCopy(event.currentTarget.ownerDocument);
          }}
        >
          {status === 'copied' ? '✓ 已复制' : (widget.label ?? '复制内容')}
        </button>
      </div>
    </div>
  );
}
