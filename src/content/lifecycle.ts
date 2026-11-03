/**
 * 内容脚本幂等标记（初始化阶段）。
 *
 * 职责：
 * - 保证脚本在同一只隔离世界（isolated world）内只初始化一次；
 * - 在 documentElement 写入非视觉标记，供注入状态检查与端到端测试断言；
 * - 记录 chrome.runtime.id，用于确认扩展上下文有效。
 *
 * 页面观察、增强开关和卡片资源的清理由 controller.ts 管理。
 */

export const GENUI_ATTR = 'data-genui-ext-loaded';
/** 内容脚本版本标记；真实页面对账用（旧版本脚本不会写这个属性）。 */
export const GENUI_VERSION_ATTR = 'data-genui-version';
export const LOG_PREFIX = '[dsgenui]';

const LOADED_FLAG = '__dsgenuiContentScriptLoaded__';

export interface ContentScope {
  [LOADED_FLAG]?: boolean;
}

export interface InitResult {
  /** true 表示本次调用被跳过（此前已初始化）。 */
  alreadyLoaded: boolean;
  /** chrome.runtime.id；扩展上下文不可用时为 'runtime-unavailable'。 */
  runtimeId: string;
  /** 构建注入的扩展版本（vite define）；无构建环境时为 '0.0.0-dev'。 */
  version: string;
}

/** 读取扩展运行时 id；测试环境与上下文失效时返回占位值。 */
export function resolveRuntimeId(): string {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
    return 'runtime-unavailable';
  }
  return chrome.runtime.id;
}

/**
 * 读取构建注入的内容脚本版本。
 * 构建产物中 vite define 会把 __DSGENUI_VERSION__ 替换为字符串字面量；
 * 测试等无 define 环境回退到占位值，避免运行时引用错误。
 */
export function resolveContentVersion(): string {
  return typeof __DSGENUI_VERSION__ !== 'undefined' ? __DSGENUI_VERSION__ : '0.0.0-dev';
}

/** 幂等初始化：首次调用写入标记并记录日志，重复调用直接跳过。 */
export function initContentScript(scope: ContentScope, doc: Document): InitResult {
  if (scope[LOADED_FLAG]) {
    return { alreadyLoaded: true, runtimeId: '', version: resolveContentVersion() };
  }
  scope[LOADED_FLAG] = true;

  const runtimeId = resolveRuntimeId();
  const version = resolveContentVersion();
  if (!doc.documentElement) {
    throw new Error('documentElement 不存在，内容脚本初始化时机异常');
  }
  doc.documentElement.setAttribute(GENUI_ATTR, runtimeId);
  doc.documentElement.setAttribute(GENUI_VERSION_ATTR, version);
  console.debug(`${LOG_PREFIX} content script loaded (${runtimeId}, v${version})`);
  return { alreadyLoaded: false, runtimeId, version };
}
