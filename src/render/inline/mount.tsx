import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { GenuiWidget } from '../../protocol/widget/types';
import inlineCss from './inline.css?inline';
import { attachThemeAttribute } from '../theme';
import { InlineWidgetRoot } from './InlineWidgetRoot';
import type { ContinueHandler } from './feedback';
import { getOrCreateInlineBus, type InlineStateBus } from './store';

export interface MountInlineOptions {
  widget: GenuiWidget;
  rawJson: string;
  bus?: InlineStateBus;
  onToggleRaw?: (showRaw: boolean) => void;
  onFatal?: (error: Error) => void;
  /** 作答回流：生产接线 content/followup.fillContinueIntoInput（追加不覆盖、不发送）。 */
  onContinue?: ContinueHandler;
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

  const style = doc.createElement('style');
  style.textContent = inlineCss;
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
        rawJson={options.rawJson}
        bus={bus}
        onToggleRaw={options.onToggleRaw}
        onFatal={options.onFatal}
        onContinue={options.onContinue}
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
