import { createElement } from 'react';
import type {
  ExplainElement,
  GenuiBasis,
  GenuiSource,
  GenuiV3Document,
  GenuiV3Element,
  GenuiV4Document,
  GenuiV4Element,
  GenuiV5Document,
  GenuiV5Element,
  GenuiV6Document,
  InteractiveStateValues,
  ModelTableElement,
  NoteElement,
  TableElement,
  TextElement,
} from '../protocol/types';
import { lookupCondition, lookupModel } from '../runtime/evaluate';
import type { CompositeEvaluation } from '../runtime/evaluate';
import type { TableViewState } from '../runtime/card-state';
import { ElementErrorBoundary } from './boundaries';
import { ChartElementView } from './charts';
import { UnknownElementView } from './elements';
import { InteractiveElementView } from './interactive';
import type { ElementRegistry } from './registry';
import { TableElementView } from './table';

/**
 * v3/v4/v5 组合元素递归渲染：文字/说明的条件门控 + 布局容器 + 图表/表格。
 *
 * 每个元素单独包错误边界，单个组合子树渲染失败不会拖垮整张卡片。
 * 条件计算失败时选择「继续显示内容并提示错误」，避免静默隐藏信息。
 * 表格的筛选/排序/选中项由卡片持有（而不是表格本地），这样「继续讨论」
 * 能读到与界面完全一致的视图状态。
 */

type AnyElement = GenuiV3Element | GenuiV4Element | GenuiV5Element;

export interface CompositeContext {
  document: GenuiV3Document | GenuiV4Document | GenuiV5Document | GenuiV6Document;
  evaluation: CompositeEvaluation;
  registry: ElementRegistry;
  state: InteractiveStateValues;
  drafts: Record<string, string>;
  fieldErrors: Record<string, string>;
  onValueChange: (id: string, value: number | string) => void;
  onNumberInput: (id: string, raw: string) => void;
  /** 表格筛选/排序/选中项按元素路径保存，随卡片状态一起跨重新挂载保留。 */
  tables: Record<string, TableViewState>;
  onTableChange: (path: string, view: TableViewState) => void;
  /** 每次卡片重置递增；表格据此重新挂载，清空筛选并恢复初始排序。 */
  resetToken: number;
  /** v6：根级依据旁路表与来源；旧协议为 undefined。 */
  sources?: readonly GenuiSource[];
  basis?: Readonly<Record<string, GenuiBasis>>;
  today?: string;
  editedState?: readonly string[];
  hasEdits?: boolean;
}

function ConditionError({ message }: { message: string }) {
  return (
    <p className="genui-condition-error" role="status">
      显示条件无法计算：{message}
    </p>
  );
}

function gatedVisible(
  element: TextElement | NoteElement | TableElement | ModelTableElement | ExplainElement,
  context: CompositeContext,
): { visible: boolean; error?: string } {
  if (!element.visibleIf) return { visible: true };
  const result = lookupCondition(context.evaluation, element.visibleIf);
  return result.ok ? { visible: result.value } : { visible: true, error: result.error };
}

function ExplainView({
  element,
  context,
}: {
  element: ExplainElement;
  context: CompositeContext;
}) {
  const gate = gatedVisible(element, context);
  if (!gate.visible) return null;
  const model = lookupModel(context.evaluation, element.model);
  return (
    <aside
      className="genui-explain"
      aria-label={element.title ? `${element.title}（计算依据）` : '计算依据'}
    >
      <h4 className="genui-explain-title">
        {element.title ?? (model ? `计算依据：${model.label}` : '计算依据')}
      </h4>
      {gate.error ? <ConditionError message={gate.error} /> : null}
      {!model ? (
        <p className="genui-explain-error" role="status">模型未求值</p>
      ) : !model.ok ? (
        <p className="genui-explain-error" role="status">
          无法计算：{model.error ?? '模型计算失败'}
        </p>
      ) : (
        <>
          {model.formula ? <p className="genui-explain-formula">{model.formula}</p> : null}
          {model.basis.length > 0 ? (
            <dl className="genui-explain-basis">
              {model.basis.map((item, index) => (
                <div className="genui-explain-basis-row" key={`${item.label}-${index}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {model.diagnostics.length > 0 ? (
            <ul className="genui-explain-diagnostics">
              {model.diagnostics.map((item, index) => (
                <li
                  className={`genui-explain-diagnostic genui-explain-diagnostic-${item.level}`}
                  key={`${item.level}-${index}`}
                >
                  {item.message}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </aside>
  );
}

function StaticStaleNotice({ kind }: { kind: 'text' | 'note' }) {
  return (
    <p className="genui-static-notice">
      输入已修改：这段静态{kind === 'note' ? '说明' : '文字'}按初始条件生成，可能已不对应当前结果。
    </p>
  );
}

function ElementContent({
  element,
  context,
  path,
  basisPath,
}: {
  element: AnyElement;
  context: CompositeContext;
  path: string;
  basisPath: string;
}) {
  switch (element.kind) {
    case 'explain':
      return <ExplainView element={element} context={context} />;
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
          basis={context.basis}
          basisPath={basisPath}
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
            view={context.tables[path]}
            onViewChange={(view) => context.onTableChange(path, view)}
            sources={context.sources}
            basis={context.basis}
            basisPath={basisPath}
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
            <ElementList
              elements={element.children}
              context={context}
              path={`${path}-section`}
              basisPath={basisPath}
            />
          </div>
        </section>
      );
    case 'columns':
      return (
        <div className="genui-columns" data-columns={element.columns.length}>
          {element.columns.map((column, index) => (
            <div className="genui-column" key={`${path}-col-${index}`}>
              <ElementList
                elements={column}
                context={context}
                path={`${path}-col-${index}`}
                basisPath={`${basisPath}.${index}`}
              />
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
          models={context.evaluation.models}
          drafts={context.drafts}
          fieldErrors={context.fieldErrors}
          onValueChange={context.onValueChange}
          onNumberInput={context.onNumberInput}
          sources={context.sources}
          basis={context.basis}
          basisPath={basisPath}
          today={context.today}
          editedState={context.editedState}
        />
      );
  }
}

export function ElementList({
  elements,
  context,
  path,
  basisPath,
}: {
  elements: AnyElement[];
  context: CompositeContext;
  path: string;
  basisPath: string;
}) {
  return (
    <>
      {elements.map((element, index) => (
        <ElementErrorBoundary key={`${path}-${index}-${element.kind}`}>
          <ElementContent
            element={element}
            context={context}
            path={`${path}-${index}`}
            basisPath={`${basisPath}${basisPath === '' ? '' : '.'}${index}`}
          />
        </ElementErrorBoundary>
      ))}
    </>
  );
}

export function CompositeElementsView({ context }: { context: CompositeContext }) {
  return (
    <ElementList elements={context.document.elements} context={context} path="root" basisPath="" />
  );
}
