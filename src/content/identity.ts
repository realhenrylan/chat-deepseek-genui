import type { GenuiBlockCandidate } from './detect';
import { CARD_STATE_VERSION } from '../runtime/card-state';
import { hashString } from '../runtime/hash';

/**
 * 卡片稳定身份（issue #2）。
 *
 * 不能按标题或 DOM 顺序匹配状态：会话切换、虚拟列表回收、同一标题的
 * 多张卡片都会让「第几个卡片」失去意义。因此身份由四段组成：
 * - sessionId：会话路由（生产为 /a/chat/s/<id> 的 pathname）；
 * - messageKey：消息级稳定标记（虚拟列表 item key / data-message-id），
 *   缺少稳定标记时退化为消息文本指纹；
 * - duplicateIndex：同一消息内「原始文档哈希相同」的卡片序号；
 * - documentHash：原始 genui JSON 文本哈希，文档一旦被改写即更换键，
 *   旧状态不会套用到新文档。
 *
 * 任一段不可靠（未知会话、文本指纹重复、无稳定消息标记）时标记
 * ambiguous；内存恢复仍可用，但禁止写入本机保存，避免串用。
 */

export const UNKNOWN_SESSION_ID = 'unknown-session';
const VIRTUAL_ITEM_ATTR = 'data-virtual-list-item-key';
const MESSAGE_ID_ATTR = 'data-message-id';

export interface CardIdentity {
  /** 页面内状态仓库与保存记录使用的键。 */
  key: string;
  sessionId: string;
  messageKey: string;
  duplicateIndex: number;
  documentHash: string;
  /** true 表示会话/消息身份不可靠，只做页面内恢复、不写本机保存。 */
  ambiguous: boolean;
}

export interface ComputeIdentityOptions {
  /** 测试或特殊入口注入；缺省从 document.location.pathname 推导。 */
  sessionId?: string;
  document?: Document;
}

interface MessageKeyResolution {
  key: string;
  stable: boolean;
}

function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function readAttribute(element: Element | null, name: string): string {
  return element?.getAttribute(name)?.trim() ?? '';
}

/** 会话身份：生产页面的 /a/chat/s/<id>；无法确定时使用保守占位符。 */
export function readSessionId(doc: Document): string {
  const pathname = doc.location?.pathname?.trim() ?? '';
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || UNKNOWN_SESSION_ID;
}

/**
 * 消息键优先级：虚拟列表 item key > data-message-id > 消息文本指纹。
 * 前两者由站点提供，跨重渲染/刷新稳定；指纹只用于页面内节点替换兜底。
 */
function resolveMessageKey(container: Element): MessageKeyResolution {
  const virtualKey = readAttribute(container.closest(`[${VIRTUAL_ITEM_ATTR}]`), VIRTUAL_ITEM_ATTR);
  if (virtualKey) return { key: `vl:${virtualKey}`, stable: true };

  const messageId = readAttribute(container.closest(`[${MESSAGE_ID_ATTR}]`), MESSAGE_ID_ATTR);
  if (messageId) return { key: `mid:${messageId}`, stable: true };

  const fingerprint = hashString(normalizeMessageText(container.textContent ?? ''));
  return { key: `fp:${fingerprint}`, stable: false };
}

function escapeKeyPart(value: string): string {
  return value.replace(/\|/g, '%7C');
}

export function createCardKey(parts: {
  sessionId: string;
  messageKey: string;
  duplicateIndex: number;
  documentHash: string;
}): string {
  return [
    'card',
    CARD_STATE_VERSION,
    escapeKeyPart(parts.sessionId),
    escapeKeyPart(parts.messageKey),
    parts.duplicateIndex,
    parts.documentHash,
  ].join('|');
}

/**
 * 为一次扫描中的全部候选计算身份。duplicateIndex 只统计同一消息内原始
 * 文本相同的卡片，避免前面其他 genui 块增删导致序号整体漂移。
 */
export function computeCardIdentities(
  candidates: GenuiBlockCandidate[],
  options: ComputeIdentityOptions = {},
): Map<HTMLElement, CardIdentity> {
  const identities = new Map<HTMLElement, CardIdentity>();
  if (candidates.length === 0) return identities;

  const doc = options.document ?? candidates[0].block.ownerDocument;
  const sessionId = options.sessionId ?? readSessionId(doc);

  const byContainer = new Map<Element, GenuiBlockCandidate[]>();
  for (const candidate of candidates) {
    const list = byContainer.get(candidate.container) ?? [];
    list.push(candidate);
    byContainer.set(candidate.container, list);
  }

  const resolutions = new Map<Element, MessageKeyResolution>();
  const messageKeyCounts = new Map<string, number>();
  for (const container of byContainer.keys()) {
    const resolution = resolveMessageKey(container);
    resolutions.set(container, resolution);
    messageKeyCounts.set(resolution.key, (messageKeyCounts.get(resolution.key) ?? 0) + 1);
  }

  for (const [container, containerCandidates] of byContainer) {
    const resolution = resolutions.get(container);
    if (!resolution) continue;
    const hashCounts = new Map<string, number>();

    for (const candidate of containerCandidates) {
      const documentHash = hashString(candidate.pre?.textContent ?? '');
      const duplicateIndex = hashCounts.get(documentHash) ?? 0;
      hashCounts.set(documentHash, duplicateIndex + 1);

      const ambiguous =
        sessionId === UNKNOWN_SESSION_ID ||
        !resolution.stable ||
        (messageKeyCounts.get(resolution.key) ?? 0) > 1;

      identities.set(candidate.block, {
        key: createCardKey({
          sessionId,
          messageKey: resolution.key,
          duplicateIndex,
          documentHash,
        }),
        sessionId,
        messageKey: resolution.key,
        duplicateIndex,
        documentHash,
        ambiguous,
      });
    }
  }

  return identities;
}
