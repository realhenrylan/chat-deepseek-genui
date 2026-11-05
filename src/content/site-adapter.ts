/**
 * 站点适配层（issue #9）。
 *
 * 所有对 DeepSeek 页面结构的认识集中在这里：回答容器、代码块与语言标签、
 * 聊天输入框、生成状态、会话与账号标记、消息键。渲染、卡片状态、计算与
 * 方案逻辑不直接依赖这些选择器；站点改版时优先只改本文件。
 *
 * 选择器证据来自 docs/compatibility-investigation.md §3–§5 的真实网页观察。
 * 站点哈希类名（如 `span.d813de27`）可能轮换，因此标签识别以「文本恰好为
 * genui」为准并保留 banner 叶子节点回退。
 */

/** AI 回复容器选择器（阶段 0 实测）。 */
export const ASSISTANT_SELECTOR = 'div.ds-assistant-message-main-content';
/** 代码块根节点选择器。 */
export const CODE_BLOCK_SELECTOR = 'div.md-code-block';
/** 代码块 banner 容器；标签精确类名失配时在其内部回退扫描。 */
export const CODE_BLOCK_BANNER_SELECTOR = 'div.md-code-block-banner-wrap';
/** 语言标签精确选择器（站点哈希类名，可能轮换）。 */
export const LANGUAGE_LABEL_SELECTOR = 'span.d813de27';
/** 语言标签必须完全等于该文本（区分大小写）。 */
export const GENUI_LABEL = 'genui';
/** 2026-11-02 真实调查记录的 DeepSeek「停止生成」图标路径前缀。 */
export const STOP_GENERATION_PATH_PREFIX = 'M2 4.88C2 3.68009';
/** 停止按钮的语义标签与 tooltip 文本。 */
export const STOP_GENERATION_LABEL = '停止生成';
/** 聊天输入框的确定标记：name=search，回退 placeholder 含该文案。 */
export const CHAT_INPUT_NAME = 'search';
export const CHAT_INPUT_PLACEHOLDER_HINT = '发送消息';
/** 会话路由；其他路由（首页、发现等）一律视为未知会话。 */
export const SESSION_ROUTE = /^\/a\/chat\/s\/([^/]+)\/?$/;
/** 会话所属的聊天路由前缀，仅用于诊断中的页面归类。 */
const CHAT_ROUTE = /^\/a\/chat(?:\/|$)/;
/** 无法确认会话时的占位值。 */
export const UNKNOWN_SESSION_ID = 'unknown-session';

const VIRTUAL_ITEM_ATTR = 'data-virtual-list-item-key';
const MESSAGE_ID_ATTR = 'data-message-id';
const ACCOUNT_MARKERS: Array<{ selector: string; attribute: string }> = [
  { selector: '[data-user-id]', attribute: 'data-user-id' },
  { selector: '[data-account-id]', attribute: 'data-account-id' },
  { selector: 'meta[name="user-id"]', attribute: 'content' },
  { selector: 'meta[name="account-id"]', attribute: 'content' },
];

/** 一个被识别为 genui 的代码块候选。 */
export interface GenuiBlockCandidate {
  /** 所属 AI 回复容器。 */
  container: Element;
  /** 代码块根 div.md-code-block。 */
  block: HTMLElement;
  /** 代码内容 pre；结构异常时为 null（解析阶段按失败回退处理）。 */
  pre: HTMLPreElement | null;
  /** 标签命中方式：primary=精确类名；fallback=叶子节点回退。 */
  labelSource: 'primary' | 'fallback';
}

/**
 * 适配层自检结果：只输出数量与布尔值，不包含任何聊天文本、草稿或账号标识。
 * 用于本地诊断导出与站点改版后的快速定位。
 */
export type SiteAdapterProbe = {
  assistantContainers: number;
  codeBlocks: number;
  labelledBlocks: number;
  /** 带 genui 标签、但找不到所属回答容器的代码块数：容器识别失效的强信号。 */
  labelledBlocksOutsideContainers: number;
  candidates: number;
  candidatesWithPre: number;
  /** 通过标记匹配、且未被隐藏/停用的输入框数量；用于区分缺失与歧义。 */
  inputCandidates: number;
  inputFound: boolean;
  generationActive: boolean;
  route: 'chat' | 'other';
};

/** 站点稳定消息键；缺少站点标记时返回 null，由身份层退回文本指纹。 */
export interface SiteMessageKey {
  key: string;
  stable: boolean;
}

/** 统一站点适配接口；页面结构差异只应影响实现，不影响上层模块。 */
export interface SiteAdapter {
  /** 适配器标识，用于诊断导出（不含账号或站点内容）。 */
  readonly id: string;
  /** 选择器快照版本；站点复核后随适配器实现一起更新。 */
  readonly version: string;
  findAssistantContainers(root: ParentNode): Element[];
  findCandidates(root: ParentNode): GenuiBlockCandidate[];
  findChatInput(doc: Document): HTMLTextAreaElement | null;
  isGenerationActive(doc: Document): boolean;
  readSessionId(doc: Document): string;
  readAccountId(doc: Document): string;
  /**
   * 导航键：路由 + 会话 + 账号的轻量摘要。控制器轮询它感知 SPA
   * pushState 的纯路由切换（不依赖 DOM 变更，也不改写页面 history）。
   */
  readNavigationKey(doc: Document): string;
  readMessageKey(container: Element): SiteMessageKey | null;
  probe(doc: Document): SiteAdapterProbe;
}

function readTrimmedAttribute(element: Element | null, name: string): string {
  return element?.getAttribute(name)?.trim() ?? '';
}

function labelMatches(node: Element): boolean {
  return (node.textContent ?? '').trim() === GENUI_LABEL;
}

/**
 * 解析语言标签。优先精确类名 span.d813de27；类名轮换时回退为扫描
 * banner 内文本恰好为 genui 的叶子节点（复制按钮等文本节点不匹配）。
 */
function resolveLabel(block: Element): 'primary' | 'fallback' | null {
  const scope = block.querySelector(CODE_BLOCK_BANNER_SELECTOR) ?? block;

  const primary = scope.querySelector(LANGUAGE_LABEL_SELECTOR);
  if (primary && labelMatches(primary)) {
    return 'primary';
  }
  for (const node of scope.querySelectorAll('*')) {
    if (node.children.length === 0 && labelMatches(node)) {
      return 'fallback';
    }
  }
  return null;
}

function isUsableChatInput(element: HTMLTextAreaElement): boolean {
  if (element.disabled || element.readOnly) return false;
  if (element.hidden || (element.getAttribute('aria-hidden') ?? '').trim() === 'true') return false;
  if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  if (element.style.display === 'none' || element.style.visibility === 'hidden') return false;
  // Chrome 105+ 能识别样式表隐藏的旧输入框；jsdom 无此 API 时保持结构判断。
  const checkVisibility = (
    element as HTMLTextAreaElement & { checkVisibility?: (options?: object) => boolean }
  ).checkVisibility;
  if (typeof checkVisibility === 'function') {
    try {
      if (!checkVisibility.call(element, { checkVisibilityCSS: true, checkOpacity: true })) {
        return false;
      }
    } catch {
      // 兼容旧实现的参数差异：无法判断时按可用处理，仍由唯一性约束兜底。
    }
  }
  return true;
}

function collectChatInputCandidates(doc: Document): HTMLTextAreaElement[] {
  const matched = new Set<HTMLTextAreaElement>();
  for (const named of doc.querySelectorAll<HTMLTextAreaElement>(
    `textarea[name="${CHAT_INPUT_NAME}"]`,
  )) {
    matched.add(named);
  }
  for (const textarea of doc.querySelectorAll<HTMLTextAreaElement>('textarea')) {
    if ((textarea.getAttribute('placeholder') ?? '').includes(CHAT_INPUT_PLACEHOLDER_HINT)) {
      matched.add(textarea);
    }
  }
  return [...matched].filter(isUsableChatInput);
}

function collectCandidates(root: ParentNode): GenuiBlockCandidate[] {
  const found: GenuiBlockCandidate[] = [];
  for (const container of root.querySelectorAll(ASSISTANT_SELECTOR)) {
    for (const block of container.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR)) {
      const labelSource = resolveLabel(block);
      if (!labelSource) {
        continue;
      }
      found.push({
        container,
        block,
        pre: block.querySelector<HTMLPreElement>('pre'),
        labelSource,
      });
    }
  }
  return found;
}

/**
 * DeepSeek 网页适配器。所有站点选择器只出现在本对象及其模块常量中；
 * 未确认的控件（例如没有 name/placeholder 标记的 textarea）一律不猜。
 */
export const DEEPSEEK_SITE_ADAPTER: SiteAdapter = {
  id: 'deepseek-chat',
  version: '2026-11-02',

  findAssistantContainers(root) {
    return Array.from(root.querySelectorAll(ASSISTANT_SELECTOR));
  },

  findCandidates(root) {
    return collectCandidates(root);
  },

  findChatInput(doc) {
    // 只认取证到的标记；候选必须唯一且可用，否则返回 null，绝不猜第一个。
    const candidates = collectChatInputCandidates(doc);
    return candidates.length === 1 ? candidates[0] : null;
  },

  isGenerationActive(doc) {
    const buttons = doc.querySelectorAll<HTMLElement>('button, [role="button"]');
    for (const button of buttons) {
      const label = `${button.getAttribute('aria-label') ?? ''} ${button.getAttribute('title') ?? ''}`;
      if (label.includes(STOP_GENERATION_LABEL)) return true;
      if (button.querySelector(`svg path[d^="${STOP_GENERATION_PATH_PREFIX}"]`)) return true;
    }

    // 实测停止按钮悬停后会显示此 tooltip；它只作为辅助信号。
    for (const tooltip of doc.querySelectorAll('div.ds-tooltip')) {
      if ((tooltip.textContent ?? '').trim() === STOP_GENERATION_LABEL) return true;
    }
    return false;
  },

  readSessionId(doc) {
    const pathname = doc.location?.pathname?.trim() ?? '';
    const match = SESSION_ROUTE.exec(pathname);
    return match ? `/a/chat/s/${match[1]}` : UNKNOWN_SESSION_ID;
  },

  readAccountId(doc) {
    for (const marker of ACCOUNT_MARKERS) {
      const element = doc.querySelector(marker.selector);
      const value = readTrimmedAttribute(element, marker.attribute);
      if (value) return value;
    }
    return '';
  },

  readNavigationKey(doc) {
    const pathname = doc.location?.pathname?.trim() ?? '';
    return `${pathname}|${this.readSessionId(doc)}|${this.readAccountId(doc)}`;
  },

  readMessageKey(container) {
    const virtualKey = readTrimmedAttribute(
      container.closest(`[${VIRTUAL_ITEM_ATTR}]`),
      VIRTUAL_ITEM_ATTR,
    );
    if (virtualKey) return { key: `vl:${virtualKey}`, stable: true };

    const messageId = readTrimmedAttribute(
      container.closest(`[${MESSAGE_ID_ATTR}]`),
      MESSAGE_ID_ATTR,
    );
    if (messageId) return { key: `mid:${messageId}`, stable: true };

    return null;
  },

  probe(doc) {
    const containers = doc.querySelectorAll(ASSISTANT_SELECTOR);
    let codeBlocks = 0;
    let labelledBlocks = 0;
    let candidatesWithPre = 0;
    let labelledBlocksOutsideContainers = 0;
    for (const container of containers) {
      for (const block of container.querySelectorAll(CODE_BLOCK_SELECTOR)) {
        codeBlocks += 1;
        if (!resolveLabel(block)) continue;
        labelledBlocks += 1;
        if (block.querySelector('pre')) candidatesWithPre += 1;
      }
    }
    // 标签存在但容器识别失败：站点改版的典型症状，供诊断单独计数。
    for (const block of doc.querySelectorAll(CODE_BLOCK_SELECTOR)) {
      if (block.closest(ASSISTANT_SELECTOR) || !resolveLabel(block)) continue;
      labelledBlocksOutsideContainers += 1;
    }

    const pathname = doc.location?.pathname?.trim() ?? '';
    const inputCandidates = collectChatInputCandidates(doc).length;
    return {
      assistantContainers: containers.length,
      codeBlocks,
      labelledBlocks,
      labelledBlocksOutsideContainers,
      candidates: labelledBlocks,
      candidatesWithPre,
      inputCandidates,
      inputFound: inputCandidates === 1,
      generationActive: this.isGenerationActive(doc),
      route: CHAT_ROUTE.test(pathname) ? 'chat' : 'other',
    };
  },
};
