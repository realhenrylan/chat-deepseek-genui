import { LOG_PREFIX } from './lifecycle';
import { createEnhancementManager, type EnhanceOptions } from './enhance';
import { createViewportGateAdapter, type ViewportGateAdapter } from './viewport-gate';
import { findGenuiBlocks, type GenuiBlockCandidate } from './detect';
import { createExtensionSettingsStore, type ExtensionSettingsStore } from './settings';
import { createToggleControl, type ToggleControl } from './toggle';
import { createDraftAugmenter, type DraftAugmenter } from './augment';
import { GENUI_PROMPT_TEXT, GENUI_PROMPT_VERSION } from './prompt';

/** 2026-11-02 真实调查记录的 DeepSeek「停止生成」图标路径前缀。 */
export const STOP_GENERATION_PATH_PREFIX = 'M2 4.88C2 3.68009';

export interface PageLifecycleOptions extends EnhanceOptions {
  /** 单元测试注入；生产环境自动使用 chrome.storage.local。 */
  store?: ExtensionSettingsStore | null;
  /** DOM 变更合并时间；生产默认 100ms。 */
  debounceMs?: number;
  /** 生成结束后的稳定等待时间；生产默认 700ms。 */
  settleMs?: number;
  /** 草稿停止输入后追加默认增强的等待时间；生产默认 700ms。 */
  augmentDelayMs?: number;
  /**
   * 视口门控（src/content/viewport-gate.ts）：生产开启，站点离屏代码块
   * 延迟渲染造成的瞬时 invalid-json/missing-pre 不再误标为 failed。
   * 单测与 Playwright 模拟页不开启，保持旧行为以便确定性断言。
   */
  enableViewportGate?: boolean;
  window?: Window;
}

interface CandidateSnapshot {
  block: HTMLElement;
  signature: string;
}

/**
 * 用真实调查记录的停止按钮可见信号阻止流式挂载。
 * 按钮的哈希类名不参与识别；优先语义属性，回退到取证的方形停止图标路径。
 */
export function isGenerationActive(doc: Document): boolean {
  const buttons = doc.querySelectorAll<HTMLElement>('button, [role="button"]');
  for (const button of buttons) {
    const label = `${button.getAttribute('aria-label') ?? ''} ${button.getAttribute('title') ?? ''}`;
    if (label.includes('停止生成')) return true;
    if (button.querySelector(`svg path[d^="${STOP_GENERATION_PATH_PREFIX}"]`)) return true;
  }

  // 实测停止按钮悬停后会显示此 tooltip；它只作为辅助信号。
  for (const tooltip of doc.querySelectorAll('div.ds-tooltip')) {
    if ((tooltip.textContent ?? '').trim() === '停止生成') return true;
  }
  return false;
}

function snapshotCandidates(candidates: GenuiBlockCandidate[]): CandidateSnapshot[] {
  return candidates.map((candidate) => ({
    block: candidate.block,
    // 同时比较整个 AI 回复文本，避免代码块暂时静止、回复其他部分仍在流式时提前挂载。
    signature: `${candidate.pre ? 'pre' : 'no-pre'}\u0000${candidate.pre?.textContent ?? ''}\u0001${candidate.container.textContent ?? ''}`,
  }));
}

function sameSnapshot(a: CandidateSnapshot[] | null, b: CandidateSnapshot[]): boolean {
  return (
    a !== null &&
    a.length === b.length &&
    a.every((item, index) => item.block === b[index].block && item.signature === b[index].signature)
  );
}

function nodeIsExtensionOwned(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(element?.closest('[data-genui-host], [data-genui-control], [data-genui-status-host]'));
}

function isOwnMutation(record: MutationRecord): boolean {
  if (nodeIsExtensionOwned(record.target)) return true;
  const touched = [...record.addedNodes, ...record.removedNodes];
  return touched.length > 0 && touched.every(nodeIsExtensionOwned);
}

/**
 * 管理动态页面、保守生成结束检测、增强开关及导航清理。
 * 默认开启；扩展设置使用 local storage 保存并通过 storage 事件同步到其他标签页。
 */
export function createPageLifecycle(doc: Document, options: PageLifecycleOptions = {}) {
  const targetWindow = options.window ?? doc.defaultView;
  if (!targetWindow) throw new Error('页面 window 不存在，无法启动生命周期监听');
  const win: Window & typeof globalThis = targetWindow as Window & typeof globalThis;

  // 视口门控：块首次进入视口前不把瞬时解析失败当真实失败；进入后立即重扫。
  const gate: ViewportGateAdapter | null =
    options.enableViewportGate === true ? createViewportGateAdapter(win, () => scheduleScan(0)) : null;
  const managerOptions: EnhanceOptions = gate
    ? { ...options, isBlockUnverifiable: gate.isBlockUnverifiable }
    : options;
  const manager = createEnhancementManager(doc, managerOptions);
  const store = options.store === undefined ? createExtensionSettingsStore() : options.store;
  const debounceMs = options.debounceMs ?? 100;
  const settleMs = options.settleMs ?? 700;

  let enabled = true;
  let started = false;
  let settingsLoaded = false;
  let pendingStorageValue: boolean | undefined;
  let pendingUserValue: boolean | undefined;
  let observer: MutationObserver | null = null;
  let control: ToggleControl | null = null;
  let augmenter: DraftAugmenter | null = null;
  let unsubscribe: (() => void) | null = null;
  let scanTimer: number | null = null;
  let settleTimer: number | null = null;
  let stableSnapshot: CandidateSnapshot[] | null = null;

  const clearScanTimer = (): void => {
    if (scanTimer !== null) {
      win.clearTimeout(scanTimer);
      scanTimer = null;
    }
  };

  const clearSettleTimer = (): void => {
    if (settleTimer !== null) {
      win.clearTimeout(settleTimer);
      settleTimer = null;
    }
  };

  const applyEnabled = (next: boolean): void => {
    const changed = enabled !== next;
    enabled = next;
    control?.setEnabled(next);
    manager.setEnabled(next);
    // 关闭时移除仍完整位于草稿末尾的自动追加说明；用户修改过说明文本则保持原样。
    augmenter?.setEnabled(next);
    if (!changed) return;
    stableSnapshot = null;
    clearSettleTimer();
    if (next) scheduleScan(0);
  };

  const persistEnabled = (next: boolean): void => {
    if (!settingsLoaded) pendingUserValue = next;
    applyEnabled(next);
    void store?.saveGenuiEnabled(next).catch((error: unknown) => {
      console.warn(`${LOG_PREFIX} could not save GenUI setting`, error);
    });
  };

  const scan = (): void => {
    if (!started || !settingsLoaded) return;

    const candidates = findGenuiBlocks(doc);
    // 先卸载被替换、改写或移除的旧卡片，即便仍在生成/尚未稳定。
    manager.reconcile(false);

    if (!enabled) {
      stableSnapshot = null;
      clearSettleTimer();
      return;
    }
    if (isGenerationActive(doc)) {
      // 生成中只显示等待状态；流式截断是暂态，不能写 failed。
      manager.suspendMounted();
      manager.markPending(candidates);
      stableSnapshot = null;
      clearSettleTimer();
      return;
    }

    const current = snapshotCandidates(candidates);
    if (!sameSnapshot(stableSnapshot, current)) {
      stableSnapshot = current;
      scheduleSettleScan();
      return;
    }

    // DOM scans are debounced independently. A repeated snapshot must still
    // wait for the original stability deadline instead of mounting early.
    if (settleTimer !== null) return;

    manager.markValidating(candidates);
    const result = manager.reconcile(true);
    if (result.mounted || result.failed) {
      console.debug(`${LOG_PREFIX} lifecycle scan finished`, result);
    }
  };

  function scheduleScan(delay = debounceMs): void {
    if (!started || !settingsLoaded) return;
    clearScanTimer();
    scanTimer = win.setTimeout(() => {
      scanTimer = null;
      scan();
    }, delay);
  }

  function scheduleSettleScan(): void {
    if (!started || !settingsLoaded) return;
    clearSettleTimer();
    settleTimer = win.setTimeout(() => {
      settleTimer = null;
      clearScanTimer();
      scan();
    }, settleMs);
  }

  const handleStorageChange = (next: boolean): void => {
    if (!settingsLoaded) {
      pendingStorageValue = next;
      return;
    }
    applyEnabled(next);
  };

  const onMutations = (records: MutationRecord[]): void => {
    if (!records.some((record) => !isOwnMutation(record))) return;

    if (isGenerationActive(doc)) {
      stableSnapshot = null;
      clearSettleTimer();
    } else if (stableSnapshot !== null) {
      const current = snapshotCandidates(findGenuiBlocks(doc));
      if (!sameSnapshot(stableSnapshot, current)) {
        // Candidate changes restart the stability window immediately; unrelated
        // page mutations leave its deadline alone.
        stableSnapshot = current;
        scheduleSettleScan();
      }
    }
    scheduleScan();
  };

  const onPageHide = (): void => {
    stop();
  };

  const onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) void start();
  };

  async function start(): Promise<void> {
    if (started) return;
    started = true;
    settingsLoaded = false;
    pendingStorageValue = undefined;
    pendingUserValue = undefined;
    stableSnapshot = null;

    const Observer = win.MutationObserver;
    const nextObserver = new Observer(onMutations);
    observer = nextObserver;
    nextObserver.observe(doc.documentElement ?? doc, {
      attributes: true,
      attributeFilter: ['aria-label', 'class', 'd', 'role', 'title'],
      characterData: true,
      childList: true,
      subtree: true,
    });

    control = createToggleControl(doc, enabled, persistEnabled, {
      promptText: GENUI_PROMPT_TEXT,
      promptVersion: GENUI_PROMPT_VERSION,
    });
    augmenter = createDraftAugmenter(doc, {
      enabled,
      debounceMs: options.augmentDelayMs ?? 700,
      window: win,
      onStatus: (status) => control?.setAugmentStatus(status),
    });
    unsubscribe = store?.subscribe(handleStorageChange) ?? null;

    let saved: boolean | undefined;
    try {
      saved = await store?.loadGenuiEnabled();
    } catch (error) {
      console.warn(`${LOG_PREFIX} could not load GenUI setting; defaulting to enabled`, error);
    }
    if (!started) return;

    settingsLoaded = true;
    applyEnabled(pendingStorageValue ?? pendingUserValue ?? saved ?? true);
    pendingStorageValue = undefined;
    pendingUserValue = undefined;
    // 设置读取完成后再开始监听草稿，避免已保存为关闭的用户被短暂追加。
    augmenter?.start();
    control?.setAugmentStatus(augmenter?.getStatus() ?? null);
    scheduleScan(0);
  }

  function stop(): void {
    if (!started) return;
    started = false;
    settingsLoaded = false;
    pendingStorageValue = undefined;
    pendingUserValue = undefined;
    clearScanTimer();
    clearSettleTimer();
    observer?.disconnect();
    observer = null;
    unsubscribe?.();
    unsubscribe = null;
    augmenter?.dispose();
    augmenter = null;
    control?.dispose();
    control = null;
    gate?.dispose();
    manager.dispose();
    stableSnapshot = null;
  }

  function dispose(): void {
    stop();
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('pageshow', onPageShow);
  }

  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', onPageShow);

  return {
    start,
    stop,
    dispose,
    setEnabled: persistEnabled,
    isEnabled: () => enabled,
  };
}
