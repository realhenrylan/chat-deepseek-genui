import { useId, useMemo, useRef, useState } from 'react';
import type {
  DerivedCalculation,
  GenuiDocument,
  InteractiveElement,
  InteractiveStateValues,
  StateVariable,
  TextElement,
} from '../protocol/types';
import {
  PLAN_MAX_LENGTH,
  parsePlanImport,
  serializePlan,
} from '../protocol/plan';
import { todayLocalDate } from '../protocol/provenance';
import { isStepAligned } from '../protocol/step';
import { hasOwn } from '../runtime/records';
import {
  calculateDerived,
  createInitialState,
  evaluateComposite,
  type CompositeEvaluation,
} from '../runtime/evaluate';
import {
  createCardUiState,
  restoreCardUiState,
  type CardUiState,
  type PlanClearResult,
  type PlanSaveResult,
  type TableViewState,
} from '../runtime/card-state';
import type { CardStateStore } from '../runtime/card-state-store';
import type { ScenarioPort } from '../runtime/scenario';
import { ElementErrorBoundary } from './boundaries';
import { CompositeElementsView } from './composite';
import { createContinueSnapshot } from './continue-snapshot';
import { UnknownElementView } from './elements';
import { formatNumber } from './format';
import { InteractiveElementView } from './interactive';
import type { ElementRegistry } from './registry';
import {
  buildContinueSummary,
  CONTINUE_INTENTS,
  getContinueIntent,
  MAX_CONTINUE_SUMMARY_LENGTH,
  type ContinueIntent,
  type ContinueSummaryInput,
} from './summarize';
import { ProvenancePanel } from './provenance';
import { ScenarioPanel } from './scenario-panel';
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

/** 点击「继续讨论」时冻结的预览：摘要文本与生成它的同一份快照。 */
interface FollowupPreview {
  input: ContinueSummaryInput;
  text: string;
  /** 最近一次按意图生成的原文；text 与它不同即表示用户改过摘要。 */
  generated: string;
  intent: ContinueIntent;
  hasSelection: boolean;
  hasAlternative: boolean;
}

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
  /**
   * 稳定卡片身份与页面内状态仓库（issue #2）。两者缺省时退化为组件内部
   * 状态，保持既有单测/独立挂载行为不变。
   */
  cardKey?: string;
  stateStore?: CardStateStore;
  /** 首次挂载的已校验状态（来自保存方案恢复或上层预置）。 */
  initialState?: CardUiState;
  /** 已保存到本机的方案时间；null 表示当前没有可恢复方案。 */
  savedPlanAt?: number | null;
  /** 用户主动「保存方案」；未接线时不显示入口，也绝不自动保存。 */
  onSavePlan?: (state: CardUiState) => Promise<PlanSaveResult>;
  /** 清除本机保存的方案。 */
  onClearPlan?: () => Promise<PlanClearResult>;
  /**
   * 方案工作台端口（issue #6）：具名方案的保存/比较/导入导出。
   * 未接线或 v1 静态文档时不渲染面板。
   */
  scenarioPort?: ScenarioPort | null;
}

const EMPTY_CALCULATION: DerivedCalculation = { values: {}, errors: {}, operations: 0 };

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function Card({
  document: initialDocument,
  rawJson,
  registry,
  onToggleRaw,
  onContinue,
  cardKey,
  stateStore,
  initialState,
  savedPlanAt,
  onSavePlan,
  onClearPlan,
  scenarioPort,
}: CardProps) {
  const brandMarkUrl = getBrandMarkUrl();
  const [doc, setDoc] = useState<GenuiDocument>(initialDocument);
  const [today] = useState(() => todayLocalDate());
  const [importedPlan, setImportedPlan] = useState<{
    fileName: string;
    exportedAt: string;
  } | null>(null);
  const [editedState, setEditedState] = useState<Record<string, true>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editedIds = Object.keys(editedState).sort();
  const hasEdits = editedIds.length > 0;
  const [showRaw, setShowRaw] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [followupFeedback, setFollowupFeedback] = useState<string | null>(null);
  // 首次挂载优先读取页面内仓库：同一文档的节点替换/重新挂载沿用已调整值。
  const [initialCardState] = useState<CardUiState>(() => {
    if (stateStore && cardKey) {
      const stored = stateStore.get(cardKey);
      if (stored) return stored;
    }
    return initialState ?? createCardUiState(doc);
  });
  const [state, setState] = useState<InteractiveStateValues>(initialCardState.values);
  const [tables, setTables] = useState<Record<string, TableViewState>>(initialCardState.tables);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  // 表格的筛选/排序由外部状态驱动，重置时递增该计数器强制重新挂载表格。
  const [resetToken, setResetToken] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(savedPlanAt ?? null);
  const [planFeedback, setPlanFeedback] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [preview, setPreview] = useState<FollowupPreview | null>(null);
  const previewTextRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyId = useId();
  const followupPanelId = useId();
  const followupTextId = useId();
  const followupCountId = useId();

  /** 每次业务状态变化同步写入页面内仓库；绝不在此路径写本机存储。 */
  const writeState = (
    values: InteractiveStateValues,
    nextTables: Record<string, TableViewState>,
  ): void => {
    if (stateStore && cardKey) stateStore.set(cardKey, { values, tables: nextTables });
  };

  const evaluation = useMemo<CompositeEvaluation | null>(
    () =>
      doc.version === 3 || doc.version === 4 || doc.version === 5
        ? evaluateComposite(doc, state)
        : null,
    [doc, state],
  );
  const calculation = useMemo<DerivedCalculation>(() => {
    if (doc.version === 2) return calculateDerived(doc, state);
    if (doc.version === 3 || doc.version === 4 || doc.version === 5) {
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

  // 阶段 6：展开/收起只切 visibility（hidden 属性），React 树不卸载，
  // 控件值、草稿、错误与重置计数全部保留；重置不改动展开状态。
  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    // 收起视图时不保留过期预览：重新展开后应基于当时的条件重新生成。
    if (!next) setPreview(null);
  };

  const closePreview = () => {
    setPreview(null);
    setFollowupFeedback(null);
  };

  // issue #5：点击先在本地冻结快照并展示可编辑摘要；真正填入输入框
  // 需要用户在预览里再点一次「填入输入框」，绝不自动发送。
  const handleContinue = () => {
    if (doc.version === 1) return;
    if (hasFieldErrors) {
      setFollowupFeedback('存在未确认的输入：请先修正或恢复有效值，再继续讨论。');
      return;
    }
    if (preview) {
      previewTextRef.current?.focus();
      return;
    }
    const snapshot = createContinueSnapshot({
      document: doc,
      evaluation,
      stateValues: state,
      derivedValues: calculation.values,
      derivedErrors: calculation.errors,
      drafts,
      fieldErrors,
      tables,
      ...(doc.version === 6 ? { editedState: editedIds, today } : {}),
    });
    const intent: ContinueIntent =
      snapshot.hasSelection && snapshot.hasAlternative
        ? 'compare'
        : snapshot.hasSelection
          ? 'selected'
          : 'explain';
    const request = getContinueIntent(intent).request;
    const text = buildContinueSummary({ ...snapshot.input, request });
    setPreview({
      input: snapshot.input,
      text,
      generated: text,
      intent,
      hasSelection: snapshot.hasSelection,
      hasAlternative: snapshot.hasAlternative,
    });
    setFollowupFeedback(null);
  };

  const handleIntentChange = (intent: ContinueIntent) => {
    // 用户手动改过摘要时不能整段重生成：只替换结尾请求句，其余编辑逐字保留。
    const edited = preview !== null && preview.text !== preview.generated;
    const request = getContinueIntent(intent).request;
    setPreview((previous) => {
      if (!previous) return previous;
      const regenerated = buildContinueSummary({ ...previous.input, request });
      if (previous.text === previous.generated) {
        return { ...previous, intent, generated: regenerated, text: regenerated };
      }
      const known = [
        ...CONTINUE_INTENTS.map((item) => item.request),
        '请基于以上当前条件与结果继续讨论。',
      ];
      const suffix = known.find((item) => previous.text.endsWith(item));
      const text = suffix
        ? `${previous.text.slice(0, -suffix.length)}${request}`
        : `${previous.text.trimEnd()}\n${request}`;
      return { ...previous, intent, generated: regenerated, text };
    });
    if (edited) setFollowupFeedback('已保留你的修改，只替换结尾请求。');
  };

  const handleApplyPreview = () => {
    if (!preview || preview.text.trim() === '') return;
    const result = onContinue?.(preview.text) ?? 'unavailable';
    setFollowupFeedback(CONTINUE_FEEDBACK[result]);
    // 成功带入后关闭预览；找不到输入框/未接线时保留文本，用户可继续修改或复制。
    if (result === 'filled' || result === 'appended') setPreview(null);
  };

  const handleTableChange = (path: string, view: TableViewState) => {
    const next = { ...tables, [path]: view };
    setTables(next);
    // 视图状态随卡片一起写入页面内仓库，节点替换后仍能恢复。
    writeState(state, next);
    // 界面条件已变，旧快照不能继续代表当前结果。
    closePreview();
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

    const next = { ...state, [id]: value };
    setState(next);
    writeState(next, tables);
    setEditedState((previous) => {
      const isEdited = value !== variable.initial;
      if (isEdited === (previous[id] === true)) return previous;
      const updated = { ...previous };
      if (isEdited) updated[id] = true;
      else delete updated[id];
      return updated;
    });
    clearFieldError(id);
    setDrafts((previous) => {
      if (!hasOwn(previous, id)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
    // 已提交参数变化后，旧预览里的数值会与新界面不一致，直接关闭。
    closePreview();
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
    const next = createInitialState(doc);
    setState(next);
    setDrafts({});
    setFieldErrors({});
    setTables({});
    writeState(next, {});
    setEditedState({});
    setResetToken((previous) => previous + 1);
    closePreview();
  };

  /** 应用已保存方案：参数与表格视图经文档清洗后整体替换当前状态。 */
  const handleApplyScenario = (values: Record<string, number | string>, nextTables: Record<string, TableViewState>) => {
    if (doc.version === 1) return;
    const restored = restoreCardUiState(doc, { values, tables: nextTables });
    setState(restored.state.values);
    setDrafts({});
    setFieldErrors({});
    setTables(restored.state.tables);
    writeState(restored.state.values, restored.state.tables);
    setResetToken((previous) => previous + 1);
    // 参数整体替换后，旧预览快照不再代表当前结果。
    closePreview();
  };

  // 「保存方案」只在用户显式点击时写入本机；交互本身绝不自动持久化。
  const handleSavePlan = async () => {
    if (!onSavePlan || planBusy) return;
    setPlanBusy(true);
    setPlanFeedback(null);
    try {
      const result = await onSavePlan({ values: state, tables });
      if (result.ok) {
        setSavedAt(result.savedAt);
        setPlanFeedback(
          result.evicted > 0
            ? `已保存到本机，刷新后可恢复；超出容量上限，已清理最早 ${result.evicted} 条保存。`
            : '已保存到本机，刷新后可恢复。',
        );
      } else {
        setPlanFeedback(result.message);
      }
    } catch (error) {
      setPlanFeedback(`保存失败：${readErrorMessage(error)}`);
    } finally {
      setPlanBusy(false);
    }
  };

  const handleClearPlan = async () => {
    if (!onClearPlan || planBusy) return;
    setPlanBusy(true);
    setPlanFeedback(null);
    try {
      const result = await onClearPlan();
      if (result.ok) {
        setSavedAt(null);
        setPlanFeedback('已清除本机保存的方案。');
      } else {
        setPlanFeedback(result.message);
      }
    } catch (error) {
      setPlanFeedback(`清除失败：${readErrorMessage(error)}`);
    } finally {
      setPlanBusy(false);
    }
  };

  const readFileText = async (file: File): Promise<string> => {
    if (typeof file.text === 'function') return file.text();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
      reader.readAsText(file);
    });
  };

  const handleExportPlan = () => {
    if (doc.version === 1) return;
    if (hasFieldErrors) {
      setPlanFeedback('存在未确认的输入：请先修正或恢复有效值，再导出方案。');
      return;
    }
    try {
      const text = serializePlan(doc, state, new Date(), editedIds);
      if (typeof URL.createObjectURL !== 'function') {
        setPlanFeedback('当前环境不支持文件下载；方案未写出。');
        return;
      }
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = `genui-plan-${today}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setPlanFeedback('方案已导出：包含界面、来源/依据与当前状态。');
    } catch (error) {
      setPlanFeedback(`导出失败：${readErrorMessage(error)}`);
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > PLAN_MAX_LENGTH) {
      setPlanFeedback('导入失败：方案文件超过大小上限。');
      return;
    }
    try {
      const parsed = parsePlanImport(await readFileText(file));
      if (!parsed.ok) {
        setPlanFeedback(`导入失败：${parsed.detail}`);
        return;
      }
      const plan = parsed.plan;
      setDoc(plan.document);
      setState(plan.state);
      setDrafts({});
      setFieldErrors({});
      setTables({});
      const restoredEdited = plan.editedState ?? [];
      setEditedState(Object.fromEntries(restoredEdited.map((id) => [id, true as const])));
      writeState(plan.state, {});
      setResetToken((previous) => previous + 1);
      setImportedPlan({ fileName: file.name, exportedAt: plan.exportedAt });
      setPlanFeedback('已恢复方案与当前状态；来源、依据和适用时间随方案载入。');
      closePreview();
    } catch (error) {
      setPlanFeedback(`导入失败：${readErrorMessage(error)}`);
    }
  };

  const handleRestoreOriginal = () => {
    setDoc(initialDocument);
    const next = initialDocument.version === 1
      ? {}
      : createInitialState(initialDocument);
    setState(next);
    setDrafts({});
    setFieldErrors({});
    setTables({});
    setEditedState({});
    writeState(next, {});
    setResetToken((previous) => previous + 1);
    setImportedPlan(null);
    setPlanFeedback(null);
    closePreview();
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
    <section
      className="genui-card"
      data-genui-card=""
      data-genui-version={doc.version}
      data-plan-imported={importedPlan ? 'true' : undefined}
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
            <span className="genui-plan-label">方案文件</span>
            <button type="button" className="genui-plan-export" onClick={handleExportPlan}>
              导出方案文件
            </button>
            <button
              type="button"
              className="genui-plan-import"
              onClick={() => fileInputRef.current?.click()}
            >
              导入方案文件
            </button>
            {importedPlan ? (
              <button type="button" className="genui-plan-restore" onClick={handleRestoreOriginal}>
                恢复原始界面
              </button>
            ) : null}
            <input
              ref={fileInputRef}
              className="genui-plan-file"
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => void handleImportFile(event)}
            />
            {importedPlan ? (
              <span className="genui-plan-origin">
                已载入 {importedPlan.fileName} · 导出于 {importedPlan.exportedAt}
              </span>
            ) : null}
            {planFeedback ? (
              <span className="genui-plan-feedback" role="status">
                {planFeedback}
              </span>
            ) : null}
          </div>
        )}
        {hasEdits ? (
          <p className="genui-edit-banner">
            输入已修改：静态文字/说明按初始条件生成，可能已过时；当前值与导出会标注「用户修改」并保留原依据。
          </p>
        ) : null}
        {doc.version === 3 || doc.version === 4 || doc.version === 5 || doc.version === 6 ? (
          <CompositeElementsView
            context={{
              document: doc,
              evaluation: evaluation ?? evaluateComposite(doc, state),
              registry,
              state,
              drafts,
              fieldErrors,
              tables,
              onTableChange: handleTableChange,
              resetToken,
              onValueChange: handleValueChange,
              onNumberInput: handleNumberInput,
              ...(doc.version === 6
                ? {
                    sources: doc.sources ?? [],
                    basis: doc.basis ?? {},
                    today,
                    editedState: editedIds,
                    hasEdits,
                  }
                : {}),
            }}
          />
        ) : (
          (doc.elements as Array<TextElement | InteractiveElement>).map(renderLegacyElement)
        )}
        {doc.version === 6 ? (
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
        {doc.version === 1 || !scenarioPort ? null : (
          <ScenarioPanel
            document={doc}
            port={scenarioPort}
            values={state}
            tables={tables}
            results={{ values: calculation.values, errors: calculation.errors }}
            onContinue={onContinue}
            onApply={handleApplyScenario}
          />
        )}
      </div>
      {preview ? (
        <section
          className="genui-followup"
          id={followupPanelId}
          role="region"
          aria-label="继续讨论摘要"
          hidden={!expanded}
        >
          <div className="genui-followup-intents" role="group" aria-label="讨论意图">
            {CONTINUE_INTENTS.map((item) => {
              const disabled =
                (item.id === 'selected' && !preview.hasSelection) ||
                (item.id === 'compare' && !preview.hasAlternative);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="genui-followup-intent"
                  aria-pressed={preview.intent === item.id}
                  disabled={disabled}
                  onClick={() => handleIntentChange(item.id)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <label className="genui-followup-label" htmlFor={followupTextId}>
            继续讨论摘要（可修改）
          </label>
          <textarea
            id={followupTextId}
            ref={previewTextRef}
            className="genui-followup-text"
            value={preview.text}
            maxLength={MAX_CONTINUE_SUMMARY_LENGTH}
            aria-describedby={followupCountId}
            onChange={(event) => {
              // 先取出输入值：事件对象的 currentTarget 在状态更新回调执行前会被清空。
              const text = event.currentTarget.value;
              setPreview((previous) => (previous ? { ...previous, text } : previous));
            }}
          />
          <p className="genui-followup-count" id={followupCountId}>
            {preview.text.length} / {MAX_CONTINUE_SUMMARY_LENGTH}
          </p>
          <p className="genui-followup-hint">
            摘要来自点击时的同一份快照；修改只影响这次请求，发送仍由你完成。
          </p>
          <div className="genui-followup-actions">
            <button
              type="button"
              className="genui-followup-apply"
              disabled={preview.text.trim() === ''}
              onClick={handleApplyPreview}
            >
              填入输入框
            </button>
            <button type="button" className="genui-followup-cancel" onClick={closePreview}>
              取消
            </button>
          </div>
        </section>
      ) : null}
      <footer className="genui-card-footer" hidden={!expanded}>
        {doc.version === 1 ? null : (
          <button type="button" className="genui-card-reset" onClick={handleReset}>
            重置当前界面
          </button>
        )}
        {doc.version === 1 ? null : (
          <button
            type="button"
            className="genui-card-followup"
            aria-expanded={preview !== null}
            aria-controls={followupPanelId}
            onClick={handleContinue}
          >
            继续讨论
          </button>
        )}
        {doc.version === 1 || !onSavePlan ? null : (
          <button
            type="button"
            className="genui-card-save"
            disabled={planBusy}
            onClick={() => void handleSavePlan()}
          >
            {savedAt !== null ? '更新保存的方案' : '保存方案'}
          </button>
        )}
        {savedAt !== null && onClearPlan ? (
          <button
            type="button"
            className="genui-card-clear-plan"
            disabled={planBusy}
            onClick={() => void handleClearPlan()}
          >
            清除保存
          </button>
        ) : null}
        <button type="button" className="genui-card-toggle" onClick={handleToggle}>
          {showRaw ? '收起原始 JSON' : '查看原始 JSON'}
        </button>
        {followupFeedback ? (
          <p className="genui-card-followup-feedback" role="status">
            {followupFeedback}
          </p>
        ) : null}
        {planFeedback ? (
          <p className="genui-card-plan-feedback" role="status">
            {planFeedback}
          </p>
        ) : null}
        <span className="genui-card-note">
          透明增强 · 纯文本渲染 · 不执行脚本 · 原始 {rawJson.length} 字符
        </span>
      </footer>
    </section>
  );
}
