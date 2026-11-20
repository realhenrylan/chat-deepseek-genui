import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { GenuiWidget } from '../../protocol/widget/types';
import inlineCss from './inline.css?inline';
import { ensureKatexFonts, KATEX_SHADOW_CSS } from '../math';
import { attachThemeAttribute } from '../theme';
import { InlineWidgetRoot } from './InlineWidgetRoot';
import type {
  ContinueHandler,
  FollowupEnvironmentStore,
  RequestSendHandler,
} from './feedback';
import { getOrCreateInlineBus, type InlineStateBus } from './store';

export interface MountInlineOptions {
  widget: GenuiWidget;
  rawJson?: string;
  bus?: InlineStateBus;
  onFatal?: (error: Error) => void;
  /** 作答回流：生产接线 content/followup.fillContinueIntoInput（追加不覆盖、不发送）。 */
  onContinue?: ContinueHandler;
  /** 一键回流：生产接线 content/followup.createSendCoordinator。 */
  onRequestSend?: RequestSendHandler;
  /** 实时回流环境状态（生成中、草稿状态、回流模式）。 */
  followupEnv?: FollowupEnvironmentStore;
  /** G1 护栏：默认 true（仅允许 isTrusted === true 的点击）。 */
  requireTrustedClick?: boolean;
}

export interface MountedInlineWidget {
  unmount(): void;
}

export function mountInlineWidget(
  host: HTMLElement,
  options: MountInlineOptions,
): MountedInlineWidget {
  const doc = host.ownerDocument;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.replaceChildren();

  ensureKatexFonts(doc);

  const style = doc.createElement('style');
  style.textContent = `${inlineCss}\n${KATEX_SHADOW_CSS}`;
  shadow.appendChild(style);

  const container = doc.createElement('div');
  container.className = 'genui-inline-root';
  shadow.appendChild(container);

  const disposeTheme = attachThemeAttribute(container, doc);
  const root: Root = createRoot(container);
  const bus = options.bus ?? getOrCreateInlineBus(host.closest('.ds-assistant-message-main-content'));

  flushSync(() => {
    root.render(
      <InlineWidgetRoot
        widget={options.widget}
        bus={bus}
        onFatal={options.onFatal}
        onContinue={options.onContinue}
        onRequestSend={options.onRequestSend}
        followupEnv={options.followupEnv}
        requireTrustedClick={options.requireTrustedClick}
      />,
    );
  });

  return {
    unmount: () => {
      disposeTheme();
      root.unmount();
      container.remove();
    },
  };
}
