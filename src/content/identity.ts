import {
  DEEPSEEK_SITE_ADAPTER,
  UNKNOWN_SESSION_ID,
  type GenuiBlockCandidate,
  type SiteAdapter,
} from './site-adapter';
import { CARD_STATE_VERSION } from '../runtime/card-state';
import { hashString } from '../runtime/hash';

export { UNKNOWN_SESSION_ID };

/**
 * 卡片稳定身份（issue #2）。
 *
 * 不能按标题或 DOM 顺序匹配状态：会话切换、虚拟列表回收、同一标题的
 * 多张卡片都会让「第几个卡片」失去意义。因此身份由五段组成：
 * - accountId：账号作用域（站点账号标记的哈希；无法确认时为未知）；
 * - sessionId：会话路由（生产为 /a/chat/s/<id> 的 pathname）；
 * - messageKey：消息级稳定标记（虚拟列表 item key / data-message-id），
 *   缺少稳定标记时退化为消息文本指纹；
 * - duplicateIndex：同一消息内「原始文档哈希相同」的卡片序号；
 * - documentHash：原始 genui JSON 文本哈希，文档一旦被改写即更换键，
 *   旧状态不会套用到新文档。
 *
 * 安全标记：
 * - ambiguous：消息键重复/文本指纹兜底/同消息出现完全相同的文档。此时
 *   不再让这些卡片共享键，而是按 DOM 元素分配一次性键（同一元素跨扫描
 *   稳定，节点替换后即失效），从根上避免串用。
 */

export const UNKNOWN_ACCOUNT_ID = 'acct-unknown';

export interface CardIdentity {
  /** 页面内状态仓库使用的键。 */
  key: string;
  accountId: string;
  sessionId: string;
  messageKey: string;
  duplicateIndex: number;
  documentHash: string;
  /** true 表示消息/文档无法唯一区分，只能按元素隔离，不能共享状态。 */
  ambiguous: boolean;
}

export interface ComputeIdentityOptions {
  /** 测试或特殊入口注入；缺省从 document.location.pathname 推导。 */
  sessionId?: string;
  /** 测试或特殊入口注入的账号标记；缺省从页面稳定标记推导。 */
  accountId?: string;
  /** 站点适配器；缺省使用 DeepSeek 适配器（选择器只存在于适配层）。 */
  adapter?: SiteAdapter;
  document?: Document;
}

interface MessageKeyResolution {
  key: string;
  stable: boolean;
}

/** 无法共享身份时的元素键：同一元素跨扫描稳定，节点替换后自然失效。 */
const elementTokens = new WeakMap<Element, string>();
/** 一旦某元素被判为歧义，就保持元素级键，避免重复卡消失后键回退导致状态丢失。 */
const ambiguousElements = new WeakSet<Element>();
let elementTokenSeed = 0;

function elementToken(element: Element): string {
  const existing = elementTokens.get(element);
  if (existing) return existing;
  elementTokenSeed += 1;
  const token = `amb-${elementTokenSeed.toString(36)}`;
  elementTokens.set(element, token);
  return token;
}

function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 会话身份：委托适配层；非会话路由返回 UNKNOWN_SESSION_ID。 */
export function readSessionId(doc: Document, adapter: SiteAdapter = DEEPSEEK_SITE_ADAPTER): string {
  return adapter.readSessionId(doc);
}

/** 账号标记：委托适配层；缺失时返回空字符串。 */
export function readAccountId(doc: Document, adapter: SiteAdapter = DEEPSEEK_SITE_ADAPTER): string {
  return adapter.readAccountId(doc);
}

/** 保存时只写账号作用域哈希，不落原始账号 id。 */
export function accountScope(rawAccountId: string): string {
  const value = rawAccountId.trim();
  return value ? `acct-${hashString(value)}` : UNKNOWN_ACCOUNT_ID;
}

/**
 * 消息键优先级：虚拟列表 item key > data-message-id（均由适配层读取），
 * 两者都缺失时用消息文本指纹兜底。
 */
function resolveMessageKey(container: Element, adapter: SiteAdapter): MessageKeyResolution {
  const stable = adapter.readMessageKey(container);
  if (stable) return stable;

  const fingerprint = hashString(normalizeMessageText(container.textContent ?? ''));
  return { key: `fp:${fingerprint}`, stable: false };
}

function escapeKeyPart(value: string): string {
  return value.replace(/\|/g, '%7C');
}

export function createCardKey(parts: {
  accountId: string;
  sessionId: string;
  messageKey: string;
  duplicateIndex: number;
  documentHash: string;
}): string {
  return [
    'card',
    CARD_STATE_VERSION,
    escapeKeyPart(parts.accountId),
    escapeKeyPart(parts.sessionId),
    escapeKeyPart(parts.messageKey),
    parts.duplicateIndex,
    parts.documentHash,
  ].join('|');
}

function createAmbiguousKey(block: Element, documentHash: string): string {
  return ['amb', elementToken(block), documentHash].join('|');
}

/**
 * 为一次扫描中的全部候选计算身份。duplicateIndex 只统计同一消息内原始
 * 文本相同的卡片；但一旦出现重复，所有该哈希的卡片都转为元素级键，
 * 不再靠序号区分，避免前面的重复卡增删导致后面的卡片串值。
 */
export function computeCardIdentities(
  candidates: GenuiBlockCandidate[],
  options: ComputeIdentityOptions = {},
): Map<HTMLElement, CardIdentity> {
  const identities = new Map<HTMLElement, CardIdentity>();
  if (candidates.length === 0) return identities;

  const doc = options.document ?? candidates[0].block.ownerDocument;
  const adapter = options.adapter ?? DEEPSEEK_SITE_ADAPTER;
  const sessionId = options.sessionId ?? readSessionId(doc, adapter);
  const accountId = accountScope(options.accountId ?? readAccountId(doc, adapter));

  const byContainer = new Map<Element, GenuiBlockCandidate[]>();
  for (const candidate of candidates) {
    const list = byContainer.get(candidate.container) ?? [];
    list.push(candidate);
    byContainer.set(candidate.container, list);
  }

  const resolutions = new Map<Element, MessageKeyResolution>();
  const messageKeyCounts = new Map<string, number>();
  for (const container of byContainer.keys()) {
    const resolution = resolveMessageKey(container, adapter);
    resolutions.set(container, resolution);
    messageKeyCounts.set(resolution.key, (messageKeyCounts.get(resolution.key) ?? 0) + 1);
  }

  for (const [container, containerCandidates] of byContainer) {
    const resolution = resolutions.get(container);
    if (!resolution) continue;

    const hashCounts = new Map<string, number>();
    for (const candidate of containerCandidates) {
      const hash = hashString(candidate.pre?.textContent ?? '');
      hashCounts.set(hash, (hashCounts.get(hash) ?? 0) + 1);
    }

    const seen = new Map<string, number>();
    for (const candidate of containerCandidates) {
      const documentHash = hashString(candidate.pre?.textContent ?? '');
      const seenCount = seen.get(documentHash) ?? 0;
      seen.set(documentHash, seenCount + 1);

      const duplicatedDocument = (hashCounts.get(documentHash) ?? 0) > 1;
      const ambiguous =
        !resolution.stable ||
        (messageKeyCounts.get(resolution.key) ?? 0) > 1 ||
        duplicatedDocument ||
        ambiguousElements.has(candidate.block);
      if (ambiguous) ambiguousElements.add(candidate.block);

      const identity: CardIdentity = {
        key: ambiguous
          ? createAmbiguousKey(candidate.block, documentHash)
          : createCardKey({
              accountId,
              sessionId,
              messageKey: resolution.key,
              duplicateIndex: seenCount,
              documentHash,
            }),
        accountId,
        sessionId,
        messageKey: resolution.key,
        duplicateIndex: seenCount,
        documentHash,
        ambiguous,
      };
      identities.set(candidate.block, identity);
    }
  }

  return identities;
}
