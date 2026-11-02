import { LOG_PREFIX } from './lifecycle';
import { findGenuiBlocks, type GenuiBlockCandidate } from './detect';
import { parseGenui } from '../protocol/validate';
import type { GenuiFailureCode } from '../protocol/types';
import { mountCard, type MountedCard } from '../render/mount';
import type { ElementRegistry } from '../render/registry';

/**
 * 识别 → 解析 → 挂载 的整链路（阶段 2）。
 *
 * 行为约束：
 * - 幂等：块上已有 data-genui-state（mounted|failed）直接跳过，
 *   重复执行不产生重复卡片；
 * - 失败安全：解析/校验/挂载任一环节失败，原始代码块保持原样可见，
 *   仅打 data-genui-state=failed + data-genui-reason 记录原因；
 * - 透明：成功时原始块隐藏但保留在 DOM 中，卡片 footer 提供
 *   「查看原始 JSON」随时恢复；
 * - 阶段 2 只在 document_idle 执行一次，MutationObserver 属阶段 3。
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
}

export interface EnhanceResult {
  /** 成功挂载的卡片数。 */
  mounted: number;
  /** 因幂等跳过的块数（已处理过）。 */
  skipped: number;
  /** 判定失败、原样保留的块数。 */
  failed: number;
}

function markFailed(block: Element, reason: EnhanceFailureReason): void {
  block.setAttribute(STATE_ATTR, 'failed');
  block.setAttribute(REASON_ATTR, reason);
}

function mountCandidate(
  candidate: GenuiBlockCandidate,
  options: EnhanceOptions,
  result: EnhanceResult,
): void {
  const { block } = candidate;

  if (!candidate.pre) {
    markFailed(block, 'missing-pre');
    console.debug(`${LOG_PREFIX} block skipped (missing-pre): 结构异常，无 pre 内容`);
    result.failed += 1;
    return;
  }

  const raw = candidate.pre.textContent ?? '';
  const parsed = parseGenui(raw);
  if (!parsed.ok) {
    markFailed(block, parsed.code);
    console.debug(`${LOG_PREFIX} block skipped (${parsed.code}): ${parsed.detail}`);
    result.failed += 1;
    return;
  }

  const doc = block.ownerDocument;
  const host = doc.createElement('div');
  host.className = HOST_CLASS;
  host.setAttribute('data-genui-host', '');
  block.before(host);

  const originalDisplay = block.style.display;
  let mountedCard: MountedCard | null = null;

  /** 卸载卡片、移除 host、恢复原始块可见性并标记失败原因。 */
  const restoreOriginal = (reason: EnhanceFailureReason): void => {
    mountedCard?.unmount();
    mountedCard = null;
    host.remove();
    block.style.display = originalDisplay;
    markFailed(block, reason);
  };

  try {
    mountedCard = mountCard(host, {
      document: parsed.document,
      rawJson: raw,
      registry: options.registry,
      onToggleRaw: (showRaw) => {
        // 卡片保持可见（它就是「查看原始内容」的入口与开关），
        // 只切换原块显隐；若隐藏卡片，「收起原始 JSON」将不可再点击。
        block.style.display = showRaw ? originalDisplay : 'none';
      },
      onFatal: (error) => {
        console.error(`${LOG_PREFIX} card render failed, original content restored`, error);
        restoreOriginal('render-error');
      },
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} card mount failed`, error);
    restoreOriginal('mount-failed');
    result.failed += 1;
    return;
  }

  block.style.display = 'none';
  block.setAttribute(STATE_ATTR, 'mounted');
  result.mounted += 1;
}

/** 扫描文档中所有 genui 代码块并逐个挂载，返回统计结果。 */
export function enhanceDocument(doc: Document, options: EnhanceOptions = {}): EnhanceResult {
  const result: EnhanceResult = { mounted: 0, skipped: 0, failed: 0 };

  for (const candidate of findGenuiBlocks(doc)) {
    if (candidate.block.hasAttribute(STATE_ATTR)) {
      result.skipped += 1;
      continue;
    }
    mountCandidate(candidate, options, result);
  }

  return result;
}
