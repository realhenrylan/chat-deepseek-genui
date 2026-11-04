import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { GenuiDocument, InteractiveStateValues } from '../protocol/types';
import {
  buildComparisonSummary,
  buildScenarioSummary,
  CALC_RULE_VERSION,
  checkScenarioDocument,
  compareScenarios,
  formatScenarioTime,
  MAX_SCENARIO_NAME_LENGTH,
  recomputeScenario,
  type SavedScenario,
  type ScenarioPort,
} from '../runtime/scenario';
import { buildTablesCsv } from '../runtime/csv';
import type { TableViewState } from '../runtime/card-state';

export interface ScenarioPanelProps {
  document: GenuiDocument;
  /** 当前卡片的方案端口；未接线（v1 或不支持本机存储）时不渲染面板。 */
  port?: ScenarioPort | null;
  /** 当前参数与结果，保存时作为方案快照来源。 */
  values: InteractiveStateValues;
  tables: Record<string, TableViewState>;
  results: { values: Record<string, number>; errors: Record<string, string> };
  /** 「继续讨论」交接：把选中方案或差异摘要交给聊天流程。 */
  onContinue?: (summary: string) => 'filled' | 'appended' | 'no-input' | 'unavailable';
  /** 「应用此方案」：把方案里的参数与表格视图恢复到当前卡片，形成选择闭环。 */
  onApply?: (values: InteractiveStateValues, tables: Record<string, TableViewState>) => void;
}

const CONTINUE_FEEDBACK: Record<string, string> = {
  filled: '已填入输入框；发送由你完成。',
  appended: '草稿已保留：已在草稿后追加继续讨论摘要，发送由你完成。',
  'no-input': '未找到聊天输入框，未能带入当前条件。',
  unavailable: '继续讨论目标未接入，未能带入当前条件。',
};

/** 下载为本地文件：Blob + 对象 URL，不经过任何网络请求。 */
function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 40) : '方案';
}

/**
 * 方案工作台：保存具名方案、列表/删除/清除、并排比较、
 * JSON 与可读摘要导出、CSV 表格导出、导入校验与「继续讨论」交接。
 * 所有持久化都经 ScenarioPort；本组件不直接触碰存储。
 */
export function ScenarioPanel({
  document: doc,
  port,
  values,
  tables,
  results,
  onContinue,
  onApply,
}: ScenarioPanelProps) {
  const nameId = useId();
  const fileId = useId();
  const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [continueFeedback, setContinueFeedback] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!port) return;
    const list = await port.list();
    if (mountedRef.current) setScenarios(list);
  }, [port]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  if (!port) return null;

  const run = async (action: () => Promise<string>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    setContinueFeedback(null);
    try {
      const message = await action();
      if (mountedRef.current) setFeedback(message);
    } catch (error) {
      if (mountedRef.current) {
        setFeedback(`操作失败：${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleSave = (): Promise<void> =>
    run(async () => {
      const outcome = await port.save({
        name,
        values,
        tables,
        results: { values: results.values, errors: results.errors },
      });
      setName('');
      await refresh();
      return outcome.message;
    });

  const handleDelete = (scenario: SavedScenario): Promise<void> =>
    run(async () => {
      const outcome = await port.remove(scenario.id, scenario.name);
      setSelected((previous) => previous.filter((id) => id !== scenario.id));
      await refresh();
      return outcome.message;
    });

  const handleClear = (): Promise<void> =>
    run(async () => {
      const outcome = await port.clear();
      setSelected([]);
      await refresh();
      return outcome.message;
    });

  const handleImportFile = (file: File): Promise<void> =>
    run(async () => {
      if (file.size > 64 * 1024 * 8) {
        return '文件过大（超过 64 KiB），未导入。';
      }
      const text = await file.text();
      const outcome = await port.importText(text);
      await refresh();
      return outcome.message;
    });

  const exportScenarioJson = (scenario: SavedScenario): void => {
    downloadText(`${safeFilename(scenario.name)}.json`, JSON.stringify(scenario, null, 2), 'application/json');
    setFeedback(`已导出方案「${scenario.name}」的 JSON 文件。`);
  };

  /**
   * 摘要与「继续讨论」都用当前文档解释方案字段；方案若属于其他界面，
   * 字段 ID 可能被赋予错误的名称与单位，因此先校验再生成。
   */
  const docMismatch = (scenario: SavedScenario): string | null => {
    const match = checkScenarioDocument(scenario, doc, port.documentHash);
    return match.ok ? null : `${match.message}；该方案的摘要或差异无法用当前卡片字段解释。`;
  };

  const exportSummary = (scenario: SavedScenario): void => {
    const mismatch = docMismatch(scenario);
    if (mismatch) {
      setFeedback(mismatch);
      return;
    }
    downloadText(`${safeFilename(scenario.name)}.txt`, buildScenarioSummary(scenario, doc), 'text/plain');
    setFeedback(`已导出方案「${scenario.name}」的可读摘要。`);
  };

  const exportComparison = (a: SavedScenario, b: SavedScenario): void => {
    const summary = buildComparisonSummary({ a, b, document: doc, documentHash: port.documentHash });
    if (!summary) {
      setFeedback('两份方案不兼容，无法生成差异摘要。');
      return;
    }
    downloadText(`${safeFilename(a.name)}-vs-${safeFilename(b.name)}.txt`, summary, 'text/plain');
    setFeedback('已导出两份方案的差异摘要。');
  };

  const handleContinueScenario = (scenario: SavedScenario): void => {
    if (!onContinue) {
      setContinueFeedback(CONTINUE_FEEDBACK.unavailable);
      return;
    }
    const mismatch = docMismatch(scenario);
    if (mismatch) {
      setContinueFeedback(mismatch);
      return;
    }
    const summary = buildScenarioSummary(scenario, doc);
    setContinueFeedback(CONTINUE_FEEDBACK[onContinue(summary) ?? 'unavailable']);
  };

  const handleContinueComparison = (a: SavedScenario, b: SavedScenario): void => {
    if (!onContinue) {
      setContinueFeedback(CONTINUE_FEEDBACK.unavailable);
      return;
    }
    const summary = buildComparisonSummary({ a, b, document: doc, documentHash: port.documentHash });
    if (!summary) {
      setContinueFeedback('两份方案不兼容，无法生成差异摘要。');
      return;
    }
    setContinueFeedback(CONTINUE_FEEDBACK[onContinue(summary) ?? 'unavailable']);
  };

  const toggleSelected = (id: string): void => {
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  };

  const selectedScenarios = selected
    .map((id) => scenarios.find((scenario) => scenario.id === id))
    .filter((scenario): scenario is SavedScenario => scenario !== undefined);
  const comparing = selectedScenarios.length === 2;
  const comparison =
    comparing && selectedScenarios[0] && selectedScenarios[1]
      ? compareScenarios(selectedScenarios[0], selectedScenarios[1], doc, port.documentHash)
      : null;

  return (
    <div className="genui-scenario-panel" data-genui-scenario-panel="">
      <h4 className="genui-scenario-heading">方案工作台</h4>

      <div className="genui-scenario-save-row">
        <label className="genui-scenario-label" htmlFor={nameId}>
          方案名称
        </label>
        <input
          id={nameId}
          className="genui-scenario-name-input"
          type="text"
          value={name}
          maxLength={MAX_SCENARIO_NAME_LENGTH}
          placeholder="例如：保守预算方案"
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="button"
          className="genui-scenario-save"
          disabled={busy || name.trim().length === 0}
          onClick={() => void handleSave()}
        >
          保存当前方案
        </button>
      </div>

      <ul className="genui-scenario-list" aria-label="已保存的方案">
        {scenarios.length === 0 ? <li className="genui-scenario-empty">本机暂无已保存的方案。</li> : null}
        {scenarios.map((scenario) => {
          const checked = selected.includes(scenario.id);
          const recompute = recomputeScenario(scenario, doc, port.documentHash);
          return (
            <li key={scenario.id} className="genui-scenario-item">
              <label className="genui-scenario-select">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSelected(scenario.id)}
                />
                <span className="genui-scenario-name">{scenario.name}</span>
              </label>
              <span className="genui-scenario-time">{formatScenarioTime(scenario.savedAt)}</span>
              {recompute.ok && recompute.changed ? (
                <span className="genui-scenario-stale" title={recompute.note ?? ''}>
                  按当前规则重算与保存时不一致
                </span>
              ) : null}
              {recompute.ok && !recompute.changed && recompute.ruleChanged ? (
                <span className="genui-scenario-stale" title={recompute.note ?? ''}>
                  计算规则版本已变化，重算结果一致
                </span>
              ) : null}
              {recompute.ok && (recompute.changed || recompute.ruleChanged) ? (
                <details className="genui-scenario-recompute">
                  <summary>保存时结果 vs 当前规则重算</summary>
                  <ul>
                    {recompute.diffs.map((diff) => (
                      <li
                        key={diff.id}
                        className={diff.changed ? 'genui-scenario-recompute-changed' : undefined}
                      >
                        {diff.id}：保存 {diff.saved} → 当前 {diff.current}
                      </li>
                    ))}
                  </ul>
                  {recompute.ruleChanged ? (
                    <p className="genui-scenario-recompute-note">
                      计算规则版本：保存时 v{scenario.ruleVersion} → 当前 v{CALC_RULE_VERSION}
                    </p>
                  ) : null}
                  {recompute.droppedFields > 0 ? (
                    <p className="genui-scenario-recompute-note">
                      {recompute.droppedFields} 个参数超出当前取值范围，已按当前规则回落。
                    </p>
                  ) : null}
                </details>
              ) : null}
              <span className="genui-scenario-actions">
                <button
                  type="button"
                  className="genui-scenario-apply"
                  disabled={busy || !onApply || docMismatch(scenario) !== null}
                  title={docMismatch(scenario) ?? undefined}
                  onClick={() => {
                    if (!onApply) return;
                    onApply(scenario.values, scenario.tables);
                    setFeedback(`已应用方案「${scenario.name}」的参数与表格视图，可继续调整。`);
                  }}
                >
                  应用此方案
                </button>
                <button
                  type="button"
                  className="genui-scenario-export-json"
                  disabled={busy}
                  onClick={() => exportScenarioJson(scenario)}
                >
                  导出 JSON
                </button>
                <button
                  type="button"
                  className="genui-scenario-export-summary"
                  disabled={busy}
                  onClick={() => exportSummary(scenario)}
                >
                  导出摘要
                </button>
                <button
                  type="button"
                  className="genui-scenario-continue"
                  disabled={busy}
                  onClick={() => handleContinueScenario(scenario)}
                >
                  继续讨论此方案
                </button>
                <button
                  type="button"
                  className="genui-scenario-delete"
                  disabled={busy}
                  onClick={() => void handleDelete(scenario)}
                >
                  删除
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="genui-scenario-compare-row">
        <button
          type="button"
          className="genui-scenario-compare"
          disabled={!comparing}
          onClick={() => setCompareOpen((previous) => !previous)}
        >
          {compareOpen ? '收起并排比较' : '并排比较（勾选 2 项）'}
        </button>
        <button
          type="button"
          className="genui-scenario-continue-compare"
          disabled={!comparing || busy}
          onClick={() =>
            selectedScenarios[0] && selectedScenarios[1]
              ? handleContinueComparison(selectedScenarios[0], selectedScenarios[1])
              : undefined
          }
        >
          差异交给继续讨论
        </button>
        <button
          type="button"
          className="genui-scenario-export-compare"
          disabled={!comparing}
          onClick={() =>
            selectedScenarios[0] && selectedScenarios[1]
              ? exportComparison(selectedScenarios[0], selectedScenarios[1])
              : undefined
          }
        >
          导出差异摘要
        </button>
        <button type="button" className="genui-scenario-import" disabled={busy} onClick={() => setImportOpen((previous) => !previous)}>
          {importOpen ? '收起导入' : '导入方案'}
        </button>
        <button
          type="button"
          className="genui-scenario-export-csv"
          disabled={busy}
          onClick={() => {
            const csv = buildTablesCsv(doc, values);
            if (csv === null) {
              setFeedback('当前界面没有可导出的表格数据。');
              return;
            }
            downloadText(`${safeFilename(doc.title ?? '表格数据')}.csv`, csv, 'text/csv;charset=utf-8');
            setFeedback('已导出表格数据 CSV 文件。');
          }}
        >
          导出表格 CSV
        </button>
        <button
          type="button"
          className="genui-scenario-clear"
          disabled={busy || scenarios.length === 0}
          onClick={() => void handleClear()}
        >
          清除全部方案
        </button>
      </div>

      {compareOpen && comparison ? (
        comparison.compatible ? (
          <table className="genui-scenario-compare-table">
            <thead>
              <tr>
                <th scope="col">项目</th>
                <th scope="col">{selectedScenarios[0]?.name}</th>
                <th scope="col">{selectedScenarios[1]?.name}</th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row) => (
                <tr key={`${row.kind}-${row.id}`} className={row.changed ? 'genui-scenario-row-changed' : ''}>
                  <th scope="row">{row.id}</th>
                  <td>{row.a}</td>
                  <td>
                    {row.b}
                    {row.changed && row.delta !== undefined
                      ? `（${row.delta > 0 ? '+' : ''}${String(row.delta)}）`
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="genui-scenario-incompatible" role="status">
            <p>两份方案不兼容，无法并排比较：</p>
            <ul>
              {comparison.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )
      ) : null}
      {compareOpen && !comparison ? (
        <p className="genui-scenario-compare-hint" role="status">
          请先勾选两份方案再比较。
        </p>
      ) : null}

      {importOpen ? (
        <div className="genui-scenario-import-row">
          <label className="genui-scenario-label" htmlFor={fileId}>
            选择方案 JSON 文件（先校验，不覆盖已有方案）
          </label>
          <input
            id={fileId}
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImportFile(file);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
        </div>
      ) : null}

      {feedback ? (
        <p className="genui-scenario-feedback" role="status">
          {feedback}
        </p>
      ) : null}
      {continueFeedback ? (
        <p className="genui-scenario-continue-feedback" role="status">
          {continueFeedback}
        </p>
      ) : null}
    </div>
  );
}
