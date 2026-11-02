/**
 * genui 代码块识别（阶段 2）。
 *
 * 规则完全来自阶段 0 真实调查（docs/compatibility-investigation.md §3.2–3.3）：
 * - 只扫描 AI 回复容器 `div.ds-assistant-message-main-content`；用户消息
 *   `div.ds-message` 与其无嵌套关系，天然被排除（不处理用户消息）；
 * - 代码块 `div.md-code-block` 的语言标签位于 banner 内 `span.d813de27`；
 *   类名是站点哈希、可能轮换，因此以「文本恰好为 genui」为准，并在
 *   精确类名失配时回退到 banner 内叶子节点扫描；
 * - 标签文本必须 trim 后等于 'genui'：json / python / 无标签一律跳过，
 *   即使内容看起来像 genui 协议（调查实测存在 json 标签 + genui 内容的
 *   反例，按规则不处理）。
 *
 * 本模块只负责「找到候选」，不解析、不挂载、不修改页面。
 */

/** AI 回复容器选择器（阶段 0 实测）。 */
export const ASSISTANT_SELECTOR = 'div.ds-assistant-message-main-content';
/** 语言标签精确选择器（阶段 0 实测，站点哈希类名，可能轮换）。 */
export const LANGUAGE_LABEL_SELECTOR = 'span.d813de27';
/** 语言标签必须完全等于该文本（区分大小写）。 */
export const GENUI_LABEL = 'genui';

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

function labelMatches(node: Element): boolean {
  return (node.textContent ?? '').trim() === GENUI_LABEL;
}

/**
 * 解析语言标签。优先精确类名 span.d813de27；类名轮换时回退为扫描
 * banner 内文本恰好为 genui 的叶子节点（复制按钮等文本节点不匹配）。
 */
function resolveLabel(block: Element): 'primary' | 'fallback' | null {
  const scope = block.querySelector('div.md-code-block-banner-wrap') ?? block;

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

/** 在给定根节点（通常是 document）内找出所有 genui 代码块，按文档顺序返回。 */
export function findGenuiBlocks(root: ParentNode): GenuiBlockCandidate[] {
  const found: GenuiBlockCandidate[] = [];
  for (const container of root.querySelectorAll(ASSISTANT_SELECTOR)) {
    for (const block of container.querySelectorAll<HTMLElement>('div.md-code-block')) {
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
