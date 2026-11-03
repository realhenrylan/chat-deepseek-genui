import { appendDraftIntoInput } from './followup';

/**
 * 修复请求投递：优先写入已有聊天输入框，找不到输入框时复制到剪贴板。
 *
 * 始终由用户检查并发送；此处不点击发送控件，也不读取会话内容。
 */
export type RepairDeliveryResult = 'filled' | 'appended' | 'copied' | 'copy-failed';

export async function copyText(doc: Document, text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒绝时走 execCommand 兜底。
  }
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  area.style.top = '0';
  doc.body.append(area);
  area.select();
  let copied: boolean;
  try {
    copied = doc.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

/** 把修复请求追加到聊天草稿；没有输入框时退回复制，不自动发送。 */
export async function deliverRepairRequest(
  doc: Document,
  prompt: string,
): Promise<RepairDeliveryResult> {
  const result = appendDraftIntoInput(doc, prompt);
  if (result === 'no-input') {
    return (await copyText(doc, prompt)) ? 'copied' : 'copy-failed';
  }
  return result;
}
