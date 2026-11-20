import { useState, useSyncExternalStore, type MouseEvent } from 'react';
import {
  CONTINUE_FEEDBACK,
  formatRequestSendFeedback,
  type ContinueHandler,
  type ContinueResult,
  type FollowupEnvironmentState,
  type FollowupEnvironmentStore,
  type RequestSendHandler,
  type RequestSendResult,
} from './inline/feedback';

const DEFAULT_ENV: FollowupEnvironmentState = {
  generationActive: false,
  hasDraft: false,
  followupMode: 'send',
};

const EMPTY_SUBSCRIBE = () => () => undefined;
const GET_DEFAULT_ENV = () => DEFAULT_ENV;

/** 订阅实时回流环境状态（生成中 / 输入框草稿 / 直接发送或仅填入模式）。 */
export function useFollowupEnvironment(
  followupEnv?: FollowupEnvironmentStore,
): FollowupEnvironmentState {
  return useSyncExternalStore(
    followupEnv ? followupEnv.subscribe : EMPTY_SUBSCRIBE,
    followupEnv ? followupEnv.getSnapshot : GET_DEFAULT_ENV,
  );
}

/** 按回流环境与送信能力统一格式化按钮文案。 */
export function formatFollowupActionLabel(
  baseLabel: string,
  env: FollowupEnvironmentState,
  options: {
    hasSendHandler: boolean;
    submitting: boolean;
    fallbackLabel?: string;
    fillModeLabel?: string;
    sendModeLabel?: string;
  },
): string {
  if (!options.hasSendHandler) {
    return options.fallbackLabel ?? baseLabel;
  }
  if (env.generationActive) return '等待当前回答结束';
  if (options.submitting) return '正在发送…';
  if (env.followupMode === 'fill' || env.hasDraft) {
    return options.fillModeLabel ?? `${baseLabel}（带入输入框）`;
  }
  return options.sendModeLabel ?? `${baseLabel} →`;
}

export interface FollowupTriggerOutcome {
  kind: 'ignored-untrusted' | 'sent' | 'filled' | 'notice' | 'error';
  feedback: string | null;
  sendResult?: RequestSendResult;
  continueResult?: ContinueResult;
}

/** 统一主按钮「直接发送 / G1–G9 护栏降级 / onContinue 兜底」分发逻辑。 */
export function useFollowupDispatcher(params: {
  onRequestSend?: RequestSendHandler;
  onContinue?: ContinueHandler;
  requireTrustedClick?: boolean;
  enforceTrustedOnContinue?: boolean;
  unavailableMessage?: string;
  continueFeedback?: Readonly<Record<ContinueResult, string>>;
}) {
  const [submitting, setSubmitting] = useState(false);

  const dispatch = (
    event: MouseEvent<HTMLButtonElement>,
    message: string,
    onOutcome: (outcome: FollowupTriggerOutcome) => void,
  ): void => {
    const isTrusted = event.nativeEvent.isTrusted;
    const requireTrusted = params.requireTrustedClick ?? true;

    if (params.onRequestSend) {
      if (requireTrusted && !isTrusted) {
        onOutcome({ kind: 'ignored-untrusted', feedback: null });
        return;
      }
      setSubmitting(true);
      void Promise.resolve(params.onRequestSend(message, { isTrusted }))
        .then((result) => {
          if (result.status === 'untrusted') {
            onOutcome({ kind: 'ignored-untrusted', feedback: null, sendResult: result });
            return;
          }
          const feedback = formatRequestSendFeedback(result);
          const kind =
            result.status === 'sent'
              ? 'sent'
              : result.status === 'first-time-notice'
                ? 'notice'
                : result.status === 'filled' ||
                    result.status === 'appended' ||
                    result.status === 'draft-protected' ||
                    result.status === 'fallback-filled'
                  ? 'filled'
                  : 'error';
          onOutcome({ kind, feedback, sendResult: result });
        })
        .finally(() => {
          setSubmitting(false);
        });
      return;
    }

    if (params.enforceTrustedOnContinue && requireTrusted && !isTrusted) {
      onOutcome({ kind: 'ignored-untrusted', feedback: null });
      return;
    }

    if (params.onContinue) {
      const result = params.onContinue(message);
      const map = params.continueFeedback ?? CONTINUE_FEEDBACK;
      onOutcome({
        kind: result === 'filled' || result === 'appended' ? 'filled' : 'error',
        feedback: map[result],
        continueResult: result,
      });
      return;
    }

    onOutcome({
      kind: 'error',
      feedback: params.unavailableMessage ?? '当前环境不支持发送消息',
    });
  };

  return { submitting, dispatch };
}
