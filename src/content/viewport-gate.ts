/**
 * 视口门控适配器：判定候选代码块此刻是否可作为解析判定依据。
 *
 * 背景（docs/phase7-acceptance.md 限制 2）：DeepSeek 站点对视口外代码块延迟渲染，
 * 离屏时 DOM 中只有代码块头部和极短前缀。扩展在文本补齐前解析会得到 invalid-json，
 * 曾把这样的块暂时标记为 failed，造成「看似产品失败」的假象。
 *
 * 策略：块第一次确认相交视口之前视为「不可验证」；确认可见后，后续判定按
 * 正常规则进行（此时文本若仍非法即为真实失败）。确认可见后不再回退，
 * 因此对同一块最多多一轮重新扫描。无 IntersectionObserver 的环境
 * （jsdom 单测、Playwright 模拟页未开启门控）适配器不可用，行为与旧版一致。
 */

/** 传给 EnhancementManager 的判定函数（EnhanceOptions.isBlockUnverifiable）。 */
export type IsBlockUnverifiable = (block: HTMLElement) => boolean;

export interface ViewportGateAdapter {
  isBlockUnverifiable: IsBlockUnverifiable;
  /** 停止观察并释放资源（controller.stop 调用）。 */
  dispose: () => void;
}

/**
 * 创建视口门控；window 没有 IntersectionObserver 时返回 null（调用方按旧规则处理）。
 * onVerifiable 在块首次确认可见时触发一次，供生命周期控制器立即重新调度扫描。
 */
export function createViewportGateAdapter(
  win: Window & typeof globalThis,
  onVerifiable: (block: HTMLElement) => void,
): ViewportGateAdapter | null {
  const Observer = win.IntersectionObserver;
  if (typeof Observer !== 'function') return null;

  /** >0 表示至少一次确认相交；不回退。 */
  const seenVisible = new WeakMap<HTMLElement, boolean>();
  const observer = new Observer(
    (entries) => {
      for (const entry of entries) {
        const block = entry.target as HTMLElement;
        if (!entry.isIntersecting || seenVisible.get(block) === true) continue;
        seenVisible.set(block, true);
        onVerifiable(block);
      }
    },
    // block 只要有一像素落在视口内即视为可验证；内容是否完整由解析结果决定。
    { root: null, threshold: 0 },
  );

  return {
    isBlockUnverifiable(block: HTMLElement): boolean {
      if (seenVisible.get(block) === true) return false;
      observer.observe(block);
      // 首次相遇：IntersectionObserver 的初始回调尚未发生，先视为不可验证。
      // 若块本来就可见，回调会立刻把 seenVisible 置真并触发 onVerifiable 重扫。
      return true;
    },
    dispose(): void {
      observer.disconnect();
    },
  };
}
