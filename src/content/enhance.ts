import { LOG_PREFIX } from './lifecycle';
import { findGenuiBlocks, type GenuiBlockCandidate } from './detect';
import { parseGenui } from '../protocol/validate';
import type { GenuiFailureCode } from '../protocol/types';
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

  constructor(
    private readonly doc: Document,
    private readonly options: EnhanceOptions = {},
  ) {}

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
      const changed = !candidate || candidateSignature(candidate) !== record.signature;
      const hostLost = !record.host.isConnected;
      if (!block.isConnected || changed || hostLost) {
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

    for (const candidate of candidates) {
      const { block } = candidate;
      if (this.mounted.has(block)) {
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
      const outcome = this.mountCandidate(candidate, signature);
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

  /** 流式重新生成期间先撤下旧卡片，完成后由稳定扫描重新挂载。 */
  suspendMounted(): void {
    for (const record of this.mounted.values()) disposeMounted(record, true);
    this.mounted.clear();
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

  private mountCandidate(
    candidate: GenuiBlockCandidate,
    signature: string,
  ): 'mounted' | 'failed' | 'deferred' {
    const { block } = candidate;

    const originalDisplay = block.style.display;
    const host = this.doc.createElement('div');
    host.className = HOST_CLASS;
    host.setAttribute('data-genui-host', '');

    /** 统一失败出口：视口门控命中时不判失败，等可验证后的重新扫描。 */
    const reject = (reason: EnhanceFailureReason, detail?: string): 'failed' | 'deferred' => {
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

    const raw = candidate.pre.textContent ?? '';
    const parsed = parseGenui(raw);
    if (!parsed.ok) {
      return reject(parsed.code, parsed.detail);
    }

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

    record = { block, host, raw, signature, originalDisplay, mountedCard };
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
