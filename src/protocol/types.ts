/**
 * genui v1 协议类型与常量（阶段 2）。
 *
 * 协议定位：模型输出中 `genui` 代码块的最小可渲染文档。设计原则见
 * docs/development-task.md 阶段 2：
 * - 显式版本号，未知版本拒绝渲染而不是猜测；
 * - 所有字段白名单（schema additionalProperties: false），防止模型输出
 *   夹带宿主无法安全处理的字段；
 * - 所有字符串长度与集合规模有上限，防止超大文档拖垮渲染。
 *
 * 失败码按「守卫顺序」排列：长度 → 深度 → JSON 解析 → 结构校验 → 版本。
 */

/** 当前支持的协议版本。 */
export const PROTOCOL_VERSION = 1;

/** 规模限制（与 schema 保持一致，validate 的长度守卫复用同一份常量）。 */
export const LIMITS = {
  /** 原始代码块文本长度上限（字符）。 */
  maxRawLength: 64 * 1024,
  /** JSON 嵌套深度上限（字符串感知的括号计数）。 */
  maxDepth: 16,
  /** elements 元素数量上限。 */
  maxElements: 50,
  /** title 长度上限。 */
  maxTitleLength: 120,
  /** 单个文本元素 value 长度上限。 */
  maxTextLength: 2000,
} as const;

/** v1 唯一支持的元素类型：纯文本。value 作为纯文本渲染，绝不作为 HTML/CSS 解释。 */
export interface TextElement {
  kind: 'text';
  value: string;
}

export type GenuiElement = TextElement;

/** 合法的 genui v1 文档（通过 parseGenui 校验后才可能存在）。 */
export interface GenuiDocument {
  type: 'genui';
  version: 1;
  title?: string;
  elements: GenuiElement[];
}

/** 解析失败码；顺序即守卫执行顺序。 */
export type GenuiFailureCode =
  | 'too-large'
  | 'too-deep'
  | 'invalid-json'
  | 'schema-violation'
  | 'unsupported-version';

export type ParseGenuiResult =
  | { ok: true; document: GenuiDocument }
  | { ok: false; code: GenuiFailureCode; detail: string };
