/**
 * genui 代码块识别（阶段 2），issue #9 起委托给统一站点适配层。
 *
 * 识别规则与选择器证据见 src/content/site-adapter.ts 与
 * docs/compatibility-investigation.md §3.2–3.3；本模块只保留稳定的
 * 导出名与默认适配器调用，避免既有调用方与测试被迫改动。
 */

import { DEEPSEEK_SITE_ADAPTER, type GenuiBlockCandidate, type SiteAdapter } from './site-adapter';

export { ASSISTANT_SELECTOR, GENUI_LABEL, LANGUAGE_LABEL_SELECTOR } from './site-adapter';
export type { GenuiBlockCandidate } from './site-adapter';

/** 在给定根节点（通常是 document）内找出所有 genui 代码块，按文档顺序返回。 */
export function findGenuiBlocks(
  root: ParentNode,
  adapter: SiteAdapter = DEEPSEEK_SITE_ADAPTER,
): GenuiBlockCandidate[] {
  return adapter.findCandidates(root);
}
