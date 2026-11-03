import { attachThemeAttribute } from '../render/theme';
import { getBrandMarkUrl } from '../branding';
import type { AugmentStatus } from './augment';

const CONTROL_ATTR = 'data-genui-control';

export const AUGMENT_STATUS_LABELS: Record<AugmentStatus, string> = {
  idle: '等待输入',
  scheduled: '将在停止输入后追加',
  appended: '已追加到当前草稿',
  dismissed: '你删除了增强说明，本草稿不再自动追加',
  disabled: '增强已关闭，不会追加',
  'no-input': '未找到聊天输入框',
};

export interface ToggleControl {
  setEnabled(enabled: boolean): void;
  /** 面板中的实时草稿状态；null 表示设置仍在加载。 */
  setAugmentStatus(status: AugmentStatus | null): void;
  dispose(): void;
}

export interface ToggleOptions {
  /** 实际参与对话的增强文本；面板逐字展示同一常量。 */
  promptText?: string;
  promptVersion?: number;
  initialStatus?: AugmentStatus;
}

/** 创建隔离样式、键盘可操作的页面级增强开关与可查看的增强说明面板。 */
export function createToggleControl(
  doc: Document,
  initialEnabled: boolean,
  onChange: (enabled: boolean) => void,
  options: ToggleOptions = {},
): ToggleControl {
  const host = doc.createElement('div');
  host.setAttribute(CONTROL_ATTR, '');
  host.setAttribute('aria-label', 'GenUI 增强设置');
  host.style.cssText =
    'position:fixed;top:50%;right:12px;z-index:2147483646;transform:translateY(-50%);' +
    // 窄视口下限制宿主宽度，配合 .panel 的 min-width:0 让面板收缩，保留两侧 12px 边距。
    'max-width:calc(100vw - 24px);font:14px/1.4 system-ui,sans-serif;';

  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .wrap {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font: 14px/1.4 system-ui, sans-serif;
    }
    .column {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }
    button {
      appearance: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid rgba(120, 120, 120, .35);
      border-radius: 999px;
      padding: 8px 11px;
      color: #202124;
      background: #fff;
      box-shadow: 0 2px 10px rgba(0, 0, 0, .14);
      font: 600 12px/1.2 system-ui, sans-serif;
      cursor: pointer;
      white-space: nowrap;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .brand-mark { display: block; width: 16px; height: 16px; flex: 0 0 auto; }
    .column > button:first-child { cursor: grab; }
    .column > button:first-child:active,
    .column > button:first-child[data-dragging] { cursor: grabbing; }
    button:hover { background: #f4f4f4; }
    button:focus-visible { outline: 3px solid #4f8cff; outline-offset: 2px; }
    button[aria-pressed="false"] { color: #555; background: #f3f3f3; }
    /* 阶段 7：说明面板；order:-1 让它出现在浮标左侧，但不改变按钮的 DOM 首项。 */
    .panel {
      order: -1;
      box-sizing: border-box;
      width: min(380px, calc(100vw - 88px));
      /* 窄视口：允许 flex 收缩，宿主宽度上限为 100vw-24px，避免整块被挤出左边界。 */
      min-width: 0;
      max-height: 70vh;
      overflow: auto;
      padding: 14px;
      border: 1px solid rgba(120, 120, 120, .35);
      border-radius: 12px;
      color: #202124;
      background: #fff;
      box-shadow: 0 8px 30px rgba(0, 0, 0, .18);
      text-align: left;
      cursor: auto;
    }
    .panel[hidden] { display: none; }
    .panel h2 {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin: 0 0 8px;
      font: 600 15px/1.3 system-ui, sans-serif;
    }
    .panel .version {
      color: #666;
      font: 500 12px/1.3 system-ui, sans-serif;
    }
    .panel p {
      margin: 0 0 10px;
      color: #555;
      font: 400 12px/1.55 system-ui, sans-serif;
    }
    .panel .status { color: #1557b0; font-weight: 600; }
    .panel pre {
      box-sizing: border-box;
      max-height: 40vh;
      margin: 0 0 12px;
      padding: 10px;
      overflow: auto;
      border: 1px solid #e3e5e8;
      border-radius: 8px;
      color: #202124;
      background: #f6f7f9;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
      white-space: pre-wrap;
      word-break: break-word;
      user-select: text;
      -webkit-user-select: text;
    }
    .panel pre:focus-visible { outline: 3px solid #4f8cff; outline-offset: 2px; }
    .panel .actions { display: flex; justify-content: flex-end; }
    /* 无站点主题标记（旧环境）时才回退系统偏好；有标记时跟随站点。 */
    @media (prefers-color-scheme: dark) {
      :host(:not([data-site-theme])) button { color: #eee; background: #282828; border-color: #555; }
      :host(:not([data-site-theme])) button:hover { background: #383838; }
      :host(:not([data-site-theme])) button[aria-pressed="false"] { color: #bbb; background: #202020; }
      :host(:not([data-site-theme])) .panel { color: #eee; background: #242424; border-color: #555; }
      :host(:not([data-site-theme])) .panel p { color: #bbb; }
      :host(:not([data-site-theme])) .panel .status { color: #8ab4f8; }
      :host(:not([data-site-theme])) .panel pre { color: #eee; background: #1b1b1b; border-color: #444; }
    }
    /* 阶段 6：跟随站点亮暗主题（data-site-theme 由 attachThemeAttribute 维护）。 */
    :host([data-site-theme="dark"]) button { color: #eee; background: #282828; border-color: #555; }
    :host([data-site-theme="dark"]) button:hover { background: #383838; }
    :host([data-site-theme="dark"]) button[aria-pressed="false"] { color: #bbb; background: #202020; }
    :host([data-site-theme="dark"]) .panel { color: #eee; background: #242424; border-color: #555; }
    :host([data-site-theme="dark"]) .panel p { color: #bbb; }
    :host([data-site-theme="dark"]) .panel .status { color: #8ab4f8; }
    :host([data-site-theme="dark"]) .panel pre { color: #eee; background: #1b1b1b; border-color: #444; }
  `;

  const wrap = doc.createElement('div');
  wrap.className = 'wrap';
  const column = doc.createElement('div');
  column.className = 'column';

  const button = doc.createElement('button');
  button.type = 'button';
  const brandMarkUrl = getBrandMarkUrl();
  if (brandMarkUrl) {
    const brandMark = doc.createElement('img');
    brandMark.className = 'brand-mark';
    brandMark.src = brandMarkUrl;
    brandMark.alt = '';
    brandMark.setAttribute('aria-hidden', 'true');
    button.append(brandMark);
  }
  const buttonLabel = doc.createElement('span');
  button.append(buttonLabel);
  button.addEventListener('click', handleClick);
  button.addEventListener('pointerdown', handlePointerDown);
  button.addEventListener('pointermove', handlePointerMove);
  button.addEventListener('pointerup', handlePointerUp);
  button.addEventListener('pointercancel', handlePointerCancel);
  button.addEventListener('keydown', handleKeyDown);

  const infoButton = doc.createElement('button');
  infoButton.type = 'button';
  infoButton.textContent = '查看增强说明';
  infoButton.setAttribute('aria-expanded', 'false');
  infoButton.setAttribute('aria-controls', 'genui-panel');
  infoButton.hidden = !options.promptText;
  infoButton.addEventListener('click', handleInfoClick);

  const panel = doc.createElement('section');
  panel.id = 'genui-panel';
  panel.className = 'panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'genui-panel-title');
  panel.setAttribute('aria-describedby', 'genui-panel-desc');

  const heading = doc.createElement('h2');
  heading.id = 'genui-panel-title';
  heading.textContent = 'GenUI 增强说明';
  const version = doc.createElement('span');
  version.className = 'version';
  version.textContent = `v${options.promptVersion ?? 1}`;
  heading.append(version);

  const description = doc.createElement('p');
  description.id = 'genui-panel-desc';
  description.textContent =
    '下面这段文本会逐字追加在你输入框草稿的末尾，作为你消息的一部分发送。扩展不会自动发送消息，也不使用隐藏消息；发送前你可以在输入框里完整查看和修改它。';

  const behavior = doc.createElement('p');
  behavior.textContent =
    '关闭开关时，扩展会移除仍在草稿末尾的自动追加说明（即使你已在说明前继续输入），并保留你的原文；如果你修改过说明文本本身，则不会覆盖你的内容。手动删除说明后，本草稿不再重复追加。';

  const statusLine = doc.createElement('p');
  statusLine.className = 'status';
  statusLine.setAttribute('aria-live', 'polite');
  const prompt = doc.createElement('pre');
  prompt.tabIndex = 0;
  prompt.textContent = options.promptText ?? '';
  const actions = doc.createElement('div');
  actions.className = 'actions';
  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '关闭说明';
  closeButton.addEventListener('click', handleCloseClick);

  panel.append(heading, description, behavior, statusLine, prompt, actions);
  actions.append(closeButton);
  column.append(button, infoButton);
  wrap.append(column, panel);
  shadow.append(style, wrap);
  (doc.documentElement ?? doc.body).append(host);
  // 阶段 6：开关视觉跟随站点亮暗主题。
  const disposeTheme = attachThemeAttribute(host, doc);

  let enabled = initialEnabled;
  let augmentStatus: AugmentStatus | null = options.initialStatus ?? null;
  let dragState: {
    pointerId: number;
    startX: number;
    startY: number;
    left: number;
    top: number;
    moved: boolean;
  } | null = null;
  let position: { left: number; top: number } | null = null;
  let suppressDraggedClick = false;
  let suppressClickTimer: number | null = null;
  const win = doc.defaultView;

  function renderStatus(): void {
    statusLine.textContent =
      augmentStatus === null
        ? '状态：正在读取设置…'
        : `状态：${AUGMENT_STATUS_LABELS[augmentStatus]}`;
    statusLine.setAttribute('data-status', augmentStatus ?? 'loading');
  }

  function setPanelOpen(open: boolean): void {
    if (!options.promptText) return;
    panel.hidden = !open;
    infoButton.setAttribute('aria-expanded', String(open));
    if (open) {
      // 面板显示后宿主会变宽、变高；拖动过的浮标按新尺寸重新夹取，
      // 避免说明面板连同按钮被挤出视口。
      if (position) setPosition(position.left, position.top);
      closeButton.focus();
    } else {
      infoButton.focus();
    }
  }

  function handleInfoClick(event: MouseEvent): void {
    event.stopPropagation();
    setPanelOpen(panel.hasAttribute('hidden'));
  }

  function handleCloseClick(event: MouseEvent): void {
    event.stopPropagation();
    setPanelOpen(false);
  }

  function handlePanelKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || panel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    setPanelOpen(false);
  }

  panel.addEventListener('keydown', handlePanelKeyDown);

  function clampPosition(left: number, top: number): { left: number; top: number } {
    const rect = host.getBoundingClientRect();
    const viewportWidth = win?.innerWidth ?? doc.documentElement.clientWidth;
    const viewportHeight = win?.innerHeight ?? doc.documentElement.clientHeight;
    return {
      left: Math.max(0, Math.min(left, viewportWidth - rect.width)),
      top: Math.max(0, Math.min(top, viewportHeight - rect.height)),
    };
  }

  function setPosition(left: number, top: number): void {
    position = clampPosition(left, top);
    host.style.left = `${position.left}px`;
    host.style.top = `${position.top}px`;
    host.style.right = 'auto';
    host.style.transform = 'none';
  }

  function getPosition(): { left: number; top: number } {
    if (position) return position;
    const rect = host.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }

  function clearSuppressedClick(): void {
    if (suppressClickTimer !== null) {
      win?.clearTimeout(suppressClickTimer);
      suppressClickTimer = null;
    }
    suppressDraggedClick = false;
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0) return;
    const current = getPosition();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: current.left,
      top: current.top,
      moved: false,
    };
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in some embedded/test DOMs.
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(deltaX, deltaY) < 4) return;

    dragState.moved = true;
    button.setAttribute('data-dragging', '');
    event.preventDefault();
    setPosition(dragState.left + deltaX, dragState.top + deltaY);
  }

  function finishDrag(event: PointerEvent): void {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (dragState.moved) {
      suppressDraggedClick = true;
      if (win) {
        suppressClickTimer = win.setTimeout(clearSuppressedClick, 0);
      }
    }
    dragState = null;
    button.removeAttribute('data-dragging');
  }

  function handlePointerUp(event: PointerEvent): void {
    finishDrag(event);
  }

  function handlePointerCancel(event: PointerEvent): void {
    finishDrag(event);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (!event.altKey) return;
    const offsets: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const offset = offsets[event.key];
    if (!offset) return;

    event.preventDefault();
    event.stopPropagation();
    const current = getPosition();
    const step = event.shiftKey ? 24 : 8;
    setPosition(current.left + offset[0] * step, current.top + offset[1] * step);
  }

  function handleResize(): void {
    if (position) setPosition(position.left, position.top);
  }

  render();
  renderStatus();
  button.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight');
  button.setAttribute('aria-description', '可拖动移动；按住 Alt 并使用方向键移动，Shift 加方向键可快速移动。');
  win?.addEventListener('resize', handleResize);

  function render(): void {
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', `${enabled ? '关闭' : '开启'} GenUI 增强`);
    button.title = `${enabled ? '关闭' : '开启'} GenUI 增强；可拖动移动，或按住 Alt 使用方向键移动`;
    buttonLabel.textContent = `GenUI ${enabled ? '已开启' : '已关闭'}`;
  }

  function handleClick(event: MouseEvent): void {
    event.stopPropagation();
    if (suppressDraggedClick && event.detail > 0) {
      event.preventDefault();
      clearSuppressedClick();
      return;
    }
    enabled = !enabled;
    render();
    onChange(enabled);
  }

  return {
    setEnabled(nextEnabled) {
      if (enabled === nextEnabled) return;
      enabled = nextEnabled;
      render();
    },
    setAugmentStatus(nextStatus) {
      augmentStatus = nextStatus;
      renderStatus();
    },
    dispose() {
      button.removeEventListener('click', handleClick);
      button.removeEventListener('pointerdown', handlePointerDown);
      button.removeEventListener('pointermove', handlePointerMove);
      button.removeEventListener('pointerup', handlePointerUp);
      button.removeEventListener('pointercancel', handlePointerCancel);
      button.removeEventListener('keydown', handleKeyDown);
      infoButton.removeEventListener('click', handleInfoClick);
      closeButton.removeEventListener('click', handleCloseClick);
      panel.removeEventListener('keydown', handlePanelKeyDown);
      win?.removeEventListener('resize', handleResize);
      clearSuppressedClick();
      disposeTheme();
      host.remove();
    },
  };
}
