import { Component, type ErrorInfo, type ReactNode, useState } from 'react';
import type { GenuiWidget } from '../../protocol/widget/types';
import type { InlineStateBus } from './store';
import { QuizView } from './views/QuizView';
import { CardView } from './views/CardView';
import { CompareView } from './views/CompareView';
import { ChecklistView } from './views/ChecklistView';
import { SliderView } from './views/SliderView';
import { ResultView } from './views/ResultView';
import { NoteView } from './views/NoteView';
import { TimelineView } from './views/TimelineView';
import { SpoilerView } from './views/SpoilerView';
import { PollView } from './views/PollView';
import type { ContinueHandler } from './feedback';

interface ErrorBoundaryProps {
  children: ReactNode;
  onFatal?: (err: Error) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class InlineErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[dsgenui] inline widget render failed', error, errorInfo);
    this.props.onFatal?.(error);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="inline-note-box error">
          <span>⚠</span>
          <div>组件渲染异常，已切换为安全降级视图。</div>
        </div>
      );
    }
    return this.props.children;
  }
}

export interface InlineWidgetRootProps {
  widget: GenuiWidget;
  rawJson?: string;
  bus?: InlineStateBus;
  onToggleRaw?: (showRaw: boolean) => void;
  onFatal?: (err: Error) => void;
  /** 作答回流：点击清单/对比组件的回流按钮时以纯文本摘要调用（追加不覆盖、不发送）。 */
  onContinue?: ContinueHandler;
}

export function InlineWidgetRoot({
  widget,
  rawJson,
  bus,
  onToggleRaw,
  onFatal,
  onContinue,
}: InlineWidgetRootProps) {
  const [showRaw, setShowRaw] = useState(false);

  const handleToggleRaw = () => {
    const next = !showRaw;
    setShowRaw(next);
    onToggleRaw?.(next);
  };

  const renderContent = () => {
    switch (widget.w) {
      case 'quiz':
        return <QuizView widget={widget} />;
      case 'card':
        return <CardView widget={widget} />;
      case 'compare':
        return <CompareView widget={widget} onContinue={onContinue} />;
      case 'checklist':
        return <ChecklistView widget={widget} onContinue={onContinue} />;
      case 'slider':
        return <SliderView widget={widget} bus={bus} />;
      case 'result':
        return <ResultView widget={widget} bus={bus} />;
      case 'note':
        return <NoteView widget={widget} />;
      case 'timeline':
        return <TimelineView widget={widget} />;
      case 'spoiler':
        return <SpoilerView widget={widget} />;
      case 'poll':
        return <PollView widget={widget} />;
      default:
        return (
          <div className="inline-note-box info">
            <div>未知内联组件类型</div>
          </div>
        );
    }
  };

  return (
    <InlineErrorBoundary onFatal={onFatal}>
      <div className="inline-widget-box">
        {onToggleRaw && rawJson && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
            <button
              type="button"
              className="inline-raw-btn"
              onClick={handleToggleRaw}
              title="切换查看原始代码"
            >
              {showRaw ? '收起源码' : '源码'}
            </button>
          </div>
        )}
        {renderContent()}
      </div>
    </InlineErrorBoundary>
  );
}
