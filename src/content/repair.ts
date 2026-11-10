import {
  clearPendingRepairPrompt,
  readSessionIdFromPathname,
  writePendingRepairPrompt,
} from './bridge.ts';
import { appendDraftIntoInput } from './followup';
import { SHORT_REPAIR_TRIGGER_TEXT } from './prompt.ts';
import { DEEPSEEK_SITE_ADAPTER, type SiteAdapter } from './site-adapter';

/**
 * 修复请求投递：输入框里只出现一句短触发文本，完整诊断详情暂存到桥状态，
 * 由 MAIN world 拦截器在真正发送时静默合并——用户看到的草稿始终干净。
 *
 * 找不到输入框时才退回剪贴板，并且复制的是完整修复请求，便于手动粘贴。
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

/** 把修复请求写入草稿（短文本）与桥状态（完整详情）；没有输入框时退回复制完整请求。 */
export async function deliverRepairRequest(
  doc: Document,
  prompt: string,
  adapter: SiteAdapter = DEEPSEEK_SITE_ADAPTER,
): Promise<RepairDeliveryResult> {
  const root = doc.documentElement;
  const fullPrompt = prompt.trim() === '' ? SHORT_REPAIR_TRIGGER_TEXT : prompt;
  const sessionId = readSessionIdFromPathname(doc.location?.pathname);

  if (fullPrompt === SHORT_REPAIR_TRIGGER_TEXT) {
    // 调用方本来就只给了短文本：没有详情可暂存。
    clearPendingRepairPrompt(root);
  } else {
    // 暂存与会话绑定：切换到其他会话后发送同样的短提示，不会附带这里的旧详情。
    writePendingRepairPrompt(root, fullPrompt, sessionId);
  }

  const result = appendDraftIntoInput(doc, SHORT_REPAIR_TRIGGER_TEXT, adapter);
  if (result === 'no-input') {
    clearPendingRepairPrompt(root);
    return (await copyText(doc, fullPrompt)) ? 'copied' : 'copy-failed';
  }
  return result;
}
