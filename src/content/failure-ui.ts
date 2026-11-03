import type { GenuiDiagnostic } from '../protocol/diagnose';
import { buildRepairPrompt } from '../protocol/diagnose';
import { copyText, type RepairDeliveryResult } from './repair';

/**
 * 失败/等待状态面板：挂在原始代码块之后，原始内容始终保留。
 *
 * - pending / validating / deferred 只表达暂态，不写 failed；
 * - invalid / incomplete 展示最相关的错误路径、期望格式与原始内容；
 * - 「生成修复请求」只把限定范围的草稿写入聊天输入框或剪贴板，绝不自动发送。
 */

export const STATUS_ATTR = 'data-genui-status';
export const STATUS_HOST_CLASS = 'genui-status-host';
export const STATUS_HOST_ATTR = 'data-genui-status-host';

export type BlockStatus = 'pending' | 'validating' | 'deferred' | 'invalid' | 'incomplete' | 'incompatible';

export type StatusPanelOptions = {
  onRequestRepair?: (prompt: string) => RepairDeliveryResult | Promise<RepairDeliveryResult>;
};

const PANEL_CSS = `
:host { display: block; margin: 8px 0 12px; color: inherit; font-size: 13px; line-height: 1.55; }
.genui-status-card {
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, currentColor 5%, transparent);
  padding: 10px 12px;
}
.genui-status-head { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; }
.genui-status-title { font-weight: 600; color: inherit; }
.genui-status-badge {
  flex: none; border-radius: 999px; padding: 1px 8px; font-size: 11px;
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.genui-status-summary { margin: 0; color: inherit; opacity: .85; overflow-wrap: anywhere; }
.genui-status-meta { margin: 6px 0 0; display: grid; gap: 2px; opacity: .82; }
.genui-status-meta code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
.genui-status-issues { margin: 6px 0 0; padding-left: 18px; opacity: .82; }
.genui-status-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.genui-status-actions button {
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 8px; padding: 5px 10px; background: transparent; color: inherit;
  font: inherit; cursor: pointer;
}
.genui-status-actions button:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.genui-status-actions button:disabled { opacity: .55; cursor: default; }
.genui-status-actions button[data-primary] {
  border-color: color-mix(in srgb, #4d6bfe 65%, transparent);
  color: #4d6bfe;
}
.genui-status-feedback { margin: 8px 0 0; min-height: 1.2em; color: inherit; opacity: .8; }
.genui-status-raw { margin-top: 8px; opacity: .9; }
.genui-status-raw summary { cursor: pointer; }
.genui-status-raw pre {
  max-height: 220px; overflow: auto; margin: 6px 0 0; padding: 8px;
  border-radius: 8px; background: color-mix(in srgb, currentColor 7%, transparent);
  white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
}
.genui-status-raw button {
  margin-top: 6px; border: 0; background: transparent; color: inherit; opacity: .75;
  font: inherit; cursor: pointer; padding: 0;
}
.genui-status-spinner {
  width: 12px; height: 12px; flex: none; border-radius: 50%;
  border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor; animation: genui-spin .8s linear infinite;
}
@keyframes genui-spin { to { transform: rotate(360deg); } }
@media (prefers-color-scheme: dark) {
  .genui-status-card { background: color-mix(in srgb, currentColor 8%, transparent); }
}
`;

const PENDING_TEXT: Record<'pending' | 'validating' | 'deferred', { title: string; summary: string }> = {
  pending: {
    title: '等待完整内容…',
    summary: '回答仍在生成，这段界面内容完成后会自动校验并显示卡片。',
  },
  validating: {
    title: '正在验证界面…',
    summary: '内容已稳定，正在检查协议、字段与引用。',
  },
  deferred: {
    title: '等待页面完整显示',
    summary: '这段代码块尚未完整渲染，滚动到可见位置后会继续校验；这不是格式失败。',
  },
};

const FEEDBACK: Record<RepairDeliveryResult, string> = {
  filled: '已填入输入框；请检查草稿后自行发送。',
  appended: '草稿已保留：修复请求已写入；若草稿中已有相同内容则不会重复追加，请检查后发送。',
  copied: '修复请求已复制；可粘贴到输入框，检查后发送。',
  'copy-failed': '未找到聊天输入框，也无法自动复制；请展开原始内容手动复制。',
};

function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}


export class GenuiStatusPanel {
  readonly host: HTMLElement;
  private readonly card: HTMLElement;
  private readonly options: StatusPanelOptions;
  private raw = '';
  private diagnostic: GenuiDiagnostic | null = null;
  private busy = false;

  constructor(
    private readonly doc: Document,
    block: HTMLElement,
    options: StatusPanelOptions = {},
  ) {
    this.options = options;
    this.host = doc.createElement('div');
    this.host.className = STATUS_HOST_CLASS;
    this.host.setAttribute(STATUS_HOST_ATTR, '');
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = PANEL_CSS;
    this.card = doc.createElement('div');
    this.card.className = 'genui-status-card';
    shadow.append(style, this.card);
    block.insertAdjacentElement('afterend', this.host);
  }

  showPending(status: 'pending' | 'validating' | 'deferred'): void {
    this.diagnostic = null;
    this.raw = '';
    const text = PENDING_TEXT[status];
    const head = createElement(this.doc, 'div', 'genui-status-head');
    head.append(
      createElement(this.doc, 'span', 'genui-status-spinner'),
      createElement(this.doc, 'span', 'genui-status-title', text.title),
    );
    this.card.replaceChildren(
      head,
      createElement(this.doc, 'p', 'genui-status-summary', text.summary),
    );
  }

  showDiagnostic(diagnostic: GenuiDiagnostic, raw: string): void {
    this.diagnostic = diagnostic;
    this.raw = raw;
    const head = createElement(this.doc, 'div', 'genui-status-head');
    head.append(
      createElement(this.doc, 'span', 'genui-status-title', diagnostic.title),
      createElement(
        this.doc,
        'span',
        'genui-status-badge',
        diagnostic.status === 'incomplete'
          ? '尚未完整'
          : diagnostic.status === 'page-incompatible'
            ? '页面限制'
            : '需要修复',
      ),
    );

    const nodes: Node[] = [
      head,
      createElement(this.doc, 'p', 'genui-status-summary', diagnostic.summary),
    ];

    if (diagnostic.path || diagnostic.expected || diagnostic.actual) {
      const meta = createElement(this.doc, 'div', 'genui-status-meta');
      if (diagnostic.path) {
        const line = createElement(this.doc, 'div');
        line.append(
          createElement(this.doc, 'span', undefined, '错误路径：'),
          createElement(this.doc, 'code', undefined, diagnostic.path),
        );
        meta.append(line);
      }
      if (diagnostic.expected) {
        const line = createElement(this.doc, 'div');
        line.append(
          createElement(this.doc, 'span', undefined, '期望格式：'),
          createElement(this.doc, 'code', undefined, diagnostic.expected),
        );
        meta.append(line);
      }
      if (diagnostic.actual) {
        const line = createElement(this.doc, 'div');
        line.append(
          createElement(this.doc, 'span', undefined, '当前值：'),
          createElement(this.doc, 'code', undefined, diagnostic.actual),
        );
        meta.append(line);
      }
      nodes.push(meta);
    }

    if (diagnostic.issues.length > 1) {
      const list = createElement(this.doc, 'ul', 'genui-status-issues');
      for (const issue of diagnostic.issues.slice(1, 4)) {
        list.append(createElement(this.doc, 'li', undefined, `${issue.path}：${issue.message}`));
      }
      nodes.push(list);
    }

    if (diagnostic.repairable) {
      const actions = createElement(this.doc, 'div', 'genui-status-actions');
      const repair = createElement(this.doc, 'button', undefined, '生成修复请求');
      repair.type = 'button';
      repair.setAttribute('data-primary', '');
      repair.setAttribute('data-genui-action', 'repair');
      repair.addEventListener('click', () => {
        void this.deliver('fill');
      });
      const copy = createElement(this.doc, 'button', undefined, '复制修复请求');
      copy.type = 'button';
      copy.setAttribute('data-genui-action', 'copy-repair');
      copy.addEventListener('click', () => {
        void this.deliver('copy');
      });
      actions.append(repair, copy);
      nodes.push(actions);
    }

    // 即使不可生成修复请求，「复制原始内容」也需要一条可见反馈。
    const feedback = createElement(this.doc, 'p', 'genui-status-feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    feedback.setAttribute('data-genui-feedback', '');
    nodes.push(feedback);

    const details = createElement(this.doc, 'details', 'genui-status-raw');
    details.append(createElement(this.doc, 'summary', undefined, '查看原始内容'));
    const pre = this.doc.createElement('pre');
    pre.setAttribute('data-genui-raw', '');
    pre.textContent = raw;
    details.append(pre);
    if (!diagnostic.repairable) {
      const copyRaw = createElement(this.doc, 'button', undefined, '复制原始内容');
      copyRaw.type = 'button';
      copyRaw.addEventListener('click', () => {
        void copyText(this.doc, raw).then((copied) => {
          this.setFeedback(copied ? '原始内容已复制。' : '复制失败，请手动选择文本。');
        });
      });
      details.append(copyRaw);
    }
    nodes.push(details);

    this.card.replaceChildren(...nodes);
  }

  private setFeedback(text: string): void {
    const feedback = this.host.shadowRoot?.querySelector<HTMLElement>('[data-genui-feedback]');
    if (feedback) feedback.textContent = text;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    for (const button of this.host.shadowRoot?.querySelectorAll<HTMLButtonElement>('button') ?? []) {
      button.disabled = busy;
    }
  }

  private async deliver(mode: 'fill' | 'copy'): Promise<void> {
    if (this.busy || !this.diagnostic) return;
    this.setBusy(true);
    try {
      const prompt = buildRepairPrompt(this.diagnostic, this.raw);
      let result: RepairDeliveryResult;
      if (mode === 'copy') {
        result = (await copyText(this.doc, prompt)) ? 'copied' : 'copy-failed';
      } else if (this.options.onRequestRepair) {
        result = await this.options.onRequestRepair(prompt);
      } else {
        result = (await copyText(this.doc, prompt)) ? 'copied' : 'copy-failed';
      }
      this.setFeedback(FEEDBACK[result]);
    } catch {
      this.setFeedback('生成修复请求失败；原始内容与聊天仍可正常使用。');
    } finally {
      this.setBusy(false);
    }
  }

  destroy(): void {
    this.host.remove();
  }
}
