import { initContentScript, LOG_PREFIX, type ContentScope } from './lifecycle';
import { enhanceDocument } from './enhance';

// 内容脚本入口：仅在阶段 0 确认的匹配范围（https://chat.deepseek.com/*）内注入。
// 阶段 2：幂等初始化后执行一次「识别 → 解析 → 挂载」（document_idle）；
// MutationObserver 动态识别属于阶段 3。
try {
  const init = initContentScript(globalThis as unknown as ContentScope, document);
  if (!init.alreadyLoaded) {
    const result = enhanceDocument(document);
    console.debug(`${LOG_PREFIX} enhance finished`, result);
  }
} catch (error) {
  console.error(`${LOG_PREFIX} content script init failed`, error);
}
