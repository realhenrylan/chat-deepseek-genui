import { useId, useMemo, useRef, useState } from 'react';
import type {
  DerivedCalculation,
  GenuiDocument,
  InteractiveElement,
  InteractiveStateValues,
  StateVariable,
  TextElement,
} from '../protocol/types';
import { isStepAligned } from '../protocol/step';
import {
  PLAN_MAX_LENGTH,
  parsePlanImport,
  serializePlan,
  type GenuiPlan,
} from '../protocol/plan';
import { formatProvenanceDate, todayLocalDate } from '../protocol/provenance';
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
import { ProvenancePanel } from './provenance';
import { buildContinueSummary } from './summarize';
import { getBrandMarkUrl } from '../branding';

/**
 * 一个 GenUI 文档的样式隔离卡片。v1 渲染静态内容；v2 的状态、控件与派生
 * 计算留在组件树内；v3 在 v2 基础上增加布局、条件说明、图表与表格；
 * v4 在 v3 基础上增加来源与依据（插件只展示声明，不访问网络、不核验）。
 * 卡片可把 v2/v3/v4 文档与当前状态导出为方案文件，也可导入方案继续。
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

interface ImportedPlanInfo {
  exportedAt: string;
  fileName: string;
}

/** 旧方案没有 editedState 时，用当前状态与初始值的差异推断用户修改。 */
function deriveEditedState(
  document: GenuiDocument,
  state: InteractiveStateValues,
): string[] {
  if (document.version === 1) return [];
  return document.state
    .filter((variable) => {
      const current = state[variable.id];
      return current !== undefined && current !== variable.initial;
    })
    .map((variable) => variable.id)
    .sort();
}

/** 优先用 File.text()；测试或旧环境回落到 FileReader。 */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取失败'));
    reader.readAsText(file);
  });
}

export function Card({
  document: initialDocument,
  rawJson,
  registry,
  onToggleRaw,
  onContinue,
}: CardProps) {
  const brandMarkUrl = getBrandMarkUrl();
  const [activeDocument, setActiveDocument] = useState<GenuiDocument>(initialDocument);
  const [showRaw, setShowRaw] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [followupFeedback, setFollowupFeedback] = useState<string | null>(null);
  const [planFeedback, setPlanFeedback] = useState<string | null>(null);
  const [importedPlan, setImportedPlan] = useState<ImportedPlanInfo | null>(null);
  const [state, setState] = useState<InteractiveStateValues>(() =>
    initialDocument.version === 1 ? {} : createInitialState(initialDocument),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // 哪些输入已被用户改离初始值；当前值的依据因此与模型声明的原始依据不同。
  const [editedState, setEditedState] = useState<Record<string, true>>({});
  // 表格的筛选/排序是视图本地状态，重置时通过该计数器强制重新挂载。
  const [resetToken, setResetToken] = useState(0);
  const [today] = useState(() => todayLocalDate());
  const bodyId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const doc = activeDocument;
  const editedIds = Object.keys(editedState).sort();
  const hasEdits = editedIds.length > 0;
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const evaluation = useMemo<CompositeEvaluation | null>(
    () =>
      doc.version === 3 || doc.version === 4 ? evaluateComposite(doc, state) : null,
    [doc, state],
  );
  const calculation = useMemo<DerivedCalculation>(() => {
    if (doc.version === 2) return calculateDerived(doc, state);
    if (doc.version === 3 || doc.version === 4) {
      return evaluation?.derived ?? EMPTY_CALCULATION;
    }
    return EMPTY_CALCULATION;
  }, [doc, state, evaluation]);

  const findVariable = (id: string): StateVariable | undefined =>
    doc.version === 1 ? undefined : doc.state.find((item) => item.id === id);

  const handleToggle = () => {
    const next = !showRaw;
    setShowRaw(next);
    onToggleRaw?.(next);
  };

  // 展开/收起只切 visibility（hidden 属性），React 树不卸载，
  // 控件值、草稿、错误与重置计数全部保留；重置不改动展开状态。
  const handleExpand = () => {
    setExpanded((previous) => !previous);
  };

  // 用户主动触发「继续讨论」——只生成摘要并交给挂载方，
  // 绝不自动发送；未接线时也给出如实反馈。
  const handleContinue = () => {
    if (doc.version === 1) return;
    // 输入框可能停在空白或非法草稿；此时 state 仍是上一次有效值，不能把它
    // 当成用户当前确认的条件带进摘要。
    if (hasFieldErrors) {
      setFollowupFeedback('存在未确认的输入：请先修正或恢复有效值，再继续讨论。');
      return;
    }
    const summary = buildContinueSummary({
      title: doc.title,
      state: doc.state,
      derived: doc.derived,
      stateValues: state,
      derivedValues: calculation.values,
      derivedErrors: calculation.errors,
      editedState: editedIds,
      ...(doc.version === 4 ? { sources: doc.sources, today } : {}),
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
    setEditedState((previous) => {
      const edited = value !== variable.initial;
      if (edited === hasOwn(previous, id)) return previous;
      const next = { ...previous };
      if (edited) next[id] = true;
      else delete next[id];
      return next;
    });
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

  const resetInteractionState = () => {
    setDrafts({});
    setFieldErrors({});
    setResetToken((previous) => previous + 1);
  };

  const handleReset = () => {
    if (doc.version === 1) return;
    setState(createInitialState(doc));
    setEditedState({});
    resetInteractionState();
    setPlanFeedback(null);
    setFollowupFeedback(null);
  };

  const handleExportPlan = () => {
    if (doc.version === 1) return;
    if (hasFieldErrors) {
      setPlanFeedback('存在未确认的输入：请先修正或恢复有效值，再导出方案。');
      return;
    }
    try {
      const json = serializePlan(doc, state, new Date(), editedIds);
      if (typeof URL.createObjectURL !== 'function') {
        setPlanFeedback('当前环境不支持文件下载；方案未写出。');
        return;
      }
      const blob = new Blob([json], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = href;
      anchor.download = `genui-plan-${today}.json`;
      anchor.click();
      URL.revokeObjectURL(href);
      setPlanFeedback('方案已导出：包含界面、来源/依据与当前状态。');
    } catch {
      setPlanFeedback('方案导出失败：当前界面无法序列化。');
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    // 在 await 之前清空 input，允许重复选择同一个文件。
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size > PLAN_MAX_LENGTH) {
      setPlanFeedback('导入失败：方案文件过大。');
      return;
    }
    let raw: string;
    try {
      raw = await readFileText(file);
    } catch {
      setPlanFeedback('导入失败：无法读取方案文件。');
      return;
    }
    const result = parsePlanImport(raw);
    if (!result.ok) {
      setPlanFeedback(`导入失败：${result.detail}`);
      return;
    }
    const plan: GenuiPlan = result.plan;
    const importedEdited =
      plan.editedState === undefined
        ? deriveEditedState(plan.document, plan.state)
        : plan.editedState;
    setActiveDocument(plan.document);
    setState(plan.state);
    setEditedState(
      Object.fromEntries(importedEdited.map((id) => [id, true] as const)),
    );
    resetInteractionState();
    setFollowupFeedback(null);
    setImportedPlan({ exportedAt: plan.exportedAt, fileName: file.name });
    setPlanFeedback('已恢复方案与当前状态；来源、依据和适用时间随方案载入。');
  };

  const handleRestoreOriginal = () => {
    setActiveDocument(initialDocument);
    setState(initialDocument.version === 1 ? {} : createInitialState(initialDocument));
    setEditedState({});
    resetInteractionState();
    setFollowupFeedback(null);
    setImportedPlan(null);
    setPlanFeedback('已恢复对话中的原始界面与初始状态。');
  };

  const renderTextElement = (element: TextElement, index: number) => {
    // v1 只定义 text；防御层保留未知 kind 的占位，避免脏文档被当成文本渲染。
    if (element.kind !== 'text') {
      return (
        <ElementErrorBoundary key={`${element.kind}-${index}`}>
          <UnknownElementView element={element as { kind: string }} />
        </ElementErrorBoundary>
      );
    }
    const Component = registry.get('text');
    return (
      <ElementErrorBoundary key={`${element.kind}-${index}`}>
        {Component ? <Component element={element} /> : <UnknownElementView element={element} />}
      </ElementErrorBoundary>
    );
  };

  const renderInteractiveElement = (element: InteractiveElement, index: number) => {
    if (doc.version !== 2) {
      return <UnknownElementView key={`${element.kind}-${index}`} element={element} />;
    }
    if (element.kind === 'text') {
      const Component = registry.get('text');
      return (
        <ElementErrorBoundary key={`text-${index}`}>
          {Component ? <Component element={element} /> : <UnknownElementView element={element} />}
        </ElementErrorBoundary>
      );
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
    <section
      className="genui-card"
      data-genui-card=""
      data-genui-version={doc.version}
      data-plan-imported={importedPlan === null ? undefined : 'true'}
    >
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
        {doc.version === 1 ? null : (
          <div className="genui-plan-bar">
            <span className="genui-plan-label">方案</span>
            <button type="button" className="genui-plan-export" onClick={handleExportPlan}>
              导出方案
            </button>
            <button
              type="button"
              className="genui-plan-import"
              onClick={() => fileInputRef.current?.click()}
            >
              导入方案
            </button>
            {importedPlan === null ? null : (
              <button type="button" className="genui-plan-restore" onClick={handleRestoreOriginal}>
                恢复原始界面
              </button>
            )}
            <input
              ref={fileInputRef}
              className="genui-plan-file"
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                void handleImportFile(event);
              }}
            />
            {importedPlan === null ? null : (
              <span className="genui-plan-origin">
                已载入 {importedPlan.fileName} · 导出于 {formatProvenanceDate(importedPlan.exportedAt)}
              </span>
            )}
            {planFeedback ? (
              <p className="genui-plan-feedback" role="status">
                {planFeedback}
              </p>
            ) : null}
          </div>
        )}
        {hasEdits ? (
          <p className="genui-edit-banner">
            输入已修改：静态文字/说明按初始条件生成，可能已过时；当前值与导出会标注「用户修改」并保留原依据。
          </p>
        ) : null}
        {doc.version === 3 || doc.version === 4 ? (
          <CompositeElementsView
            context={{
              document: doc,
              evaluation: evaluation ?? evaluateComposite(doc, state),
              registry,
              state,
              drafts,
              fieldErrors,
              sources: doc.version === 4 ? (doc.sources ?? []) : [],
              today,
              editedState: editedIds,
              hasEdits,
              resetToken,
              onValueChange: handleValueChange,
              onNumberInput: handleNumberInput,
            }}
          />
        ) : doc.version === 2 ? (
          doc.elements.map(renderInteractiveElement)
        ) : (
          doc.elements.map(renderTextElement)
        )}
        {doc.version === 4 ? (
          <ProvenancePanel
            document={doc}
            state={state}
            drafts={drafts}
            fieldErrors={fieldErrors}
            editedState={editedIds}
            onValueChange={handleValueChange}
            onNumberInput={handleNumberInput}
            today={today}
          />
        ) : null}
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
