import { Component, type ErrorInfo, type ReactNode } from 'react';
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
import { FormView } from './views/FormView';
import type {
  ContinueHandler,
  FollowupEnvironmentStore,
  RequestSendHandler,
} from './feedback';

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
          <span className="inline-note-icon">⚠</span>
          <div className="inline-note-text">组件渲染异常，已切换为安全降级视图。</div>
        </div>
      );
    }
    return this.props.children;
  }
}

export interface InlineWidgetRootProps {
  widget: GenuiWidget;
  bus?: InlineStateBus;
  onFatal?: (err: Error) => void;
  /** 作答回流：点击清单/对比组件的回流按钮时以纯文本摘要调用（追加不覆盖、不发送）。 */
  onContinue?: ContinueHandler;
  /** 一键回流：点击表单/模型批改主按钮时发起发送或按护栏降级。 */
  onRequestSend?: RequestSendHandler;
  /** 实时回流环境状态（生成中、草稿状态、回流模式）。 */
  followupEnv?: FollowupEnvironmentStore;
  /** G1 护栏：生产必须校验 click 事件 isTrusted === true；默认 true。 */
  requireTrustedClick?: boolean;
}

export function InlineWidgetRoot({
  widget,
  bus,
  onFatal,
  onContinue,
  onRequestSend,
  followupEnv,
  requireTrustedClick = true,
}: InlineWidgetRootProps) {
  const renderContent = () => {
    switch (widget.w) {
      case 'quiz':
        return (
          <QuizView
            widget={widget}
            onRequestSend={onRequestSend}
            onContinue={onContinue}
            followupEnv={followupEnv}
            requireTrustedClick={requireTrustedClick}
          />
        );
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
      case 'form':
        return (
          <FormView
            widget={widget}
            onRequestSend={onRequestSend}
            onContinue={onContinue}
            followupEnv={followupEnv}
            requireTrustedClick={requireTrustedClick}
          />
        );
      default:
        return (
          <div className="inline-note-box info">
            <div>未知内联组件类型</div>
          </div>
        );
    }
  };

  return (
    <div className="inline-widget-box">
      <InlineErrorBoundary onFatal={onFatal}>{renderContent()}</InlineErrorBoundary>
    </div>
  );
}
