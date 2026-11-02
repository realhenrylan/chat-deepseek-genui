import type { TextElement } from '../protocol/types';

/**
 * genui 元素视图（阶段 2）。
 *
 * 硬约束（development-guide §2）：模型输出的字符串只作为 React 文本子节点
 * 渲染，绝不经过 dangerouslySetInnerHTML / innerHTML，因此 <script>、
 * <img onerror> 等内容只会以字面文本呈现。
 */

/** v1 唯一元素：纯文本。 */
export function TextElementView({ element }: { element: TextElement }) {
  return <p className="genui-text">{element.value}</p>;
}

/** 注册表缺失 kind 时的占位（防御层：协议演进或注册遗漏时不崩溃）。 */
export function UnknownElementView({ element }: { element: { kind: string } }) {
  return <p className="genui-unknown">暂不支持的元素类型：{element.kind}</p>;
}
