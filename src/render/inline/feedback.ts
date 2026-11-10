/**
 * 内联组件的作答回流（阶段 1）：
 * - 统一 onContinue 回调的返回类型与用户可见反馈文案；
 * - 回流模板为纯文本，生产环境追加到聊天输入框，绝不自动发送。
 */

export type ContinueResult = 'filled' | 'appended' | 'no-input' | 'unavailable';

export type ContinueHandler = (summary: string) => ContinueResult;

/** 回流结果 → 按钮旁的状态文字（与卡片「继续讨论」保持一致语义）。 */
export const CONTINUE_FEEDBACK: Record<ContinueResult, string> = {
  filled: '✓ 已带入输入框',
  appended: '✓ 已带入输入框',
  'no-input': '未找到聊天输入框',
  unavailable: '未找到聊天输入框',
};

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
