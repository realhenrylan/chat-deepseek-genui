import { LOG_PREFIX } from './lifecycle';
import { findGenuiBlocks, type GenuiBlockCandidate } from './detect';
import { computeCardIdentities, readSessionId, type CardIdentity } from './identity';
import { DEEPSEEK_SITE_ADAPTER, type SiteAdapter } from './site-adapter';
import {
  type DiagnosticCategory,
  type DiagnosticCode,
  type DiagnosticRecorder,
} from '../runtime/diagnostics';
import { parseGenui } from '../protocol/validate';
import type { GenuiDocument, GenuiFailureCode } from '../protocol/types';
import {
  diagnoseIncompatible,
  diagnoseParseFailure,
  type GenuiDiagnostic,
} from '../protocol/diagnose';
import {
  CARD_STATE_VERSION,
  createCardUiState,
  documentStateSignature,
  isCompatibleSavedState,
  restoreCardUiState,
  sanitizeCardValues,
  sanitizeTableViews,
  type CardUiState,
  type SavedCardState,
  type SavedStateClearResult,
  type SavedStateSaveResult,
} from '../runtime/card-state';
import { createCardStateStore, type CardStateStore } from '../runtime/card-state-store';
import {
  createChromeSavedStateStore,
  type SavedStateStore,
} from '../runtime/saved-card-state-store';
import { GenuiStatusPanel, STATUS_ATTR, STATUS_HOST_ATTR, type BlockStatus } from './failure-ui';
import type { RepairDeliveryResult } from './repair';
import { mountCard, type MountedCard } from '../render/mount';
import type { ElementRegistry } from '../render/registry';

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

/** 失败原因到脱敏诊断信号的映射；deferred 不是失败，单独记为等待。 */
export function diagnosticForEnhanceFailure(
  reason: EnhanceFailureReason,
): { category: DiagnosticCategory; code: DiagnosticCode } {
  if (reason === 'missing-pre') return { category: 'detection', code: 'missing-pre' };
  if (reason === 'mount-failed') return { category: 'mount', code: 'mount-failed' };
  if (reason === 'render-error') return { category: 'mount', code: 'render-error' };
  return { category: 'protocol', code: reason };
}

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
  /** 页面内状态仓库覆盖（测试注入）；缺省新建且有上限。 */
  stateStore?: CardStateStore;
  /**
   * 「生成修复请求」投递：生产接线 content/repair.deliverRepairRequest
   * （写入可见草稿或复制到剪贴板，绝不自动发送）。
   */
  onRepairRequest?: (prompt: string) => RepairDeliveryResult | Promise<RepairDeliveryResult>;
  /** 站点适配层覆盖；缺省使用 DeepSeek 适配器（测试注入变体）。 */
  adapter?: SiteAdapter;
  /** 脱敏诊断记录器；缺省不记录，生产由页面控制器注入。 */
  diagnostics?: DiagnosticRecorder;
  /**
   * 用户主动保存的卡片状态存储覆盖；缺省使用 chrome.storage.local，
   * 环境缺少扩展存储 API（单测/普通页面）时为 null，卡片不显示保存入口。
   */
  savedStateStore?: SavedStateStore | null;
  /** 已保存状态的预载结果（测试注入）；与存储读取结果合并，注入项优先。 */
  savedStates?: Record<string, SavedCardState>;
  /** 保存时间戳的时间源（测试注入）；缺省 Date.now。 */
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

interface StatusRecord {
  signature: string;
  status: BlockStatus | null;
  panel: GenuiStatusPanel;
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

/** 与候选块匹配上的本机保存记录及其 storage 键（可能是兜底匹配的旧键）。 */
interface SavedMatch {
  key: string;
  record: SavedCardState;
}

/** 首次挂载的初始状态，以及「是否存在保存记录 / 本次是否从保存记录恢复」。 */
interface ResolvedInitialState {
  state: CardUiState;
  savedAt: number | null;
  restoredAt: number | null;
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

function blockStatusFor(diagnostic: GenuiDiagnostic): BlockStatus {
  if (diagnostic.status === 'incomplete') return 'incomplete';
  if (diagnostic.status === 'page-incompatible') return 'incompatible';
  return 'invalid';
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
  private readonly statuses = new Map<HTMLElement, StatusRecord>();
  private enabled = true;
  private readonly stateStore: CardStateStore;
  private readonly adapter: SiteAdapter;
  private readonly diagnostics?: DiagnosticRecorder;
  private readonly savedStateStore: SavedStateStore | null;
  private savedStates: Record<string, SavedCardState>;
  private readonly now: () => number;

  constructor(
    private readonly doc: Document,
    private readonly options: EnhanceOptions = {},
  ) {
    this.stateStore = options.stateStore ?? createCardStateStore();
    this.adapter = options.adapter ?? DEEPSEEK_SITE_ADAPTER;
    this.diagnostics = options.diagnostics;
    this.savedStateStore =
      options.savedStateStore === undefined ? createChromeSavedStateStore() : options.savedStateStore;
    this.savedStates = { ...options.savedStates };
    this.now = options.now ?? Date.now;
  }

  /**
   * 读取本机保存的卡片设置；生命周期在首次扫描前 await，避免卡片先以初始值
   * 挂载、随后再被恢复值替换。读取失败只记录警告：保存是增强路径，不阻塞页面。
   */
  async preloadSavedStates(): Promise<void> {
    const store = this.savedStateStore;
    if (!store) return;
    try {
      const loaded = await store.loadAll();
      // 已在本页保存/注入的记录优先，避免预载结果覆盖本次会话产生的新值。
      this.savedStates = { ...loaded, ...this.savedStates, ...this.options.savedStates };
    } catch (error) {
      console.warn(`${LOG_PREFIX} could not load saved card states`, error);
    }
  }

  /** 当前已挂载/已判失败的块数，供诊断上下文与测试观察。 */
  counts(): { mounted: number; failed: number } {
    return { mounted: this.mounted.size, failed: this.failed.size };
  }

  private ensureStatus(
    candidate: GenuiBlockCandidate,
    signature: string,
  ): StatusRecord {
    const existing = this.statuses.get(candidate.block);
    if (existing && existing.signature === signature) return existing;
    if (existing) this.destroyStatus(candidate.block);
    const panel = new GenuiStatusPanel(this.doc, candidate.block, {
      onRequestRepair: this.options.onRepairRequest,
    });
    const record: StatusRecord = { signature, status: null, panel };
    this.statuses.set(candidate.block, record);
    return record;
  }

  private destroyStatus(block: HTMLElement): void {
    const record = this.statuses.get(block);
    if (!record) {
      block.removeAttribute(STATUS_ATTR);
      return;
    }
    record.panel.destroy();
    this.statuses.delete(block);
    block.removeAttribute(STATUS_ATTR);
  }

  private showStatus(
    candidate: GenuiBlockCandidate,
    signature: string,
    status: BlockStatus,
    diagnostic?: GenuiDiagnostic,
    raw = '',
  ): void {
    const record = this.ensureStatus(candidate, signature);
    candidate.block.setAttribute(STATUS_ATTR, status);
    // 相同的暂态不重复渲染，避免状态 host 自身触发不必要的页面变更。
    if (record.status === status && !diagnostic) return;
    record.status = status;
    if (status === 'pending' || status === 'validating' || status === 'deferred') {
      record.panel.showPending(status);
    } else if (diagnostic) {
      record.panel.showDiagnostic(diagnostic, raw);
    }
  }

  /** 生成中：显示等待完整内容，不解析、不判定失败。 */
  markPending(candidates: GenuiBlockCandidate[]): void {
    if (!this.enabled) return;
    for (const candidate of candidates) {
      if (this.mounted.has(candidate.block) || this.failed.has(candidate.block)) continue;
      this.showStatus(candidate, candidateSignature(candidate), 'pending');
    }
  }

  /** 内容稳定、即将校验：把已有的等待面板切换为验证中。 */
  markValidating(candidates: GenuiBlockCandidate[]): void {
    if (!this.enabled) return;
    for (const candidate of candidates) {
      if (this.mounted.has(candidate.block) || this.failed.has(candidate.block)) continue;
      if (!this.statuses.has(candidate.block)) continue;
      this.showStatus(candidate, candidateSignature(candidate), 'validating');
    }
  }

  private sweepStatuses(candidates: GenuiBlockCandidate[]): void {
    const byBlock = new Map(candidates.map((candidate) => [candidate.block, candidate]));
    for (const [block, record] of this.statuses) {
      const candidate = byBlock.get(block);
      if (!block.isConnected || !candidate || this.mounted.has(block)) {
        this.destroyStatus(block);
        continue;
      }
      const signature = candidateSignature(candidate);
      if (signature === record.signature) continue;
      // 生成中的内容每个扫描都在变化；保留暂态面板只更新签名，避免面板闪烁。
      if (record.status === 'pending' || record.status === 'validating' || record.status === 'deferred') {
        record.signature = signature;
      } else {
        this.destroyStatus(block);
      }
    }
  }

  /**
   * 对当前 DOM 做一次协调。allowMount=false 只清理已失效/已变化的挂载，
   * 不解析或标记新块；生命周期控制器用它等待生成结束与内容稳定。
   */
  reconcile(allowMount = true): EnhanceResult {
    const result: EnhanceResult = { mounted: 0, skipped: 0, failed: 0 };
    const candidates = findGenuiBlocks(this.doc, this.adapter);
    const byBlock = new Map(candidates.map((candidate) => [candidate.block, candidate]));

    // 身份只在真正要挂载时计算；已挂载块也要用当前会话/账号重新核对，
    // 否则 SPA 切换会话而复用节点时，旧卡片会一直绑定上一个会话的状态键。
    const identities =
      this.enabled && allowMount
        ? computeCardIdentities(candidates, {
            sessionId: this.options.sessionId ?? readSessionId(this.doc, this.adapter),
            accountId: this.options.accountId,
            adapter: this.adapter,
            document: this.doc,
          })
        : null;
    const savedMatches = identities ? this.matchSavedStates(identities) : null;

    for (const [block, record] of this.mounted) {
      const candidate = byBlock.get(block);
      const removed = !candidate;
      // 只有「仍在页面上、但原始文本被改写」才丢弃旧状态；节点被移除或
      // 虚拟列表回收时保留，同一身份重新挂载仍可恢复。
      const changedText =
        candidate !== undefined && candidateSignature(candidate) !== record.signature;
      const hostLost = !record.host.isConnected;
      // 会话/账号/消息键变化时撤销旧绑定；旧状态留在内存仓库里，切回原会话
      // 仍可按旧身份恢复，但绝不会串到新会话。
      const currentKey = candidate !== undefined ? identities?.get(block)?.key : undefined;
      const identityChanged =
        identities !== null && currentKey !== undefined && currentKey !== record.key;
      if (!block.isConnected || removed || changedText || hostLost || identityChanged) {
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

    this.sweepStatuses(candidates);

    if (!this.enabled || !allowMount || !identities) return result;

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
      const outcome = this.mountCandidate(
        candidate,
        signature,
        identity,
        savedMatches?.get(block) ?? null,
      );
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

  /**
   * 流式重新生成期间先撤下正在变化的卡片，完成后由稳定扫描重新挂载。
   * 传入 container 时只处理该回复内的卡片，历史回答的已挂载卡片保持不变。
   */
  suspendMounted(container?: Element | null): void {
    for (const [block, record] of [...this.mounted]) {
      if (container && !container.contains(block)) continue;
      disposeMounted(record, true);
      this.mounted.delete(block);
    }
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

    for (const block of [...this.statuses.keys()]) this.destroyStatus(block);
    for (const block of this.doc.querySelectorAll(`[${STATE_ATTR}]`)) removeState(block);
    for (const block of this.doc.querySelectorAll(`[${STATUS_ATTR}]`)) {
      block.removeAttribute(STATUS_ATTR);
    }
    for (const host of this.doc.querySelectorAll(`[${STATUS_HOST_ATTR}]`)) host.remove();
    for (const host of this.doc.querySelectorAll(`[data-genui-host]`)) host.remove();
  }

  /**
   * 找到每个候选块对应的本机保存记录。精确身份键优先；刷新后消息键可能变化，
   * 此时仅在「同一账号/会话内该文档唯一，且匹配的保存记录也唯一」时才按文档
   * 回退匹配。任一条件不满足都不恢复：宁可回到初始值，也不把别人的设置串进来。
   */
  private matchSavedStates(
    identities: Map<HTMLElement, CardIdentity>,
  ): Map<HTMLElement, SavedMatch> {
    const matched = new Map<HTMLElement, SavedMatch>();
    const fallbackGroups = new Map<string, Array<{ block: HTMLElement; identity: CardIdentity }>>();

    for (const [block, identity] of identities) {
      if (identity.ambiguous) continue;
      const exact = this.savedStates[identity.key];
      if (exact) {
        matched.set(block, { key: identity.key, record: exact });
        continue;
      }
      const groupKey = `${identity.accountId}|${identity.sessionId}|${identity.documentHash}`;
      const group = fallbackGroups.get(groupKey);
      if (group) group.push({ block, identity });
      else fallbackGroups.set(groupKey, [{ block, identity }]);
    }

    for (const group of fallbackGroups.values()) {
      // 当前页面上同一文档有多个候选（重复回答）时，无法判断哪条记录属于谁。
      if (group.length !== 1) continue;
      const [{ block, identity }] = group;
      const candidates = Object.entries(this.savedStates).filter(
        ([key, record]) =>
          key !== identity.key &&
          record.accountId === identity.accountId &&
          record.sessionId === identity.sessionId &&
          record.documentHash === identity.documentHash,
      );
      if (candidates.length !== 1) continue;
      matched.set(block, { key: candidates[0][0], record: candidates[0][1] });
    }

    return matched;
  }

  /**
   * 首次挂载优先沿用页面内仓库：同一文档的节点替换/重新挂载保留已调整值。
   * 仓库缺失时按「兼容的本机保存记录」恢复，最后才用文档初始值；任何恢复
   * 都要通过文档哈希与状态结构签名校验，并重新清洗字段。
   */
  private resolveInitialState(
    identity: CardIdentity,
    doc: GenuiDocument,
    saved: SavedMatch | null,
  ): ResolvedInitialState {
    const compatible =
      saved && isCompatibleSavedState(saved.record, doc, identity.documentHash) ? saved : null;
    const savedAt = compatible ? compatible.record.savedAt : null;

    const existing = this.stateStore.get(identity.key);
    if (existing) return { state: existing, savedAt, restoredAt: null };

    if (compatible) {
      const restored = restoreCardUiState(doc, compatible.record);
      this.stateStore.set(identity.key, restored.state);
      return { state: restored.state, savedAt, restoredAt: savedAt };
    }

    const fresh = createCardUiState(doc);
    this.stateStore.set(identity.key, fresh);
    return { state: fresh, savedAt: null, restoredAt: null };
  }

  /**
   * 用户点击保存：把当前界面写成本机记录。身份不可靠时拒绝，避免恢复阶段
   * 靠猜测把设置应用到错误的消息；写入失败回滚内存副本，界面状态保持可用。
   */
  private async saveState(
    identity: CardIdentity,
    doc: GenuiDocument,
    state: CardUiState,
    previousKey: string | null,
  ): Promise<SavedStateSaveResult> {
    const store = this.savedStateStore;
    if (!store) return { ok: false, message: '保存失败：当前环境不支持本机存储。' };
    if (identity.ambiguous) {
      return { ok: false, message: '保存失败：当前消息身份无法可靠确认，未保存到本机。' };
    }

    const record: SavedCardState = {
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

    const previous = this.savedStates[identity.key];
    this.savedStates[identity.key] = record;
    const result = await store.save(identity.key, record);
    if (!result.ok) {
      if (previous) this.savedStates[identity.key] = previous;
      else delete this.savedStates[identity.key];
      return result;
    }

    // 兜底匹配到的旧键（消息键已变化）在保存成功后清理，避免同一文档留两份记录。
    if (previousKey && previousKey !== identity.key) {
      delete this.savedStates[previousKey];
      await store.remove(previousKey);
    }
    return result;
  }

  /** 用户点击清除：只移除本机保存；当前页面内的调整值保持不变。 */
  private async clearSavedState(
    identity: CardIdentity,
    previousKey: string | null,
  ): Promise<SavedStateClearResult> {
    const store = this.savedStateStore;
    if (!store) return { ok: false, message: '清除失败：当前环境不支持本机存储。' };

    const keys = new Set<string>([identity.key]);
    if (previousKey) keys.add(previousKey);
    const snapshots = new Map<string, SavedCardState>();
    for (const key of keys) {
      const record = this.savedStates[key];
      if (record) snapshots.set(key, record);
      delete this.savedStates[key];
    }

    let failure: SavedStateClearResult | null = null;
    for (const key of keys) {
      const result = await store.remove(key);
      if (!result.ok) failure = result;
    }
    if (failure) {
      for (const [key, record] of snapshots) this.savedStates[key] = record;
      return failure;
    }
    return { ok: true };
  }

  private mountCandidate(
    candidate: GenuiBlockCandidate,
    signature: string,
    identity: CardIdentity,
    saved: SavedMatch | null,
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
      diagnostic?: GenuiDiagnostic,
    ): 'failed' | 'deferred' => {
      block.style.display = originalDisplay;
      host.remove();
      const suffix = detail ? `: ${detail}` : '';
      if (this.options.isBlockUnverifiable?.(block)) {
        // 站点对视口外代码块延迟渲染（docs/phase7-acceptance.md 限制 2）：
        // 此刻的 missing-pre / invalid-json 只是文本尚未补齐，不能当真实失败。
        removeState(block);
        this.showStatus(candidate, signature, 'deferred');
        this.diagnostics?.record('waiting', 'deferred-offscreen');
        console.debug(`${LOG_PREFIX} block deferred (offscreen)${suffix}`);
        return 'deferred';
      }
      if (this.enabled) {
        markFailed(block, reason);
        this.failed.set(block, { signature, reason });
        const signal = diagnosticForEnhanceFailure(reason);
        this.diagnostics?.record(signal.category, signal.code);
        if (diagnostic) {
          this.showStatus(candidate, signature, blockStatusFor(diagnostic), diagnostic, raw);
        }
        console.debug(`${LOG_PREFIX} block skipped (${reason})${suffix}`);
      } else {
        removeState(block);
        this.destroyStatus(block);
      }
      return 'failed';
    };

    if (!candidate.pre) {
      return reject('missing-pre', '结构异常，无 pre 内容', diagnoseIncompatible('missing-pre'));
    }

    const parsed = parseGenui(raw);
    if (!parsed.ok) {
      return reject(parsed.code, parsed.detail, diagnoseParseFailure(parsed, raw));
    }

    const resolved = this.resolveInitialState(identity, parsed.document, saved);
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
        savedAt: resolved.savedAt,
        restoredAt: resolved.restoredAt,
        // 没有本机存储时不渲染保存入口，避免按钮只能给出失败反馈。
        ...(this.savedStateStore
          ? {
              onSaveState: (state: CardUiState) =>
                this.saveState(identity, parsed.document, state, saved?.key ?? null),
              onClearSavedState: () => this.clearSavedState(identity, saved?.key ?? null),
            }
          : {}),
        onToggleRaw: (showRaw) => {
          // 卡片保持可见，否则「收起原始 JSON」将没有可点的入口。
          block.style.display = showRaw ? originalDisplay : 'none';
        },
        onFatal: (error) => {
          console.error(`${LOG_PREFIX} card render failed, original content restored`, error);
          if (!record) {
            fatalDuringInitialRender = true;
            reject('render-error', undefined, diagnoseIncompatible('render-error'));
            return;
          }
          if (this.mounted.get(block) !== record) return;
          this.mounted.delete(block);
          disposeMounted(record, false);
          if (this.enabled) {
            this.failed.set(block, { signature, reason: 'render-error' });
            markFailed(block, 'render-error');
            this.diagnostics?.record('mount', 'render-error');
            const diagnostic = diagnoseIncompatible('render-error');
            this.showStatus(candidate, signature, blockStatusFor(diagnostic), diagnostic, raw);
          } else {
            removeState(block);
            this.destroyStatus(block);
          }
        },
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} card mount failed`, error);
      return reject('mount-failed', undefined, diagnoseIncompatible('mount-failed'));
    }

    if (fatalDuringInitialRender) {
      mountedCard.unmount();
      return 'failed';
    }

    record = { block, host, raw, signature, originalDisplay, mountedCard, key: identity.key };
    this.destroyStatus(block);
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
