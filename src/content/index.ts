import { initContentScript, LOG_PREFIX, type ContentScope } from './lifecycle';
import { createPageLifecycle } from './controller';

// 内容脚本入口：仅在阶段 0 确认的匹配范围（https://chat.deepseek.com/*）内注入。
// 阶段 3：幂等初始化后启动动态生命周期控制、保守挂载和本地增强开关。
// 阶段 6：继续讨论接线到聊天输入框（追加不覆盖；发送始终由用户完成）。
// 阶段 7：默认增强只把可见提示词追加到草稿末尾，不自动发送。
try {
  const init = initContentScript(globalThis as unknown as ContentScope, document);
  if (!init.alreadyLoaded) {
    // 继续讨论/修复请求的默认投递由控制器用同一个站点适配器完成；
    // 这里不传回调，避免自定义适配器时卡片识别与输入框识别分叉。
    const lifecycle = createPageLifecycle(document, {
      // 生产开启视口门控：离屏代码块的瞬时 invalid-json 不误标失败（限制 2 缓解）。
      enableViewportGate: true,
    });
    void lifecycle.start().catch((error: unknown) => {
      console.error(`${LOG_PREFIX} lifecycle start failed`, error);
    });
  }
} catch (error) {
  console.error(`${LOG_PREFIX} content script init failed`, error);
}
