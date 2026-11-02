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
}

/** 读取扩展运行时 id；测试环境与上下文失效时返回占位值。 */
export function resolveRuntimeId(): string {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
    return 'runtime-unavailable';
  }
  return chrome.runtime.id;
}

/** 幂等初始化：首次调用写入标记并记录日志，重复调用直接跳过。 */
export function initContentScript(scope: ContentScope, doc: Document): InitResult {
  if (scope[LOADED_FLAG]) {
    return { alreadyLoaded: true, runtimeId: '' };
  }
  scope[LOADED_FLAG] = true;

  const runtimeId = resolveRuntimeId();
  if (!doc.documentElement) {
    throw new Error('documentElement 不存在，内容脚本初始化时机异常');
  }
  doc.documentElement.setAttribute(GENUI_ATTR, runtimeId);
  console.debug(`${LOG_PREFIX} content script loaded (${runtimeId})`);
  return { alreadyLoaded: false, runtimeId };
}
