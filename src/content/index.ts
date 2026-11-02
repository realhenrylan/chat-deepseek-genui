import { initContentScript, LOG_PREFIX, type ContentScope } from './lifecycle';
import { createPageLifecycle } from './controller';
import { fillContinueIntoInput } from './followup';

// 内容脚本入口：仅在阶段 0 确认的匹配范围（https://chat.deepseek.com/*）内注入。
// 阶段 3：幂等初始化后启动动态生命周期控制、保守挂载和本地增强开关。
// 阶段 6：继续讨论接线到聊天输入框（追加不覆盖；发送始终由用户完成）。
try {
  const init = initContentScript(globalThis as unknown as ContentScope, document);
  if (!init.alreadyLoaded) {
    const lifecycle = createPageLifecycle(document, {
      onContinue: (summary) => fillContinueIntoInput(document, summary),
    });
    void lifecycle.start().catch((error: unknown) => {
      console.error(`${LOG_PREFIX} lifecycle start failed`, error);
    });
  }
} catch (error) {
  console.error(`${LOG_PREFIX} content script init failed`, error);
}
