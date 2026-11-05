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
  createCardUiState,
  type CardUiState,
} from '../runtime/card-state';
import { createCardStateStore, type CardStateStore } from '../runtime/card-state-store';
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

  constructor(
    private readonly doc: Document,
    private readonly options: EnhanceOptions = {},
  ) {
    this.stateStore = options.stateStore ?? createCardStateStore();
    this.adapter = options.adapter ?? DEEPSEEK_SITE_ADAPTER;
    this.diagnostics = options.diagnostics;
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
   * 首次挂载优先沿用页面内仓库：同一文档的节点替换/重新挂载保留已调整值。
   * 仓库缺失时按文档初始值新建，并写回仓库供后续挂载使用。
   */
  private resolveInitialState(identity: CardIdentity, doc: GenuiDocument): CardUiState {
    const existing = this.stateStore.get(identity.key);
    if (existing) return existing;

    const fresh = createCardUiState(doc);
    this.stateStore.set(identity.key, fresh);
    return fresh;
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
        initialState: resolved,
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
