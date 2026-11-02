import { attachThemeAttribute } from '../render/theme';

const CONTROL_ATTR = 'data-genui-control';

export interface ToggleControl {
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/** 创建隔离样式、键盘可操作的页面级增强开关。 */
export function createToggleControl(
  doc: Document,
  initialEnabled: boolean,
  onChange: (enabled: boolean) => void,
): ToggleControl {
  const host = doc.createElement('div');
  host.setAttribute(CONTROL_ATTR, '');
  host.setAttribute('aria-label', 'GenUI 增强设置');
  host.style.cssText =
    'position:fixed;top:50%;right:12px;z-index:2147483646;transform:translateY(-50%);font:14px/1.4 system-ui,sans-serif;';

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
    .column > button:first-child { cursor: grab; }
    .column > button:first-child:active,
    .column > button:first-child[data-dragging] { cursor: grabbing; }
    button:hover { background: #f4f4f4; }
    button:focus-visible { outline: 3px solid #4f8cff; outline-offset: 2px; }
    button[aria-pressed="false"] { color: #555; background: #f3f3f3; }
    /* 无站点主题标记（旧环境）时才回退系统偏好；有标记时跟随站点。 */
    @media (prefers-color-scheme: dark) {
      :host(:not([data-site-theme])) button { color: #eee; background: #282828; border-color: #555; }
      :host(:not([data-site-theme])) button:hover { background: #383838; }
      :host(:not([data-site-theme])) button[aria-pressed="false"] { color: #bbb; background: #202020; }
    }
    /* 阶段 6：跟随站点亮暗主题（data-site-theme 由 attachThemeAttribute 维护）。 */
    :host([data-site-theme="dark"]) button { color: #eee; background: #282828; border-color: #555; }
    :host([data-site-theme="dark"]) button:hover { background: #383838; }
    :host([data-site-theme="dark"]) button[aria-pressed="false"] { color: #bbb; background: #202020; }
  `;

  const wrap = doc.createElement('div');
  wrap.className = 'wrap';
  const column = doc.createElement('div');
  column.className = 'column';

  const button = doc.createElement('button');
  button.type = 'button';
  button.addEventListener('click', handleClick);
  button.addEventListener('pointerdown', handlePointerDown);
  button.addEventListener('pointermove', handlePointerMove);
  button.addEventListener('pointerup', handlePointerUp);
  button.addEventListener('pointercancel', handlePointerCancel);
  button.addEventListener('keydown', handleKeyDown);

  column.append(button);
  wrap.append(column);
  shadow.append(style, wrap);
  (doc.documentElement ?? doc.body).append(host);
  // 阶段 6：开关视觉跟随站点亮暗主题。
  const disposeTheme = attachThemeAttribute(host, doc);

  let enabled = initialEnabled;
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
  button.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight');
  button.setAttribute('aria-description', '可拖动移动；按住 Alt 并使用方向键移动，Shift 加方向键可快速移动。');
  win?.addEventListener('resize', handleResize);

  function render(): void {
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', `${enabled ? '关闭' : '开启'} GenUI 增强`);
    button.title = `${enabled ? '关闭' : '开启'} GenUI 增强；可拖动移动，或按住 Alt 使用方向键移动`;
    button.textContent = `GenUI ${enabled ? '已开启' : '已关闭'}`;
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
    dispose() {
      button.removeEventListener('click', handleClick);
      button.removeEventListener('pointerdown', handlePointerDown);
      button.removeEventListener('pointermove', handlePointerMove);
      button.removeEventListener('pointerup', handlePointerUp);
      button.removeEventListener('pointercancel', handlePointerCancel);
      button.removeEventListener('keydown', handleKeyDown);
      win?.removeEventListener('resize', handleResize);
      clearSuppressedClick();
      disposeTheme();
      host.remove();
    },
  };
}
