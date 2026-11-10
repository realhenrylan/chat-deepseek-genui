import type { GenuiPromptMode } from './prompt.ts';

/**
 * content script（隔离世界）与 MAIN world 拦截器之间的状态契约。
 *
 * 双方只通过 `document.documentElement` 上的属性与 DOM 事件通信，
 * 因此这里只放纯字符串常量和无副作用的读写函数。
 *
 * 修复暂存与会话绑定：暂存只在写入时的会话内有效；导航到其他会话后拦截器不会合并，
 * 控制器也会在导航时主动清理。每次写入带一次性 id，只有真正消费该暂存的请求才能清除它。
 *
 * 这里不保存任何聊天正文或消息索引：历史与 DOM 清洗只按内容特征即时判断
 * （完整协议文本或带校验码的修复详情块）。
 */

export const BRIDGE_ENABLED_ATTR = 'data-genui-enabled';
export const BRIDGE_MODE_ATTR = 'data-genui-mode';
/** 模式版本号：每次模式变化 +1，用于忽略旧请求返回时的迟到事件。 */
export const BRIDGE_MODE_REV_ATTR = 'data-genui-mode-rev';
export const BRIDGE_PENDING_REPAIR_ATTR = 'data-genui-pending-repair';

/** 请求已发出（携带本次是否合并了协议/修复详情）。 */
export const REQUEST_SENT_EVENT = 'genui:request-sent';
/** 请求成功返回（response.ok），此时才允许消费对应的修复暂存。 */
export const REQUEST_DELIVERED_EVENT = 'genui:request-delivered';

const SESSION_ROUTE = /^\/a\/chat\/s\/([^/]+)\/?$/;

export interface PendingRepairState {
  /** 一次性标识：只清除被本次请求真正消费的那份暂存。 */
  id: string;
  prompt: string;
  /** 写入时的会话 id；null 表示非会话路由（首页/新对话）。 */
  sessionId: string | null;
  createdAt?: number;
}

export interface RequestSentDetail {
  mode: GenuiPromptMode;
  modeRevision: number;
  injected: boolean;
  repairStashId: string | null;
}

export interface RequestDeliveredDetail {
  repairStashId: string | null;
}

/** 从站内路径解析会话 id；非会话路由返回 null。 */
export function readSessionIdFromPathname(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const match = SESSION_ROUTE.exec(pathname.trim());
  return match?.[1] ?? null;
}

/** 优先使用历史/发送请求里的 `chat_session_id`，退回页面路径。 */
export function readSessionIdFromLocation(
  location: Pick<Location, 'search' | 'pathname'> | null | undefined,
): string | null {
  if (!location) return null;
  try {
    const fromQuery = new URLSearchParams(location.search).get('chat_session_id');
    if (fromQuery && fromQuery.trim() !== '') return fromQuery.trim();
  } catch {
    // search 不可解析时退回路径。
  }
  return readSessionIdFromPathname(location.pathname);
}

export function readBridgeEnabled(root: Element | null): boolean {
  return root?.getAttribute(BRIDGE_ENABLED_ATTR) === 'true';
}

export function readBridgeMode(root: Element | null): GenuiPromptMode {
  const raw = root?.getAttribute(BRIDGE_MODE_ATTR);
  if (raw === 'tool') return 'tool';
  if (raw === 'plain') return 'plain';
  return 'auto';
}

export function readBridgeModeRevision(root: Element | null): number {
  const raw = root?.getAttribute(BRIDGE_MODE_REV_ATTR);
  if (!raw) return 0;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function syncBridgeState(
  root: Element | null,
  enabled: boolean,
  mode: GenuiPromptMode,
  modeRevision = 0,
): void {
  if (!root) return;
  root.setAttribute(BRIDGE_ENABLED_ATTR, enabled ? 'true' : 'false');
  root.setAttribute(BRIDGE_MODE_ATTR, mode);
  root.setAttribute(BRIDGE_MODE_REV_ATTR, String(modeRevision));
}

export function readPendingRepairState(root: Element | null): PendingRepairState | null {
  const raw = root?.getAttribute(BRIDGE_PENDING_REPAIR_ATTR);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Partial<PendingRepairState>;
    if (typeof record.prompt !== 'string' || record.prompt.trim() === '') return null;
    if (typeof record.id !== 'string' || record.id === '') return null;
    return {
      id: record.id,
      prompt: record.prompt,
      sessionId: typeof record.sessionId === 'string' ? record.sessionId : null,
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : undefined,
    };
  } catch {
    return null;
  }
}

/** 兼容旧调用点：只取暂存的修复详情文本。 */
export function readPendingRepairPrompt(root: Element | null): string | null {
  return readPendingRepairState(root)?.prompt ?? null;
}

let repairSequence = 0;

function createRepairStashId(): string {
  repairSequence += 1;
  return `${Date.now().toString(36)}-${repairSequence.toString(36)}`;
}

/** 写入修复暂存；返回本次的一次性状态，便于调用方记录 id。 */
export function writePendingRepairPrompt(
  root: Element | null,
  prompt: string,
  sessionId: string | null = null,
): PendingRepairState | null {
  if (!root) return null;
  const state: PendingRepairState = {
    id: createRepairStashId(),
    prompt,
    sessionId,
    createdAt: Date.now(),
  };
  root.setAttribute(BRIDGE_PENDING_REPAIR_ATTR, JSON.stringify(state));
  return state;
}

export function clearPendingRepairPrompt(root: Element | null): void {
  root?.removeAttribute(BRIDGE_PENDING_REPAIR_ATTR);
}

/** 仅当当前暂存就是指定 id 时清除，避免迟到事件删除用户新点的修复详情。 */
export function clearPendingRepairIfMatches(root: Element | null, id: string | null): void {
  if (!id) return;
  if (readPendingRepairState(root)?.id !== id) return;
  clearPendingRepairPrompt(root);
}
