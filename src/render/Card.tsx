import { useId, useMemo, useState } from 'react';
import type {
  DerivedCalculation,
  GenuiDocument,
  InteractiveElement,
  InteractiveStateValues,
  StateVariable,
  TextElement,
} from '../protocol/types';
import { isStepAligned } from '../protocol/step';
import { hasOwn } from '../runtime/records';
import {
  calculateDerived,
  createInitialState,
  evaluateComposite,
  type CompositeEvaluation,
} from '../runtime/evaluate';
import { ElementErrorBoundary } from './boundaries';
import { CompositeElementsView } from './composite';
import { UnknownElementView } from './elements';
import { formatNumber } from './format';
import { InteractiveElementView } from './interactive';
import type { ElementRegistry } from './registry';
import { buildContinueSummary } from './summarize';
import { getBrandMarkUrl } from '../branding';

/**
 * 一个 GenUI 文档的样式隔离卡片。v1 渲染静态内容；v2 的状态、控件与派生
 * 计算留在组件树内；v3 在 v2 基础上增加布局、条件说明、图表与表格；
 * v4 在 v3 基础上增加函数曲线系列（采样在求值快照内完成）。
 */
/** 「继续讨论」填充结果 → 卡片反馈文案（固定子串供测试与一致性依赖）。 */
const CONTINUE_FEEDBACK: Record<
  'filled' | 'appended' | 'no-input' | 'unavailable',
  string
> = {
  filled: '已填入输入框；发送由你完成。',
  appended: '草稿已保留：已在草稿后追加继续讨论摘要，发送由你完成。',
  'no-input': '未找到聊天输入框，未能带入当前条件。',
  unavailable: '继续讨论目标未接入，未能带入当前条件。',
};

export interface CardProps {
  document: GenuiDocument;
  /** 原始代码块文本，仅用于页脚的透明度说明（原始内容本身保留在页面上）。 */
  rawJson: string;
  registry: ElementRegistry;
  /** 切换「查看原始 JSON」：showRaw=true 时挂载方恢复原始块显示。 */
  onToggleRaw?: (showRaw: boolean) => void;
  /**
   * 「继续讨论」（阶段 6，用户主动点击）：输入当前条件与结果的纯文本摘要，
   * 由挂载方决定去向（生产为聊天输入框填充）。未接线时点击给出
   * 「未接入」反馈，且绝不自动发送。
   */
  onContinue?: (summary: string) => 'filled' | 'appended' | 'no-input' | 'unavailable';
}

const EMPTY_CALCULATION: DerivedCalculation = { values: {}, errors: {}, operations: 0 };

export function Card({ document: doc, rawJson, registry, onToggleRaw, onContinue }: CardProps) {
  const brandMarkUrl = getBrandMarkUrl();
  const [showRaw, setShowRaw] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [followupFeedback, setFollowupFeedback] = useState<string | null>(null);
  const [state, setState] = useState<InteractiveStateValues>(() =>
    doc.version === 1 ? {} : createInitialState(doc),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // 表格的筛选/排序是视图本地状态，重置时通过该计数器强制重新挂载。
  const [resetToken, setResetToken] = useState(0);
  const bodyId = useId();

  const evaluation = useMemo<CompositeEvaluation | null>(
    () => (doc.version === 3 || doc.version === 4 ? evaluateComposite(doc, state) : null),
    [doc, state],
  );
  const calculation = useMemo<DerivedCalculation>(() => {
    if (doc.version === 2) return calculateDerived(doc, state);
    if (doc.version === 3 || doc.version === 4) return evaluation?.derived ?? EMPTY_CALCULATION;
    return EMPTY_CALCULATION;
  }, [doc, state, evaluation]);

  const findVariable = (id: string): StateVariable | undefined =>
    doc.version === 1 ? undefined : doc.state.find((item) => item.id === id);

  const handleToggle = () => {
    const next = !showRaw;
    setShowRaw(next);
    onToggleRaw?.(next);
  };

  // 阶段 6：展开/收起只切 visibility（hidden 属性），React 树不卸载，
  // 控件值、草稿、错误与重置计数全部保留；重置不改动展开状态。
  const handleExpand = () => {
    setExpanded((previous) => !previous);
    // 收起视图不提供继续讨论入口；重新展开时保持既有反馈文本即可。
  };

  // 阶段 6：用户主动触发「继续讨论」——只生成摘要并交给挂载方，
  // 绝不自动发送；未接线时也给出如实反馈。
  const handleContinue = () => {
    if (doc.version === 1) return;
    const summary = buildContinueSummary({
      title: doc.title,
      state: doc.state,
      derived: doc.derived,
      stateValues: state,
      derivedValues: calculation.values,
      derivedErrors: calculation.errors,
    });
    setFollowupFeedback(CONTINUE_FEEDBACK[onContinue?.(summary) ?? 'unavailable']);
  };

  const clearFieldError = (id: string) => {
    setFieldErrors((previous) => {
      if (!hasOwn(previous, id)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  const handleValueChange = (id: string, value: number | string) => {
    const variable = findVariable(id);
    if (!variable) return;
    if (variable.kind === 'number') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < variable.min ||
        value > variable.max ||
        !isStepAligned(value, variable.min, variable.step)
      ) {
        setFieldErrors((previous) => ({
          ...previous,
          [id]: '输入超出允许范围或步长；当前状态值未更改。',
        }));
        return;
      }
    } else if (typeof value !== 'string' || !variable.options.some((option) => option.value === value)) {
      setFieldErrors((previous) => ({
        ...previous,
        [id]: '选择值不在允许选项中；当前状态值未更改。',
      }));
      return;
    }

    setState((previous) => ({ ...previous, [id]: value }));
    clearFieldError(id);
    setDrafts((previous) => {
      if (!hasOwn(previous, id)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  const handleNumberInput = (id: string, raw: string) => {
    setDrafts((previous) => ({ ...previous, [id]: raw }));
    const variable = findVariable(id);
    if (!variable || variable.kind !== 'number') return;

    const value = raw.trim() === '' ? Number.NaN : Number(raw);
    const error = !Number.isFinite(value)
      ? '请输入有限数字；当前状态值未更改。'
      : value < variable.min || value > variable.max
        ? `请输入 ${formatNumber(variable.min)}–${formatNumber(variable.max)} 之间的值；当前状态值未更改。`
        : !isStepAligned(value, variable.min, variable.step)
          ? `请输入以 ${formatNumber(variable.step)} 为步长的值；当前状态值未更改。`
        : undefined;

    if (error) {
      setFieldErrors((previous) => ({ ...previous, [id]: error }));
      return;
    }

    handleValueChange(id, value);
  };

  const handleReset = () => {
    if (doc.version === 1) return;
    setState(createInitialState(doc));
    setDrafts({});
    setFieldErrors({});
    setResetToken((previous) => previous + 1);
  };

  const renderLegacyElement = (element: TextElement | InteractiveElement, index: number) => {
    if (element.kind === 'text') {
      const Component = registry.get('text');
      return (
        <ElementErrorBoundary key={`${element.kind}-${index}`}>
          {Component ? <Component element={element} /> : <UnknownElementView element={element} />}
        </ElementErrorBoundary>
      );
    }
    if (doc.version !== 2) {
      return <UnknownElementView key={`${element.kind}-${index}`} element={element} />;
    }
    return (
      <ElementErrorBoundary key={`${element.kind}-${index}`}>
        <InteractiveElementView
          document={doc}
          element={element}
          state={state}
          calculation={calculation}
          drafts={drafts}
          fieldErrors={fieldErrors}
          onValueChange={handleValueChange}
          onNumberInput={handleNumberInput}
        />
      </ElementErrorBoundary>
    );
  };

  return (
    <section className="genui-card" data-genui-card="" data-genui-version={doc.version}>
      <header className="genui-card-header">
        {brandMarkUrl ? (
          <img className="genui-card-logo" src={brandMarkUrl} alt="" aria-hidden="true" />
        ) : null}
        <span className="genui-card-badge">GenUI</span>
        {doc.title ? <h3 className="genui-card-title">{doc.title}</h3> : null}
        <button
          type="button"
          className="genui-card-expand"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={handleExpand}
        >
          {expanded ? '收起界面' : '展开查看'}
        </button>
      </header>
      <div className="genui-card-body" id={bodyId} hidden={!expanded}>
        {doc.version === 3 || doc.version === 4 ? (
          <CompositeElementsView
            context={{
              document: doc,
              evaluation: evaluation ?? evaluateComposite(doc, state),
              registry,
              state,
              drafts,
              fieldErrors,
              resetToken,
              onValueChange: handleValueChange,
              onNumberInput: handleNumberInput,
            }}
          />
        ) : (
          (doc.elements as Array<TextElement | InteractiveElement>).map(renderLegacyElement)
        )}
      </div>
      <footer className="genui-card-footer" hidden={!expanded}>
        {doc.version === 1 ? null : (
          <button type="button" className="genui-card-reset" onClick={handleReset}>
            重置当前界面
          </button>
        )}
        {doc.version === 1 ? null : (
          <button type="button" className="genui-card-followup" onClick={handleContinue}>
            继续讨论
          </button>
        )}
        <button type="button" className="genui-card-toggle" onClick={handleToggle}>
          {showRaw ? '收起原始 JSON' : '查看原始 JSON'}
        </button>
        {followupFeedback ? (
          <p className="genui-card-followup-feedback" role="status">
            {followupFeedback}
          </p>
        ) : null}
        <span className="genui-card-note">
          透明增强 · 纯文本渲染 · 不执行脚本 · 原始 {rawJson.length} 字符
        </span>
      </footer>
    </section>
  );
}
