/**
 * 内联组件的作答回流：
 * - 统一 onContinue 与 onRequestSend 回调的类型与用户可见反馈文案；
 * - 保持纯类型与纯文案构造，不依赖页面或存储 API。
 */

export type ContinueResult = 'filled' | 'appended' | 'no-input' | 'unavailable';

export type ContinueHandler = (summary: string) => ContinueResult;

export type FollowupDeliveryMode = 'send' | 'fill';

export type RequestSendFallbackReason =
  | 'missing-send-button'
  | 'send-button-disabled'
  | 'send-timeout';

export type RequestSendStatus =
  | 'sent'
  | 'first-time-notice'
  | 'filled'
  | 'appended'
  | 'draft-protected'
  | 'fallback-filled'
  | 'busy'
  | 'untrusted'
  | 'debounced'
  | 'no-input'
  | 'unavailable';

export interface RequestSendResult {
  status: RequestSendStatus;
  reason?: RequestSendFallbackReason;
}

export interface RequestSendMeta {
  isTrusted: boolean;
}

export type RequestSendHandler = (
  message: string,
  meta: RequestSendMeta,
) => Promise<RequestSendResult>;

export interface FollowupEnvironmentState {
  generationActive: boolean;
  hasDraft: boolean;
  followupMode: FollowupDeliveryMode;
}

export interface FollowupEnvironmentStore {
  getSnapshot(): FollowupEnvironmentState;
  subscribe(listener: () => void): () => void;
}

/** 回流结果 → 按钮旁的状态文字（与卡片「继续讨论」保持一致语义）。 */
export const CONTINUE_FEEDBACK: Record<ContinueResult, string> = {
  filled: '✓ 已带入输入框',
  appended: '✓ 已带入输入框',
  'no-input': '未找到聊天输入框',
  unavailable: '未找到聊天输入框',
};

const FALLBACK_REASON_FEEDBACK: Record<RequestSendFallbackReason, string> = {
  'missing-send-button': '未找到发送按钮，已填入输入框，请手动发送',
  'send-button-disabled': '发送按钮当前不可用，已填入输入框，请手动发送',
  'send-timeout': '未检测到发送请求，已填入输入框，请手动发送',
};

const REQUEST_SEND_FEEDBACK: Record<Exclude<RequestSendStatus, 'fallback-filled'>, string> = {
  sent: '✓ 已发送',
  'first-time-notice':
    '首次提示：点击此类按钮会直接发送消息；再次点击即可发送（可在右上角 GenUI 菜单切换为仅填入输入框）',
  filled: '✓ 已填入输入框，请手动发送',
  appended: '✓ 已追加到输入框，请手动发送',
  'draft-protected': '检测到输入框已有草稿，已追加到末尾而不直接发送',
  busy: '等待当前回答结束',
  untrusted: '请通过主动点击按钮触发发送',
  debounced: '操作过快，请稍后再试',
  'no-input': '未找到聊天输入框',
  unavailable: '当前无法发送',
};

/** 根据回流发送结果返回就近展示的 `role="status"` 提示文本。 */
export function formatRequestSendFeedback(result: RequestSendResult): string {
  if (result.status === 'fallback-filled') {
    return result.reason
      ? FALLBACK_REASON_FEEDBACK[result.reason]
      : '已填入输入框，请手动发送';
  }
  return REQUEST_SEND_FEEDBACK[result.status];
}

/** 各自列表内部从 1 开始编号，项间用「、」连接。 */
function numberedList(items: readonly string[]): string {
  return items.map((text, idx) => `${idx + 1}. ${text}`).join('、');
}

/** 清单进度回流模板：未完成项优先用于下一步规划，全部完成时转向下一阶段。 */
export function buildChecklistContinue(
  done: readonly string[],
  todo: readonly string[],
): string {
  const total = done.length + todo.length;
  const lines = ['【任务跟进】', `已完成（${done.length}/${total}）：${numberedList(done)}`];
  if (todo.length > 0) {
    lines.push(`待完成（${todo.length}/${total}）：${numberedList(todo)}`);
    lines.push('请帮我针对以上未完成的步骤，制定详细的执行步骤与注意事项。');
  } else {
    lines.push('以上任务已全部完成，请帮我规划下一阶段的推进重点与验收事项。');
  }
  return lines.join('\n');
}

/** 对比方案选定回流模板。 */
export function buildCompareContinue(name: string): string {
  return [
    '【方案选型确认】',
    `在对比方案中，我决定采用【${name}】。请帮我细化该方案的落地架构图与第一阶段实施计划。`,
  ].join('\n');
}
