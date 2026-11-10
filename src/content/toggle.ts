import { attachThemeAttribute } from '../render/theme';
import { getBrandMarkUrl } from '../branding';
import type { AugmentStatus } from './augment';
import type { GenuiPromptMode } from './prompt';
import { copyText } from './repair';

const CONTROL_ATTR = 'data-genui-control';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 内联折线箭头：默认画「向上」，收起态由 CSS rotate(180deg) 翻成「向下」。 */
function createChevron(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.classList.add('chevron');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const polyline = doc.createElementNS(SVG_NS, 'polyline');
  polyline.setAttribute('points', '2.5 7.5 6 4 9.5 7.5');
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', 'currentColor');
  polyline.setAttribute('stroke-width', '1.8');
  polyline.setAttribute('stroke-linecap', 'round');
  polyline.setAttribute('stroke-linejoin', 'round');
  svg.append(polyline);
  return svg;
}

export const AUGMENT_STATUS_LABELS: Record<AugmentStatus, string> = {
  ready: '静默增强已就绪：发送消息时在后台自动附加协议，不占用输入框',
  plain: '普通回答：本轮发送不会附加增强协议',
  disabled: '增强已关闭：发送消息不会附加协议',
};

/** 本轮模式在浮标上的展示标签；AUGMENT_MODE_ORDER 即循环切换顺序。 */
export const AUGMENT_MODE_LABELS: Record<GenuiPromptMode, string> = {
  auto: '自动适配',
  tool: '明确生成工具',
  plain: '普通回答',
};
const AUGMENT_MODE_ORDER: readonly GenuiPromptMode[] = ['auto', 'tool', 'plain'];

export interface ToggleControl {
  setEnabled(enabled: boolean): void;
  /** 面板中的实时草稿状态；null 表示设置仍在加载。 */
  setAugmentStatus(status: AugmentStatus | null): void;
  /** 本轮增强模式变化（用户选择或内部重置）；驱动按钮文案与面板文本。 */
  setAugmentMode(mode: GenuiPromptMode): void;
  /** plain 模式的面板说明文本；null 恢复默认短说明，非 null 为草稿残留提示。 */
  setAugmentPlainNote(note: string | null): void;
  dispose(): void;
}

/** 诊断面板内容来源：只提供脱敏摘要与完整 JSON 预览文本。 */
export interface DiagnosticsPanelSource {
  summary(): string;
  preview(): string;
}

export interface ToggleOptions {
  /** 实际参与对话的增强文本；面板逐字展示同一常量。 */
  promptText?: string;
  /** 各本轮模式的完整面板文本；auto 取 promptText，tool 为 genUI tool 变体，plain 为简短说明。 */
  promptTexts?: Partial<Record<GenuiPromptMode, string>>;
  promptVersion?: string;
  initialStatus?: AugmentStatus;
  initialMode?: GenuiPromptMode;
  /** 用户通过浮标循环按钮显式选择本轮模式。 */
  onModeSelect?: (mode: GenuiPromptMode) => void;
  /** 本地脱敏诊断来源；缺省时隐藏「本地诊断」按钮。 */
  diagnostics?: DiagnosticsPanelSource;
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
    /* 顶部状态胶囊：主开关占左段、独立箭头占右段，组成一体式双段胶囊。 */
    .toolbar-bar {
      display: flex;
      align-items: stretch;
      border-radius: 999px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, .14);
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
    /* 作者样式优先于 UA 的 [hidden]{display:none}，显式兜底避免隐藏按钮仍然显示。 */
    button[hidden] { display: none; }
    .brand-mark { display: block; width: 16px; height: 16px; flex: 0 0 auto; }
    .toolbar-bar > button { box-shadow: none; }
    .toolbar-bar > button:first-child {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
      cursor: grab;
    }
    /* 没有可显示菜单项时箭头隐藏，主开关恢复完整胶囊。 */
    .toolbar-bar[data-solo] > button:first-child { border-radius: 999px; }
    .toolbar-bar > button:first-child:active,
    .toolbar-bar > button:first-child[data-dragging] { cursor: grabbing; }
    .menu-toggle {
      margin-left: -1px;
      padding: 0 8px;
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      color: #444;
    }
    .menu-toggle .chevron {
      display: block;
      transition: transform .18s ease;
      transform: rotate(180deg);
    }
    .menu-toggle[aria-expanded="true"] .chevron { transform: rotate(0deg); }
    button:hover { background: #f4f4f4; }
    button:focus-visible { outline: 3px solid #4f8cff; outline-offset: 2px; }
    button[aria-pressed="false"] { color: #555; background: #f3f3f3; }
    /* 阶段 6：折叠工具菜单，右对齐圆角面板，行项撑满宽度。 */
    .toolbar-menu {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: max-content;
      min-width: 148px;
      max-width: calc(100vw - 24px);
      padding: 6px;
      border: 1px solid rgba(120, 120, 120, .3);
      border-radius: 12px;
      color: #202124;
      background: #fff;
      box-shadow: 0 8px 30px rgba(0, 0, 0, .18);
      text-align: left;
    }
    .toolbar-menu[hidden] { display: none; }
    .toolbar-menu button {
      display: flex;
      width: 100%;
      justify-content: flex-start;
      padding: 7px 10px;
      border: 0;
      border-radius: 8px;
      color: #202124;
      background: transparent;
      box-shadow: none;
      font-weight: 500;
      text-align: left;
    }
    .toolbar-menu button:hover { background: rgba(120, 120, 120, .16); }
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
      :host(:not([data-site-theme])) .toolbar-menu { color: #eee; background: #242424; border-color: #555; }
      :host(:not([data-site-theme])) .toolbar-menu button { color: #eee; background: transparent; }
      :host(:not([data-site-theme])) .toolbar-menu button:hover { background: #383838; }
      :host(:not([data-site-theme])) .panel { color: #eee; background: #242424; border-color: #555; }
      :host(:not([data-site-theme])) .panel p { color: #bbb; }
      :host(:not([data-site-theme])) .panel .status { color: #8ab4f8; }
      :host(:not([data-site-theme])) .panel pre { color: #eee; background: #1b1b1b; border-color: #444; }
    }
    /* 阶段 6：跟随站点亮暗主题（data-site-theme 由 attachThemeAttribute 维护）。 */
    :host([data-site-theme="dark"]) button { color: #eee; background: #282828; border-color: #555; }
    :host([data-site-theme="dark"]) button:hover { background: #383838; }
    :host([data-site-theme="dark"]) button[aria-pressed="false"] { color: #bbb; background: #202020; }
    :host([data-site-theme="dark"]) .toolbar-menu { color: #eee; background: #242424; border-color: #555; }
    :host([data-site-theme="dark"]) .toolbar-menu button { color: #eee; background: transparent; }
    :host([data-site-theme="dark"]) .toolbar-menu button:hover { background: #383838; }
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

  // 折叠菜单第 1 行：本轮模式循环按钮（无 tool 文本时隐藏）。
  const modeButton = doc.createElement('button');
  modeButton.type = 'button';
  modeButton.addEventListener('click', handleModeClick);

  // 折叠菜单第 2 行：说明面板入口。
  const infoButton = doc.createElement('button');
  infoButton.type = 'button';
  infoButton.textContent = '查看增强说明';
  infoButton.setAttribute('aria-expanded', 'false');
  infoButton.setAttribute('aria-controls', 'genui-panel');
  infoButton.hidden = !options.promptText;
  infoButton.addEventListener('click', handleInfoClick);

  // issue #9：独立诊断入口，不放进 #genui-panel，避免改变说明面板的结构约定。
  // 折叠菜单第 3 行：本地诊断入口。
  const diagnosticsButton = doc.createElement('button');
  diagnosticsButton.type = 'button';
  diagnosticsButton.textContent = '本地诊断';
  diagnosticsButton.title = '查看本机脱敏诊断；只在你主动操作时复制或下载';
  diagnosticsButton.setAttribute('aria-expanded', 'false');
  diagnosticsButton.setAttribute('aria-controls', 'genui-diagnostics');
  diagnosticsButton.hidden = !options.diagnostics;
  diagnosticsButton.addEventListener('click', handleDiagnosticsClick);

  // 折叠箭头独立于主开关：点击只控制菜单，绝不触发 GenUI 开关。
  const menuToggleButton = doc.createElement('button');
  menuToggleButton.type = 'button';
  menuToggleButton.className = 'menu-toggle';
  menuToggleButton.setAttribute('aria-expanded', 'false');
  menuToggleButton.setAttribute('aria-controls', 'genui-toolbar-menu');
  menuToggleButton.setAttribute('aria-label', '展开 GenUI 工具菜单');
  menuToggleButton.title = '展开或收起工具菜单';
  menuToggleButton.append(createChevron(doc));
  menuToggleButton.addEventListener('click', handleMenuToggleClick);

  const bar = doc.createElement('div');
  bar.className = 'toolbar-bar';
  bar.append(button, menuToggleButton);

  const toolbarMenu = doc.createElement('div');
  toolbarMenu.id = 'genui-toolbar-menu';
  toolbarMenu.className = 'toolbar-menu';
  toolbarMenu.hidden = true;
  toolbarMenu.setAttribute('role', 'group');
  toolbarMenu.setAttribute('aria-label', 'GenUI 工具菜单');
  // 行项顺序即展示顺序：本轮模式 → 查看增强说明 → 本地诊断。
  toolbarMenu.append(modeButton, infoButton, diagnosticsButton);
  toolbarMenu.addEventListener('keydown', handleMenuKeyDown);

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
  version.textContent = `v${options.promptVersion ?? '1'}`;
  heading.append(version);

  const description = doc.createElement('p');
  description.id = 'genui-panel-desc';
  description.textContent =
    '下面这段协议文本只读展示：发送消息时由扩展在后台附加到请求中，不写入、不占用你的输入框，也不会自动发送消息。';

  const behavior = doc.createElement('p');
  behavior.textContent =
    '关闭开关后，发送消息不再附加任何协议；已经发送的历史消息会由扩展在读取时自动清理，页面上的气泡与输入框始终只显示你的原文。';

  const modeHint = doc.createElement('p');
  modeHint.textContent =
    '「本轮」按钮只影响下一次发送（自动适配 / 明确生成工具 / 普通回答）；发送后会回到自动适配。普通回答不会附加任何协议。';

  const statusLine = doc.createElement('p');
  statusLine.className = 'status';
  statusLine.setAttribute('aria-live', 'polite');
  const prompt = doc.createElement('pre');
  prompt.tabIndex = 0;
  const actions = doc.createElement('div');
  actions.className = 'actions';
  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '关闭说明';
  closeButton.addEventListener('click', handleCloseClick);

  panel.append(heading, description, behavior, modeHint, statusLine, prompt, actions);
  actions.append(closeButton);

  // 诊断面板与说明面板并列，但同一时刻只打开一个；不读取聊天文本/草稿。
  const diagnosticsPanel = doc.createElement('section');
  diagnosticsPanel.id = 'genui-diagnostics';
  diagnosticsPanel.className = 'panel';
  diagnosticsPanel.hidden = true;
  diagnosticsPanel.setAttribute('role', 'dialog');
  diagnosticsPanel.setAttribute('aria-labelledby', 'genui-diagnostics-title');

  const diagHeading = doc.createElement('h2');
  diagHeading.id = 'genui-diagnostics-title';
  diagHeading.textContent = '本地诊断';
  const diagVersion = doc.createElement('span');
  diagVersion.className = 'version';
  diagVersion.textContent = 'local';
  diagHeading.append(diagVersion);

  const diagDescription = doc.createElement('p');
  diagDescription.textContent =
    '诊断完全在本机内存生成：只包含站点适配层的计数与脱敏信号，不包含聊天文本、草稿、账号或会话标识，也不会上传。只有你主动复制或下载时，内容才会离开页面。';

  const diagSummary = doc.createElement('p');
  diagSummary.className = 'status';
  diagSummary.setAttribute('aria-live', 'polite');
  diagSummary.textContent = '本地诊断：尚未读取';

  const diagPreview = doc.createElement('pre');
  diagPreview.className = 'diag-preview';
  diagPreview.tabIndex = 0;

  const diagFeedback = doc.createElement('p');
  diagFeedback.className = 'status';
  diagFeedback.setAttribute('aria-live', 'polite');

  const diagActions = doc.createElement('div');
  diagActions.className = 'actions';
  const diagRefreshButton = doc.createElement('button');
  diagRefreshButton.type = 'button';
  diagRefreshButton.textContent = '刷新';
  diagRefreshButton.addEventListener('click', handleDiagnosticsRefresh);
  const diagCopyButton = doc.createElement('button');
  diagCopyButton.type = 'button';
  diagCopyButton.textContent = '复制';
  diagCopyButton.addEventListener('click', handleDiagnosticsCopy);
  const diagDownloadButton = doc.createElement('button');
  diagDownloadButton.type = 'button';
  diagDownloadButton.textContent = '下载 JSON';
  diagDownloadButton.addEventListener('click', handleDiagnosticsDownload);
  const diagCloseButton = doc.createElement('button');
  diagCloseButton.type = 'button';
  diagCloseButton.textContent = '关闭诊断';
  diagCloseButton.addEventListener('click', handleDiagnosticsClose);
  diagActions.append(diagRefreshButton, diagCopyButton, diagDownloadButton, diagCloseButton);

  diagnosticsPanel.append(
    diagHeading,
    diagDescription,
    diagSummary,
    diagPreview,
    diagFeedback,
    diagActions,
  );

  column.append(bar, toolbarMenu);
  wrap.append(column, panel, diagnosticsPanel);
  shadow.append(style, wrap);
  (doc.documentElement ?? doc.body).append(host);
  // 阶段 6：开关视觉跟随站点亮暗主题。
  const disposeTheme = attachThemeAttribute(host, doc);

  let enabled = initialEnabled;
  let augmentStatus: AugmentStatus | null = options.initialStatus ?? null;
  let augmentMode: GenuiPromptMode = options.initialMode ?? 'auto';
  /** plain 模式的临时面板说明（残留提示）；null 表示默认短说明。 */
  let plainNote: string | null = null;
  const modeTexts: Record<GenuiPromptMode, string> = {
    auto: options.promptText ?? '',
    tool: options.promptTexts?.tool ?? '',
    plain: options.promptTexts?.plain ?? '',
  };
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

  /** 模式按钮文案与面板逐字文本跟随当前本轮模式；plain 展示残留提示或默认短说明。 */
  function renderMode(): void {
    modeButton.textContent = `本轮：${AUGMENT_MODE_LABELS[augmentMode]}`;
    modeButton.title = '切换本轮增强模式（自动适配 / 明确生成工具 / 普通回答）';
    modeButton.setAttribute('aria-label', `本轮模式：${AUGMENT_MODE_LABELS[augmentMode]}，点击切换为下一模式`);
    prompt.textContent = augmentMode === 'plain' ? plainNote ?? modeTexts.plain : modeTexts[augmentMode];
  }

  function handleModeClick(event: MouseEvent): void {
    event.stopPropagation();
    const index = AUGMENT_MODE_ORDER.indexOf(augmentMode);
    const next = AUGMENT_MODE_ORDER[(index + 1) % AUGMENT_MODE_ORDER.length];
    // 点击后先乐观渲染；实际追加行为以 augmenter 的 onModeChange 回执为准。
    augmentMode = next;
    renderMode();
    options.onModeSelect?.(next);
  }

  /** 收起工具菜单；折叠子浮层但不抢焦点（焦点归属由调用方决定）。 */
  function setToolbarMenuOpen(open: boolean): void {
    const wasOpen = !toolbarMenu.hidden;
    toolbarMenu.hidden = !open;
    menuToggleButton.setAttribute('aria-expanded', String(open));
    menuToggleButton.setAttribute(
      'aria-label',
      open ? '收起 GenUI 工具菜单' : '展开 GenUI 工具菜单',
    );
    if (open) {
      // 菜单展开后宿主变高；拖到屏幕底部的浮标要按新尺寸重新夹取，否则菜单会溢出视口。
      if (position) setPosition(position.left, position.top);
      return;
    }
    if (!wasOpen) return;
    // 收起菜单时一并收起仍在悬空的子浮层，避免「菜单已折叠但面板还开着」。
    closeInfoPanel(false);
    closeDiagnosticsPanel(false);
  }

  function handleMenuToggleClick(event: MouseEvent): void {
    event.stopPropagation();
    // hidden 的类型是 boolean | "until-found"，显式归一为「是否已展开」。
    setToolbarMenuOpen(toolbarMenu.hidden !== false);
  }

  /** 焦点在菜单内且子浮层未打开时，Escape 收起菜单并把焦点还给箭头按钮。 */
  function handleMenuKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || toolbarMenu.hidden) return;
    if (!panel.hidden || !diagnosticsPanel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    setToolbarMenuOpen(false);
    menuToggleButton.focus();
  }

  /** 没有任何可显示行项时隐藏箭头按钮，主开关恢复单段胶囊。 */
  function updateMenuAvailability(): void {
    const hasItem = !modeButton.hidden || !infoButton.hidden || !diagnosticsButton.hidden;
    menuToggleButton.hidden = !hasItem;
    bar.toggleAttribute('data-solo', !hasItem);
    if (!hasItem) setToolbarMenuOpen(false);
  }

  function closeInfoPanel(restoreFocus: boolean): void {
    if (panel.hidden) return;
    panel.hidden = true;
    infoButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) infoButton.focus();
  }

  function setPanelOpen(open: boolean): void {
    if (!options.promptText) return;
    if (!open) {
      closeInfoPanel(true);
      return;
    }
    // 同一浮标旁只保留一个面板；打开说明时收起诊断。
    closeDiagnosticsPanel(false);
    panel.hidden = false;
    infoButton.setAttribute('aria-expanded', 'true');
    // 面板显示后宿主会变宽、变高；拖动过的浮标按新尺寸重新夹取，
    // 避免说明面板连同按钮被挤出视口。
    if (position) setPosition(position.left, position.top);
    closeButton.focus();
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

  /** 诊断预览来自控制器注入的脱敏快照；不读取页面文本。 */
  function renderDiagnostics(): void {
    if (!options.diagnostics) return;
    diagSummary.textContent = options.diagnostics.summary();
    diagPreview.textContent = options.diagnostics.preview();
  }

  function closeDiagnosticsPanel(restoreFocus: boolean): void {
    if (diagnosticsPanel.hidden) return;
    diagnosticsPanel.hidden = true;
    diagnosticsButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) diagnosticsButton.focus();
  }

  function setDiagnosticsOpen(open: boolean): void {
    if (!options.diagnostics) return;
    if (open) {
      // 打开诊断前收起说明面板，避免两个浮层同时占据浮标旁空间。
      if (!panel.hidden) {
        panel.hidden = true;
        infoButton.setAttribute('aria-expanded', 'false');
      }
      renderDiagnostics();
      diagFeedback.textContent = '';
    }
    diagnosticsPanel.hidden = !open;
    diagnosticsButton.setAttribute('aria-expanded', String(open));
    if (open) {
      if (position) setPosition(position.left, position.top);
      diagCloseButton.focus();
    } else {
      diagnosticsButton.focus();
    }
  }

  function handleDiagnosticsClick(event: MouseEvent): void {
    event.stopPropagation();
    setDiagnosticsOpen(diagnosticsPanel.hidden === true);
  }

  function handleDiagnosticsClose(event: MouseEvent): void {
    event.stopPropagation();
    setDiagnosticsOpen(false);
  }

  function handleDiagnosticsRefresh(event: MouseEvent): void {
    event.stopPropagation();
    renderDiagnostics();
    diagFeedback.textContent = '已刷新（仅本机读取）';
  }

  function handleDiagnosticsCopy(event: MouseEvent): void {
    event.stopPropagation();
    void copyText(doc, diagPreview.textContent ?? '').then((ok) => {
      diagFeedback.textContent = ok ? '已复制到剪贴板' : '复制失败，请手动选择预览文本';
    });
  }

  function handleDiagnosticsDownload(event: MouseEvent): void {
    event.stopPropagation();
    const canDownload =
      typeof Blob !== 'undefined' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function';
    if (!canDownload) {
      // jsdom 等没有 Blob URL 的环境回退到复制，保证内容仍可由用户主动带走。
      diagFeedback.textContent = '当前环境不支持文件下载，请使用「复制」保存预览文本';
      return;
    }
    const url = URL.createObjectURL(
      new Blob([diagPreview.textContent ?? ''], { type: 'application/json' }),
    );
    const link = doc.createElement('a');
    link.href = url;
    link.download = 'genui-diagnostics.json';
    link.rel = 'noopener';
    (doc.body ?? doc.documentElement).append(link);
    link.click();
    link.remove();
    win?.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function handleDiagnosticsKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || diagnosticsPanel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    setDiagnosticsOpen(false);
  }

  diagnosticsPanel.addEventListener('keydown', handleDiagnosticsKeyDown);

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
  renderMode();
  renderStatus();
  // 未提供 tool 文本时没有可切换的模式集合，隐藏循环按钮，保持旧行为。
  modeButton.hidden = modeTexts.tool === '';
  updateMenuAvailability();
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
    setAugmentMode(mode) {
      if (augmentMode === mode) return;
      augmentMode = mode;
      renderMode();
    },
    setAugmentPlainNote(note) {
      if (plainNote === note) return;
      plainNote = note;
      if (augmentMode === 'plain') renderMode();
    },
    dispose() {
      button.removeEventListener('click', handleClick);
      button.removeEventListener('pointerdown', handlePointerDown);
      button.removeEventListener('pointermove', handlePointerMove);
      button.removeEventListener('pointerup', handlePointerUp);
      button.removeEventListener('pointercancel', handlePointerCancel);
      button.removeEventListener('keydown', handleKeyDown);
      infoButton.removeEventListener('click', handleInfoClick);
      modeButton.removeEventListener('click', handleModeClick);
      menuToggleButton.removeEventListener('click', handleMenuToggleClick);
      toolbarMenu.removeEventListener('keydown', handleMenuKeyDown);
      closeButton.removeEventListener('click', handleCloseClick);
      panel.removeEventListener('keydown', handlePanelKeyDown);
      diagnosticsButton.removeEventListener('click', handleDiagnosticsClick);
      diagCloseButton.removeEventListener('click', handleDiagnosticsClose);
      diagRefreshButton.removeEventListener('click', handleDiagnosticsRefresh);
      diagCopyButton.removeEventListener('click', handleDiagnosticsCopy);
      diagDownloadButton.removeEventListener('click', handleDiagnosticsDownload);
      diagnosticsPanel.removeEventListener('keydown', handleDiagnosticsKeyDown);
      win?.removeEventListener('resize', handleResize);
      clearSuppressedClick();
      disposeTheme();
      host.remove();
    },
  };
}
