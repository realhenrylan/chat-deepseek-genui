import { createElement } from 'react';
import type {
  GenuiSource,
  GenuiV3Document,
  GenuiV3Element,
  GenuiV4Document,
  GenuiV4Element,
  InteractiveStateValues,
  NoteElement,
  TableElement,
  TextElement,
} from '../protocol/types';
import { lookupCondition } from '../runtime/evaluate';
import type { CompositeEvaluation } from '../runtime/evaluate';
import { ElementErrorBoundary } from './boundaries';
import { ChartElementView } from './charts';
import { UnknownElementView } from './elements';
import { InteractiveElementView } from './interactive';
import type { ElementRegistry } from './registry';
import { TableElementView } from './table';

/**
 * v3 组合元素递归渲染：文字/说明的条件门控 + 布局容器 + 图表/表格。
 *
 * 每个元素单独包错误边界，单个组合子树渲染失败不会拖垮整张卡片。
 * 条件计算失败时选择「继续显示内容并提示错误」，避免静默隐藏信息。
 */

export interface CompositeContext {
  document: GenuiV3Document | GenuiV4Document;
  evaluation: CompositeEvaluation;
  registry: ElementRegistry;
  state: InteractiveStateValues;
  drafts: Record<string, string>;
  fieldErrors: Record<string, string>;
  /** v4 声明的来源与「今天」，用于依据徽标与过期提示；v3 为空。 */
  sources: GenuiSource[];
  today: string;
  /** 已被用户修改的状态 id；静态文字/说明据此提示可能过时。 */
  editedState?: readonly string[];
  hasEdits?: boolean;
  onValueChange: (id: string, value: number | string) => void;
  onNumberInput: (id: string, raw: string) => void;
  /** 每次卡片重置递增；表格据此重新挂载，清空筛选并恢复初始排序。 */
  resetToken: number;
}

function ConditionError({ message }: { message: string }) {
  return (
    <p className="genui-condition-error" role="status">
      显示条件无法计算：{message}
    </p>
  );
}

/**
 * 静态文字/说明由模型按初始条件生成，插件无法判断其中是否写死了旧结果。
 * 一旦用户改过输入，就明确提示它们可能已过时，避免静态说明冒充当前结论。
 */
function StaticStaleNotice({ kind }: { kind: 'text' | 'note' }) {
  return (
    <p className="genui-static-notice">
      输入已修改：这段静态{kind === 'note' ? '说明' : '文字'}按初始条件生成，可能已不对应当前结果。
    </p>
  );
}

function gatedVisible(
  element: TextElement | NoteElement | TableElement,
  context: CompositeContext,
): { visible: boolean; error?: string } {
  if (!element.visibleIf) return { visible: true };
  const result = lookupCondition(context.evaluation, element.visibleIf);
  return result.ok ? { visible: result.value } : { visible: true, error: result.error };
}

function ElementContent({
  element,
  context,
  path,
}: {
  element: GenuiV3Element | GenuiV4Element;
  context: CompositeContext;
  path: string;
}) {
  switch (element.kind) {
    case 'text': {
      const gate = gatedVisible(element, context);
      if (!gate.visible) return null;
      const Component = context.registry.get('text');
      return (
        <>
          {gate.error ? <ConditionError message={gate.error} /> : null}
          {context.hasEdits ? <StaticStaleNotice kind="text" /> : null}
          {Component ? createElement(Component, { element }) : <UnknownElementView element={element} />}
        </>
      );
    }
    case 'note': {
      const gate = gatedVisible(element, context);
      if (!gate.visible) return null;
      return (
        <>
          {gate.error ? <ConditionError message={gate.error} /> : null}
          {context.hasEdits ? <StaticStaleNotice kind="note" /> : null}
          <div
            className={`genui-note genui-note-${element.tone ?? 'info'}`}
            role={element.tone === 'error' ? 'alert' : undefined}
          >
            {element.text}
          </div>
        </>
      );
    }
    case 'chart':
      return (
        <ChartElementView
          element={element}
          evaluation={context.evaluation}
          sources={context.sources}
          today={context.today}
        />
      );
    case 'table': {
      const gate = gatedVisible(element, context);
      if (!gate.visible) return null;
      return (
        <>
          {gate.error ? <ConditionError message={gate.error} /> : null}
          <TableElementView
            key={context.resetToken}
            element={element}
            evaluation={context.evaluation}
            sources={context.sources}
            today={context.today}
          />
        </>
      );
    }
    case 'section':
      return (
        <section className="genui-section">
          {element.title ? <h4 className="genui-section-title">{element.title}</h4> : null}
          <div className="genui-section-body">
            <ElementList elements={element.children} context={context} path={`${path}-section`} />
          </div>
        </section>
      );
    case 'columns':
      return (
        <div className="genui-columns" data-columns={element.columns.length}>
          {element.columns.map((column, index) => (
            <div className="genui-column" key={`${path}-col-${index}`}>
              <ElementList elements={column} context={context} path={`${path}-col-${index}`} />
            </div>
          ))}
        </div>
      );
    default:
      return (
        <InteractiveElementView
          document={context.document}
          element={element}
          state={context.state}
          calculation={context.evaluation.derived}
          drafts={context.drafts}
          fieldErrors={context.fieldErrors}
          sources={context.sources}
          today={context.today}
          onValueChange={context.onValueChange}
          onNumberInput={context.onNumberInput}
        />
      );
  }
}

export function ElementList({
  elements,
  context,
  path,
}: {
  elements: Array<GenuiV3Element | GenuiV4Element>;
  context: CompositeContext;
  path: string;
}) {
  return (
    <>
      {elements.map((element, index) => (
        <ElementErrorBoundary key={`${path}-${index}-${element.kind}`}>
          <ElementContent element={element} context={context} path={`${path}-${index}`} />
        </ElementErrorBoundary>
      ))}
    </>
  );
}

export function CompositeElementsView({ context }: { context: CompositeContext }) {
  return <ElementList elements={context.document.elements} context={context} path="root" />;
}
