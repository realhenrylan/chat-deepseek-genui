import { LOG_PREFIX, resolveContentVersion } from './lifecycle';
import { createEnhancementManager, type EnhanceOptions } from './enhance';
import { createViewportGateAdapter, type ViewportGateAdapter } from './viewport-gate';
import { findGenuiBlocks, type GenuiBlockCandidate } from './detect';
import { DEEPSEEK_SITE_ADAPTER, type SiteAdapter } from './site-adapter';
import { createExtensionSettingsStore, type ExtensionSettingsStore } from './settings';
import { createToggleControl, type ToggleControl } from './toggle';
import { createDraftAugmenter, type DraftAugmenter } from './augment';
import { fillContinueIntoInput } from './followup';
import { deliverRepairRequest } from './repair';
import {
  createDiagnosticRecorder,
  summarizeDiagnostics,
  type DiagnosticRecorder,
  type DiagnosticsSnapshot,
} from '../runtime/diagnostics';
import {
  GENUI_PLAIN_PROMPT_NOTE,
  GENUI_PROMPT_TEXT,
  GENUI_PROMPT_VERSION,
  GENUI_TOOL_PROMPT_TEXT,
} from './prompt';

/** 停止图标路径前缀由适配层维护；控制器保留导出以兼容既有测试与文档。 */
export { STOP_GENERATION_PATH_PREFIX } from './site-adapter';

export interface PageLifecycleOptions extends EnhanceOptions {
  /** 单元测试注入；生产环境自动使用 chrome.storage.local。 */
  store?: ExtensionSettingsStore | null;
  /** DOM 变更合并时间；生产默认 100ms。 */
  debounceMs?: number;
  /** 生成结束后的稳定等待时间；生产默认 700ms。 */
  settleMs?: number;
  /** 草稿停止输入后追加默认增强的等待时间；生产默认 700ms。 */
  augmentDelayMs?: number;
  /** 轮询路由/会话键的间隔，用于感知 SPA 纯 pushState 导航；生产默认 1000ms。 */
  navigationPollMs?: number;
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
 * 生成状态信号：委托站点适配层（停止按钮语义属性、取证图标路径、tooltip）。
 * 页面改版只影响适配层实现，不改变生命周期判断逻辑。
 */
export function isGenerationActive(
  doc: Document,
  adapter: SiteAdapter = DEEPSEEK_SITE_ADAPTER,
): boolean {
  return adapter.isGenerationActive(doc);
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

  // 适配层与诊断记录器：页面结构差异收敛到 adapter，诊断只记录脱敏信号。
  const adapter = options.adapter ?? DEEPSEEK_SITE_ADAPTER;
  const recorder: DiagnosticRecorder = options.diagnostics ?? createDiagnosticRecorder();

  // 视口门控：块首次进入视口前不把瞬时解析失败当真实失败；进入后立即重扫。
  const gate: ViewportGateAdapter | null =
    options.enableViewportGate === true ? createViewportGateAdapter(win, () => scheduleScan(0)) : null;

  // 输入框识别失败（缺失或歧义）统一进入诊断；继续讨论/修复请求也走这里。
  const handleInputFailure = (): void => {
    const probe = adapter.probe(doc);
    recorder.record('detection', probe.inputCandidates > 1 ? 'input-ambiguous' : 'no-input');
  };

  // 默认投递路径也使用控制器选定的适配器；调用方显式注入回调时尊重其实现，
  // 但仍观察 no-input 结果，避免诊断与实际输入识别分叉。
  const continueInto = (summary: string): ReturnType<NonNullable<EnhanceOptions['onContinue']>> => {
    const deliver =
      options.onContinue ?? ((text: string) => fillContinueIntoInput(doc, text, adapter));
    const result = deliver(summary);
    if (result === 'no-input') handleInputFailure();
    return result;
  };
  const repairInto = async (
    prompt: string,
  ): Promise<Awaited<ReturnType<NonNullable<EnhanceOptions['onRepairRequest']>>>> => {
    const deliver =
      options.onRepairRequest ?? ((text: string) => deliverRepairRequest(doc, text, adapter));
    const result = await deliver(prompt);
    // copied/copy-failed 表示找不到输入框后走了剪贴板退路，同样属于识别失败。
    if (result === 'copied' || result === 'copy-failed') handleInputFailure();
    return result;
  };

  const managerOptions: EnhanceOptions = {
    ...options,
    adapter,
    diagnostics: recorder,
    onContinue: continueInto,
    onRepairRequest: repairInto,
    ...(gate ? { isBlockUnverifiable: gate.isBlockUnverifiable } : {}),
  };
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
  let navigationKey = '';
  let navigationTimer: number | null = null;

  /**
   * 当前页面的脱敏诊断快照：适配层自检只含数量/布尔值，页面段只含
   * 路由归类与候选/挂载计数；不读取聊天文本、草稿或账号。
   */
  function buildDiagnostics(): DiagnosticsSnapshot {
    const probe = adapter.probe(doc);
    const { route, ...counts } = probe;
    const { mounted, failed } = manager.counts();
    return recorder.snapshot({
      extensionVersion: resolveContentVersion(),
      adapter: { id: adapter.id, version: adapter.version, probe: counts },
      page: { route, candidates: probe.candidates, mounted, failed },
    });
  }

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

    const candidates = findGenuiBlocks(doc, adapter);
    // 页面上已有 genui 标签却找不到任何回答容器：站点改版导致识别失效的强信号。
    // 仅在这种情况下做一次自检，避免正常聊天页每次扫描都记录。
    if (
      candidates.length === 0 &&
      adapter.findAssistantContainers(doc).length === 0 &&
      adapter.probe(doc).labelledBlocksOutsideContainers > 0
    ) {
      recorder.record('detection', 'no-assistant-container');
    }
    // 先卸载被替换、改写或移除的旧卡片，即便仍在生成/尚未稳定。
    manager.reconcile(false);

    if (!enabled) {
      stableSnapshot = null;
      clearSettleTimer();
      return;
    }
    if (isGenerationActive(doc, adapter)) {
      // 生成中只显示等待状态；流式截断是暂态，不能写 failed。
      // 只撤下当前正在生成的回复内卡片，历史回答的已挂载卡片保持不变。
      const containers = adapter.findAssistantContainers(doc);
      const activeContainer = containers[containers.length - 1];
      const hasActiveBlock =
        activeContainer !== undefined &&
        candidates.some((candidate) => activeContainer.contains(candidate.block));
      if (hasActiveBlock) manager.suspendMounted(activeContainer);
      manager.markPending(candidates);
      if (candidates.length > 0) recorder.record('waiting', 'streaming');
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

    if (isGenerationActive(doc, adapter)) {
      stableSnapshot = null;
      clearSettleTimer();
    } else if (stableSnapshot !== null) {
      const current = snapshotCandidates(findGenuiBlocks(doc, adapter));
      if (!sameSnapshot(stableSnapshot, current)) {
        // Candidate changes restart the stability window immediately; unrelated
        // page mutations leave its deadline alone.
        recorder.record('waiting', 'settling');
        stableSnapshot = current;
        scheduleSettleScan();
      }
    }
    scheduleScan();
  };

  /** SPA 纯路由切换不会触发 DOM 变更；轮询导航键并立即重扫。 */
  const checkNavigation = (): void => {
    if (!started) return;
    const next = adapter.readNavigationKey(doc);
    if (next === navigationKey) return;
    navigationKey = next;
    stableSnapshot = null;
    clearSettleTimer();
    // 先撤销旧身份绑定，避免生成中/等待稳定期间旧会话卡片继续展示。
    manager.suspendMounted();
    scheduleScan(0);
  };

  const onPopState = (): void => {
    checkNavigation();
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
      promptTexts: {
        auto: GENUI_PROMPT_TEXT,
        tool: GENUI_TOOL_PROMPT_TEXT,
        plain: GENUI_PLAIN_PROMPT_NOTE,
      },
      promptVersion: GENUI_PROMPT_VERSION,
      onModeSelect: (mode) => augmenter?.setMode(mode),
      diagnostics: {
        summary: () => summarizeDiagnostics(buildDiagnostics()),
        preview: () => JSON.stringify(buildDiagnostics(), null, 2),
      },
    });
    augmenter = createDraftAugmenter(doc, {
      enabled,
      adapter,
      debounceMs: options.augmentDelayMs ?? 700,
      window: win,
      onStatus: (status) => {
        control?.setAugmentStatus(status);
        if (status === 'no-input') handleInputFailure();
      },
      onModeChange: (mode) => control?.setAugmentMode(mode),
      onPlainNote: (note) => control?.setAugmentPlainNote(note),
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
    // 启动时增强器只报 idle；在聊天路由上主动检查一次，覆盖输入框缺失/歧义。
    if (enabled) {
      const probe = adapter.probe(doc);
      if (probe.route === 'chat' && !probe.inputFound) handleInputFailure();
    }
    navigationKey = adapter.readNavigationKey(doc);
    win.addEventListener('popstate', onPopState);
    win.addEventListener('hashchange', onPopState);
    navigationTimer = win.setInterval(checkNavigation, options.navigationPollMs ?? 1000);
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
    if (navigationTimer !== null) {
      win.clearInterval(navigationTimer);
      navigationTimer = null;
    }
    win.removeEventListener('popstate', onPopState);
    win.removeEventListener('hashchange', onPopState);
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
    /** 供诊断面板/测试读取的脱敏快照。 */
    buildDiagnostics,
  };
}
