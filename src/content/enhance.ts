import { LOG_PREFIX } from './lifecycle';
import { findGenuiBlocks, type GenuiBlockCandidate } from './detect';
import { computeCardIdentities, readSessionId, type CardIdentity } from './identity';
import { parseGenui } from '../protocol/validate';
import type { GenuiDocument, GenuiFailureCode } from '../protocol/types';
import {
  CARD_STATE_VERSION,
  createCardUiState,
  documentStateSignature,
  isCompatibleSavedPlan,
  restoreCardUiState,
  sanitizeCardValues,
  sanitizeTableViews,
  type CardUiState,
  type PlanClearResult,
  type PlanSaveResult,
  type SavedCardPlan,
} from '../runtime/card-state';
import { createCardStateStore, type CardStateStore } from '../runtime/card-state-store';
import { mountCard, type MountedCard } from '../render/mount';
import type { ElementRegistry } from '../render/registry';
import type { PlanStore } from './plan-store';

/**
 * 识别 → 解析 → 挂载的单块链路，以及供页面生命周期控制器使用的可清理管理器。
 *
 * - 成功后隐藏但保留原始代码块；查看原始 JSON 时仅显示原块，卡片仍保留开关。
 * - 内容变化、块被移除、标签改变或总开关关闭时卸载 React 根并恢复原块。
 * - 失败不改写代码块，保存失败签名以避免每次 MutationObserver 通知都重复解析。
 */

/** 块处理状态：mounted=已挂载卡片；failed=已判定失败并保留原样。 */
export const STATE_ATTR = 'data-genui-state';
/** 失败原因：协议失败码或链路级原因。 */
export const REASON_ATTR = 'data-genui-reason';
/** 卡片 host 的 light-DOM 标记（host 本体位于原始块之前）。 */
export const HOST_CLASS = 'genui-card-host';

/** 失败原因 = 协议失败码 ∪ 链路级原因。 */
export type EnhanceFailureReason = GenuiFailureCode | 'missing-pre' | 'mount-failed' | 'render-error';

export interface EnhanceOptions {
  /** 元素注册表覆盖（测试与后续阶段扩展用）。 */
  registry?: ElementRegistry;
  /**
   * 「继续讨论」回调（阶段 6）：卡片用户主动点击时以纯文本摘要调用。
   * 生产接线 content/followup.fillContinueIntoInput（追加不覆盖、不发送）。
   */
  onContinue?: (summary: string) => 'filled' | 'appended' | 'no-input' | 'unavailable';
  /**
   * 返回 true 表示该候选块此刻不可作为判定依据（典型：站点对视口外代码块
   * 延迟渲染，DOM 中只有短前缀）。对这类块不写 failed 状态、不记失败签名，
   * 等可验证后的重新扫描再判定；生产接线 content/viewport-gate。
   */
  isBlockUnverifiable?: (block: HTMLElement) => boolean;
  /** 当前会话 id；生产由控制器注入，缺省从 document.location 推导。 */
  sessionId?: string;
  /** 账号标记覆盖（测试注入）；缺省读取页面稳定标记，缺失时禁止本机保存。 */
  accountId?: string;
  /** 本机「保存方案」存储；null/缺省表示不提供持久化入口。 */
  planStore?: PlanStore | null;
  /** 页面内状态仓库覆盖（测试注入）；缺省新建且有上限。 */
  stateStore?: CardStateStore;
  /** 测试直接注入已加载的保存方案；与 planStore 结果合并时以此为准。 */
  savedPlans?: Record<string, SavedCardPlan>;
  /** 保存时间源（测试可控）。 */
  now?: () => number;
}

export interface EnhanceResult {
  /** 成功挂载的卡片数。 */
  mounted: number;
  /** 因幂等跳过的块数（已处理过）。 */
  skipped: number;
  /** 判定失败、原样保留的块数。 */
  failed: number;
}

interface FailedRecord {
  signature: string;
  reason: EnhanceFailureReason;
}

interface MountedRecord {
  block: HTMLElement;
  host: HTMLElement;
  raw: string;
  signature: string;
  originalDisplay: string;
  mountedCard: MountedCard;
  /** 稳定卡片身份键；节点被改写时据此丢弃旧文档的页面内状态。 */
  key: string;
}

function markFailed(block: Element, reason: EnhanceFailureReason): void {
  block.setAttribute(STATE_ATTR, 'failed');
  block.setAttribute(REASON_ATTR, reason);
}

function candidateSignature(candidate: GenuiBlockCandidate): string {
  return `${candidate.pre ? 'pre' : 'no-pre'}\u0000${candidate.pre?.textContent ?? ''}`;
}

function removeState(block: Element): void {
  block.removeAttribute(STATE_ATTR);
  block.removeAttribute(REASON_ATTR);
}

/** React 根必须在 host 被移除前卸载；原始块即使已断开也恢复，供页面复用节点。 */
function disposeMounted(record: MountedRecord, clearState: boolean): void {
  record.mountedCard.unmount();
  record.host.remove();
  record.block.style.display = record.originalDisplay;
  if (clearState) removeState(record.block);
}

export class EnhancementManager {
  private readonly mounted = new Map<HTMLElement, MountedRecord>();
  private readonly failed = new Map<HTMLElement, FailedRecord>();
  private enabled = true;
  private readonly stateStore: CardStateStore;
  private readonly now: () => number;
  /** 已加载到内存的保存方案；键与卡片身份一致。 */
  private savedPlans: Record<string, SavedCardPlan>;
  private plansLoaded = false;

  constructor(
    private readonly doc: Document,
    private readonly options: EnhanceOptions = {},
  ) {
    this.stateStore = options.stateStore ?? createCardStateStore();
    this.savedPlans = options.savedPlans ? { ...options.savedPlans } : {};
    this.now = options.now ?? Date.now;
  }

  /**
   * 预载本机保存方案。控制器在首次扫描前等待，保证恢复先于挂载；
   * 存储不可用或读取失败时只记录日志，页面内恢复仍然有效。
   */
  async loadSavedPlans(): Promise<void> {
    if (this.plansLoaded) return;
    this.plansLoaded = true;
    const store = this.options.planStore;
    if (!store) return;
    try {
      const saved = await store.loadAll();
      // 测试注入的记录优先，避免异步读取覆盖预期夹具。
      this.savedPlans = { ...saved, ...this.savedPlans };
    } catch (error) {
      console.warn(`${LOG_PREFIX} failed to load saved plans`, error);
    }
  }

  /**
   * 对当前 DOM 做一次协调。allowMount=false 只清理已失效/已变化的挂载，
   * 不解析或标记新块；生命周期控制器用它等待生成结束与内容稳定。
   */
  reconcile(allowMount = true): EnhanceResult {
    const result: EnhanceResult = { mounted: 0, skipped: 0, failed: 0 };
    const candidates = findGenuiBlocks(this.doc);
    const byBlock = new Map(candidates.map((candidate) => [candidate.block, candidate]));

    for (const [block, record] of this.mounted) {
      const candidate = byBlock.get(block);
      const removed = !candidate;
      // 只有「仍在页面上、但原始文本被改写」才丢弃旧状态；节点被移除或
      // 虚拟列表回收时保留，同一身份重新挂载仍可恢复。
      const changedText =
        candidate !== undefined && candidateSignature(candidate) !== record.signature;
      const hostLost = !record.host.isConnected;
      if (!block.isConnected || removed || changedText || hostLost) {
        if (changedText) this.stateStore.delete(record.key);
        disposeMounted(record, true);
        this.mounted.delete(block);
      }
    }

    for (const [block, failed] of this.failed) {
      const candidate = byBlock.get(block);
      if (!block.isConnected || !candidate || candidateSignature(candidate) !== failed.signature) {
        removeState(block);
        this.failed.delete(block);
      }
    }

    if (!this.enabled || !allowMount) return result;

    // 身份只在真正要挂载时计算；会话 id 每轮重读，兼容 SPA 内切换会话。
    const identities = computeCardIdentities(candidates, {
      sessionId: this.options.sessionId ?? readSessionId(this.doc),
      accountId: this.options.accountId,
      document: this.doc,
    });

    for (const candidate of candidates) {
      const { block } = candidate;
      if (this.mounted.has(block)) {
        result.skipped += 1;
        continue;
      }

      const identity = identities.get(block);
      if (!identity) {
        result.skipped += 1;
        continue;
      }

      const signature = candidateSignature(candidate);
      if (this.failed.get(block)?.signature === signature) {
        result.skipped += 1;
        continue;
      }

      if (
        block.getAttribute(STATE_ATTR) === 'mounted' &&
        block.previousElementSibling?.hasAttribute('data-genui-host')
      ) {
        result.skipped += 1;
        continue;
      }
      if (block.getAttribute(STATE_ATTR) === 'failed' && !this.failed.has(block)) {
        result.skipped += 1;
        continue;
      }

      // A stale marker can remain after external code removes our host. Clear it
      // before retrying so the block never becomes stuck in a hidden state.
      removeState(block);
      const outcome = this.mountCandidate(candidate, signature, identity);
      if (outcome === 'mounted') result.mounted += 1;
      // deferred（视口门控）与 failed 都不算数：前者等待可验证性，后者已被
      // markFailed 记入 Map，下一轮扫描靠签名比对决定是否重试。
      else if (outcome === 'failed') result.failed += 1;
    }

    return result;
  }

  /** Enable/disable immediately. Disabling restores every original code block. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.restoreAll();
  }

  /** Idempotent cleanup for pagehide and controller disposal. */
  dispose(): void {
    this.enabled = false;
    this.restoreAll();
  }

  private restoreAll(): void {
    for (const record of this.mounted.values()) disposeMounted(record, true);
    this.mounted.clear();
    this.failed.clear();

    for (const block of this.doc.querySelectorAll(`[${STATE_ATTR}]`)) removeState(block);
    for (const host of this.doc.querySelectorAll(`[data-genui-host]`)) host.remove();
  }

  /**
   * 首次挂载状态优先级：页面内仓库 > 兼容的保存方案 > 文档初始值。
   * 保存记录只在身份可持久化（账号、会话可验证且无歧义）时读取，
   * 避免在账号切换或消息身份不清时串用别人的方案。
   */
  private resolveInitialState(
    identity: CardIdentity,
    doc: GenuiDocument,
  ): { state: CardUiState; savedPlanAt: number | null } {
    const existing = this.stateStore.get(identity.key);
    const plan = identity.persistable ? this.savedPlans[identity.key] : undefined;
    const compatible =
      plan && isCompatibleSavedPlan(plan, doc, identity.documentHash) ? plan : null;

    if (existing) {
      return { state: existing, savedPlanAt: compatible?.savedAt ?? null };
    }
    if (compatible) {
      const restored = restoreCardUiState(doc, compatible);
      this.stateStore.set(identity.key, restored.state);
      return { state: restored.state, savedPlanAt: compatible.savedAt };
    }
    const fresh = createCardUiState(doc);
    this.stateStore.set(identity.key, fresh);
    return { state: fresh, savedPlanAt: null };
  }

  /** 显式保存：仅在用户点击时调用；身份不可靠时拒绝写入本机。 */
  private async savePlan(
    identity: CardIdentity,
    doc: GenuiDocument,
    state: CardUiState,
  ): Promise<PlanSaveResult> {
    const store = this.options.planStore;
    if (!store) {
      return { ok: false, message: '保存失败：当前环境不支持本机存储。' };
    }
    if (!identity.persistable) {
      return {
        ok: false,
        message: '保存失败：当前会话或消息身份无法可靠确认，未保存到本机。',
      };
    }

    const plan: SavedCardPlan = {
      stateVersion: CARD_STATE_VERSION,
      documentHash: identity.documentHash,
      stateSignature: documentStateSignature(doc),
      accountId: identity.accountId,
      sessionId: identity.sessionId,
      messageKey: identity.messageKey,
      duplicateIndex: identity.duplicateIndex,
      savedAt: this.now(),
      values: sanitizeCardValues(doc, state.values).values,
      tables: sanitizeTableViews(state.tables),
    };
    const previous = this.savedPlans[identity.key];
    this.savedPlans[identity.key] = plan;
    const result = await store.save(identity.key, plan);
    if (!result.ok) {
      if (previous) this.savedPlans[identity.key] = previous;
      else delete this.savedPlans[identity.key];
    }
    return result;
  }

  private async clearPlan(identity: CardIdentity): Promise<PlanClearResult> {
    const store = this.options.planStore;
    if (!store) {
      return { ok: false, message: '清除失败：当前环境不支持本机存储。' };
    }
    const previous = this.savedPlans[identity.key];
    delete this.savedPlans[identity.key];
    const result = await store.remove(identity.key);
    if (!result.ok && previous) this.savedPlans[identity.key] = previous;
    return result;
  }

  private mountCandidate(
    candidate: GenuiBlockCandidate,
    signature: string,
    identity: CardIdentity,
  ): 'mounted' | 'failed' | 'deferred' {
    const { block } = candidate;

    const originalDisplay = block.style.display;
    const host = this.doc.createElement('div');
    host.className = HOST_CLASS;
    host.setAttribute('data-genui-host', '');

    const raw = candidate.pre?.textContent ?? '';

    /** 统一失败出口：视口门控命中时不判失败，等可验证后的重新扫描。 */
    const reject = (
      reason: EnhanceFailureReason,
      detail?: string,
    ): 'failed' | 'deferred' => {
      block.style.display = originalDisplay;
      host.remove();
      const suffix = detail ? `: ${detail}` : '';
      if (this.options.isBlockUnverifiable?.(block)) {
        // 站点对视口外代码块延迟渲染（docs/phase7-acceptance.md 限制 2）：
        // 此刻的 missing-pre / invalid-json 只是文本尚未补齐，不能当真实失败。
        removeState(block);
        console.debug(`${LOG_PREFIX} block deferred (offscreen)${suffix}`);
        return 'deferred';
      }
      if (this.enabled) {
        markFailed(block, reason);
        this.failed.set(block, { signature, reason });
        console.debug(`${LOG_PREFIX} block skipped (${reason})${suffix}`);
      } else {
        removeState(block);
      }
      return 'failed';
    };

    if (!candidate.pre) {
      return reject('missing-pre', '结构异常，无 pre 内容');
    }

    const parsed = parseGenui(raw);
    if (!parsed.ok) {
      return reject(parsed.code, parsed.detail);
    }

    const resolved = this.resolveInitialState(identity, parsed.document);
    block.before(host);
    let mountedCard: MountedCard;
    let fatalDuringInitialRender = false;
    let record: MountedRecord | null = null;

    try {
      mountedCard = mountCard(host, {
        document: parsed.document,
        rawJson: raw,
        registry: this.options.registry,
        onContinue: this.options.onContinue,
        cardKey: identity.key,
        stateStore: this.stateStore,
        initialState: resolved.state,
        savedPlanAt: resolved.savedPlanAt,
        onSavePlan: this.options.planStore
          ? (state) => this.savePlan(identity, parsed.document, state)
          : undefined,
        onClearPlan: this.options.planStore ? () => this.clearPlan(identity) : undefined,
        onToggleRaw: (showRaw) => {
          // 卡片保持可见，否则「收起原始 JSON」将没有可点的入口。
          block.style.display = showRaw ? originalDisplay : 'none';
        },
        onFatal: (error) => {
          console.error(`${LOG_PREFIX} card render failed, original content restored`, error);
          if (!record) {
            fatalDuringInitialRender = true;
            reject('render-error');
            return;
          }
          if (this.mounted.get(block) !== record) return;
          this.mounted.delete(block);
          disposeMounted(record, false);
          if (this.enabled) {
            this.failed.set(block, { signature, reason: 'render-error' });
            markFailed(block, 'render-error');
          } else {
            removeState(block);
          }
        },
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} card mount failed`, error);
      return reject('mount-failed');
    }

    if (fatalDuringInitialRender) {
      mountedCard.unmount();
      return 'failed';
    }

    record = { block, host, raw, signature, originalDisplay, mountedCard, key: identity.key };
    block.style.display = 'none';
    block.setAttribute(STATE_ATTR, 'mounted');
    this.mounted.set(block, record);
    return 'mounted';
  }
}

/** 可清理的协调器：生产生命周期使用；测试可控生成状态与 DOM 更新。 */
export function createEnhancementManager(doc: Document, options: EnhanceOptions = {}): EnhancementManager {
  return new EnhancementManager(doc, options);
}

/** 阶段 2 单次链路入口，保留供协议与渲染单元测试使用。 */
export function enhanceDocument(doc: Document, options: EnhanceOptions = {}): EnhanceResult {
  return new EnhancementManager(doc, options).reconcile(true);
}
