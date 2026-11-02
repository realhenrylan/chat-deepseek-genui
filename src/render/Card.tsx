import { useState } from 'react';
import type { GenuiDocument } from '../protocol/types';
import { ElementErrorBoundary } from './boundaries';
import { UnknownElementView } from './elements';
import type { ElementRegistry } from './registry';

/**
 * genui Card（阶段 2）：单个 genui 文档的完整呈现。
 *
 * 结构：header（徽标 + 可选标题）→ body（元素列表，逐个错误边界隔离）
 * → footer（查看原始 JSON 切换 + 透明说明）。
 *
 * 卡片级异常不在本组件内兜底：mountCard 在 Card 之上包一层
 * CardErrorBoundary（onFatal），由挂载方恢复原始代码块——若在 Card 内部
 * 再包一层无 onFatal 的边界，会吞掉错误导致既不回退也不告警。
 * 所有文本经 React 子节点渲染，模型字符串不作 HTML/CSS 解释。
 */

export interface CardProps {
  document: GenuiDocument;
  /** 原始代码块文本，仅用于页脚的透明度说明（原始内容本身保留在页面上）。 */
  rawJson: string;
  registry: ElementRegistry;
  /** 切换「查看原始 JSON」：showRaw=true 时挂载方恢复原始块显示。 */
  onToggleRaw?: (showRaw: boolean) => void;
}

export function Card({ document: doc, rawJson, registry, onToggleRaw }: CardProps) {
  const [showRaw, setShowRaw] = useState(false);

  const handleToggle = () => {
    const next = !showRaw;
    setShowRaw(next);
    onToggleRaw?.(next);
  };

  return (
    <section className="genui-card" data-genui-card="">
      <header className="genui-card-header">
        <span className="genui-card-badge">GenUI</span>
        {doc.title ? <h3 className="genui-card-title">{doc.title}</h3> : null}
      </header>
      <div className="genui-card-body">
        {doc.elements.map((element, index) => {
          const Component = registry.get(element.kind);
          return (
            <ElementErrorBoundary key={`${element.kind}-${index}`}>
              {Component ? (
                <Component element={element} />
              ) : (
                <UnknownElementView element={element} />
              )}
            </ElementErrorBoundary>
          );
        })}
      </div>
      <footer className="genui-card-footer">
        <button type="button" className="genui-card-toggle" onClick={handleToggle}>
          {showRaw ? '收起原始 JSON' : '查看原始 JSON'}
        </button>
        <span className="genui-card-note">
          透明增强 · 纯文本渲染 · 不执行脚本 · 原始 {rawJson.length} 字符
        </span>
      </footer>
    </section>
  );
}
