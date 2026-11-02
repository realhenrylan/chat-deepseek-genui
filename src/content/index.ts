import { initContentScript, LOG_PREFIX, type ContentScope } from './lifecycle';

// 内容脚本入口：仅在阶段 0 确认的匹配范围（https://chat.deepseek.com/*）内注入。
// 阶段 1 为最小骨架：只做幂等初始化与加载标记；挂载、解析与 UI 从阶段 2 起实现。
try {
  initContentScript(globalThis as unknown as ContentScope, document);
} catch (error) {
  console.error(`${LOG_PREFIX} content script init failed`, error);
}
