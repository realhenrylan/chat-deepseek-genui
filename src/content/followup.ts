/**
 * 阶段 6：把「继续讨论」摘要或修复请求带入聊天输入框（生产接线）。
 *
 * 取证（docs/compatibility-investigation.md §3.5 / §5）：
 * - 输入框本体是 `textarea[name="search"]`，placeholder「给 DeepSeek 发送消息」；
 * - 草稿按会话保留且必须被尊重：本函数只在原草稿之后追加，绝不覆盖或清除
 *   已有草稿（包括末尾换行与空白——逐字节保留）；
 * - 发送必须由用户完成：只写值并派发 input 事件，不点击任何发送控件；
 * - fill 必须作用于 textarea 本体，且经原生 value setter 写入后手动派发
 *   bubbles input，兼容 React 受控组件（事件对象要携带 bubbles）。
 *
 * P2 修订（阶段 6 复核）：选框只认取证到的确定标记，缺少标记时宁可返回
 * no-input 也不猜测页面上的其他 textarea（可能是反馈框等无关控件）。
 */

export type FillResult = 'filled' | 'appended' | 'no-input';

export function setNativeValue(textarea: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * 选框顺序：name=search → placeholder 含「发送消息」。不确定时不猜测（null → no-input）。
 * 阶段 7 的默认增强复用同一选框，避免两套选择器对页面版本产生分歧。
 */
export function findChatInput(doc: Document): HTMLTextAreaElement | null {
  const named = doc.querySelector<HTMLTextAreaElement>('textarea[name="search"]');
  if (named) return named;
  return (
    Array.from(doc.querySelectorAll('textarea')).find((textarea) =>
      (textarea.getAttribute('placeholder') ?? '').includes('发送消息'),
    ) ?? null
  );
}

/**
 * 追加一段文本到聊天草稿：保留现有草稿逐字节不变，相同内容不重复追加。
 * 找不到确定的输入框时返回 no-input，由调用方决定复制等退路。
 */
export function appendDraftIntoInput(doc: Document, text: string): FillResult {
  const textarea = findChatInput(doc);
  if (!textarea) return 'no-input';

  const existing = textarea.value;
  // 只有真正的空串才直接填入：仅含空格/换行的草稿也是用户输入，必须逐字保留。
  if (existing.length === 0) {
    setNativeValue(textarea, text);
    return 'filled';
  }
  // 已含同一内容时不再追加（重复点击去重），也不改变原草稿。
  if (existing.includes(text)) return 'appended';
  // 原草稿逐字节保留：不裁剪末尾空白；草稿以换行结尾时直接在其后另起一行，
  // 否则补一个空行分隔，避免改变原有换行或 Markdown 结构。
  const separator = /\n$/.test(existing) ? '' : '\n\n';
  setNativeValue(textarea, existing + separator + text);
  return 'appended';
}

export function fillContinueIntoInput(doc: Document, summary: string): FillResult {
  return appendDraftIntoInput(doc, summary);
}
