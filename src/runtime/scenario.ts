/**
 * 具名方案（issue #6）：保存、比较、重算对照与导入校验的纯逻辑层。
 *
 * 设计要点：
 * - 一条方案是「当时保存的完整快照」：输入、表格视图、派生结果、协议与
 *   计算规则版本、资料依据（会话/消息/标题/文档哈希）；
 * - 与后续对话摘要共享同一快照格式（scenario 记录即快照载体）；
 * - 导入只做 JSON.parse 与结构校验，绝不执行导入内容里的任何代码；
 * - 比较只在兼容（同文档、同字段签名、同协议与规则版本）时给出并排结果，
 *   不兼容必须给出明确理由，不能输出误导性比较。
 */
import type {
  DerivedCalculation,
  GenuiDocument,
  InteractiveStateValues,
} from '../protocol/types';
import { calculateDerived, evaluateComposite } from './evaluate';
import { documentStateSignature, sanitizeCardValues, type TableViewState } from './card-state';
import { getOwn } from './records';
import { hashString } from './hash';

/** 导出文件的格式标记；旧格式/其他文件在导入时据此拒绝。 */
export const SCENARIO_FORMAT = 'genui-scenario';
/** 当前方案记录版本；更高版本导入时明确提示不支持。 */
export const SCENARIO_VERSION = 1;
/**
 * 计算规则版本：evaluate.ts 的语义（运算、边界、错误文案）变化时递增。
 * 用于区分「当时保存的结果」与「按当前规则重新计算的结果」。
 */
export const CALC_RULE_VERSION = 1;
/** 单条方案记录的字符数上限（存储与导入共用）。 */
export const MAX_SCENARIO_CHARS = 48 * 1024;
/** 导入文件的字符数上限（先于解析检查，防止超大文件拖垮解析）。 */
export const MAX_IMPORT_CHARS = 64 * 1024;
/** 方案名称长度上限。 */
export const MAX_SCENARIO_NAME_LENGTH = 60;
/** 单条记录内参数/结果字段数上限。 */
export const MAX_SCENARIO_FIELDS = 64;

export interface ScenarioResults {
  /** 保存时的派生结果：derived id → 数值。 */
  values: Record<string, number>;
  /** 保存时的派生错误：derived id → 错误说明。 */
  errors: Record<string, string>;
}

export interface ScenarioSource {
  sessionId: string;
  messageKey: string;
  duplicateIndex: number;
  title: string;
}

/** 一条具名方案记录（导出/导入与存储共用的快照格式）。 */
export interface SavedScenario {
  format: typeof SCENARIO_FORMAT;
  version: number;
  /** 稳定身份：导出再导入必须保持不变。 */
  id: string;
  name: string;
  savedAt: number;
  documentHash: string;
  stateSignature: string;
  protocolVersion: number;
  ruleVersion: number;
  source: ScenarioSource;
  values: InteractiveStateValues;
  tables: Record<string, TableViewState>;
  results: ScenarioResults;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown, maxLength = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function hasStringFields(record: Record<string, unknown>, key: string, maxLength = 512): boolean {
  const value = record[key];
  return isNonEmptyString(value, maxLength);
}

/** 校验状态取值：仅允许有限数字或字符串，且字段数受限。 */
function isValidStateValues(value: unknown): value is InteractiveStateValues {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > MAX_SCENARIO_FIELDS) return false;
  return keys.every((key) => {
    const item = value[key];
    return isFiniteNumber(item) || (typeof item === 'string' && item.length <= 512);
  });
}

/** 校验派生结果快照：values 数值、errors 字符串，均按 ID 数受限。 */
function isValidResults(value: unknown): value is ScenarioResults {
  if (!isPlainRecord(value)) return false;
  const values = value['values'];
  const errors = value['errors'];
  if (!isPlainRecord(values) || !isPlainRecord(errors)) return false;
  if (Object.keys(values).length > MAX_SCENARIO_FIELDS) return false;
  if (Object.keys(errors).length > MAX_SCENARIO_FIELDS) return false;
  return (
    Object.values(values).every(isFiniteNumber) &&
    Object.values(errors).every((item) => typeof item === 'string')
  );
}

function isValidSource(value: unknown): value is ScenarioSource {
  if (!isPlainRecord(value)) return false;
  return (
    hasStringFields(value, 'sessionId') &&
    hasStringFields(value, 'messageKey') &&
    Number.isInteger(value['duplicateIndex']) &&
    (value['duplicateIndex'] as number) >= 0 &&
    typeof value['title'] === 'string'
  );
}

/** 严格校验一条持久化/导入记录；结构异常时拒绝，不做猜测性迁移。 */
export function isScenarioRecord(value: unknown): value is SavedScenario {
  if (!isPlainRecord(value)) return false;
  if (value['format'] !== SCENARIO_FORMAT) return false;
  if (!Number.isInteger(value['version'])) return false;
  if (value['version'] !== SCENARIO_VERSION) return false;
  if (!isNonEmptyString(value['id'], 128)) return false;
  if (!isNonEmptyString(value['name'], MAX_SCENARIO_NAME_LENGTH)) return false;
  if (!isFiniteNumber(value['savedAt']) || (value['savedAt'] as number) < 0) return false;
  if (!hasStringFields(value, 'documentHash')) return false;
  if (!hasStringFields(value, 'stateSignature')) return false;
  if (!Number.isInteger(value['protocolVersion'])) return false;
  if (!Number.isInteger(value['ruleVersion'])) return false;
  if (!isValidSource(value['source'])) return false;
  if (!isValidStateValues(value['values'])) return false;
  if (!isPlainRecord(value['tables'])) return false;
  if (Object.keys(value['tables']).length > 40) return false;
  if (!isValidResults(value['results'])) return false;
  try {
    return JSON.stringify(value).length <= MAX_SCENARIO_CHARS;
  } catch {
    return false;
  }
}

export interface CreateScenarioInput {
  name: string;
  savedAt: number;
  documentHash: string;
  stateSignature: string;
  protocolVersion: number;
  source: ScenarioSource;
  values: InteractiveStateValues;
  tables: Record<string, TableViewState>;
  results: ScenarioResults;
}

/** 生成稳定方案 ID：内容与时间的本地哈希，导出导入保持不变。 */
export function generateScenarioId(input: {
  documentHash: string;
  savedAt: number;
  name: string;
  values: InteractiveStateValues;
}): string {
  return `scn_${hashString(`${input.documentHash}|${input.savedAt}|${input.name}|${JSON.stringify(input.values)}`)}`;
}

/** 组装一条方案记录（调用方负责先做 sanitize）。 */
export function createScenario(input: CreateScenarioInput): SavedScenario {
  const name = input.name.trim().slice(0, MAX_SCENARIO_NAME_LENGTH);
  return {
    format: SCENARIO_FORMAT,
    version: SCENARIO_VERSION,
    id: generateScenarioId({
      documentHash: input.documentHash,
      savedAt: input.savedAt,
      name,
      values: input.values,
    }),
    name,
    savedAt: input.savedAt,
    documentHash: input.documentHash,
    stateSignature: input.stateSignature,
    protocolVersion: input.protocolVersion,
    ruleVersion: CALC_RULE_VERSION,
    source: input.source,
    values: input.values,
    tables: input.tables,
    results: input.results,
  };
}

export type ScenarioImportCode =
  | 'too-large'
  | 'invalid-json'
  | 'wrong-format'
  | 'unsupported-version'
  | 'invalid-fields';

export type ScenarioParseResult =
  | { ok: true; scenario: SavedScenario }
  | { ok: false; code: ScenarioImportCode; message: string };

/**
 * 导入校验（第一阶段文件交换）：大小 → JSON 解析 → 格式标记 → 版本 →
 * 字段结构。只解析文本，不执行任何导入内容中的代码。
 */
export function parseScenarioImport(text: string): ScenarioParseResult {
  if (text.length > MAX_IMPORT_CHARS) {
    return {
      ok: false,
      code: 'too-large',
      message: `文件过大（超过 ${Math.floor(MAX_IMPORT_CHARS / 1024)} KiB），未导入。`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: 'invalid-json', message: '文件不是有效的 JSON（可能已损坏），未导入。' };
  }
  if (!isPlainRecord(parsed)) {
    return { ok: false, code: 'wrong-format', message: '不是本扩展导出的方案文件，未导入。' };
  }
  if (parsed['format'] !== SCENARIO_FORMAT) {
    return {
      ok: false,
      code: 'wrong-format',
      message: '不是本扩展导出的方案文件（缺少方案格式标记，可能是旧格式或其他文件），未导入。',
    };
  }
  const version = parsed['version'];
  if (!Number.isInteger(version) || (version as number) < 1) {
    return { ok: false, code: 'invalid-fields', message: '方案文件版本字段无效，未导入。' };
  }
  if ((version as number) > SCENARIO_VERSION) {
    return {
      ok: false,
      code: 'unsupported-version',
      message: `方案文件版本（${String(version)}）高于当前支持的版本（${SCENARIO_VERSION}），未导入。`,
    };
  }
  if (!isScenarioRecord(parsed)) {
    return { ok: false, code: 'invalid-fields', message: '方案文件字段缺失或无效，未导入。' };
  }
  if (JSON.stringify(parsed).length > MAX_SCENARIO_CHARS) {
    return {
      ok: false,
      code: 'too-large',
      message: `方案记录过大（超过 ${Math.floor(MAX_SCENARIO_CHARS / 1024)} KiB），未导入。`,
    };
  }
  return { ok: true, scenario: parsed };
}

export type ScenarioDocMatch =
  | { ok: true }
  | { ok: false; message: string };

/** 导入/应用前的引用校验：方案必须属于当前卡片的同一文档与协议。 */
export function checkScenarioDocument(
  scenario: SavedScenario,
  document: GenuiDocument,
  documentHash: string,
): ScenarioDocMatch {
  if (scenario.documentHash !== documentHash) {
    return { ok: false, message: '方案属于其他界面（文档哈希不同），无法用于当前卡片，未导入。' };
  }
  if (scenario.protocolVersion !== document.version) {
    return {
      ok: false,
      message: `协议版本不同（方案 v${scenario.protocolVersion} / 当前 v${document.version}），无法用于当前卡片，未导入。`,
    };
  }
  if (scenario.stateSignature !== documentStateSignature(document)) {
    return { ok: false, message: '状态字段定义已变化，方案无法用于当前卡片，未导入。' };
  }
  return { ok: true };
}

export interface ScenarioDiffRow {
  kind: 'state' | 'derived';
  id: string;
  a: string;
  b: string;
  changed: boolean;
  /** 数值差（b - a）；双方均为有限数字时存在。 */
  delta?: number;
}

export type ScenarioComparison =
  | { compatible: false; reasons: string[] }
  | { compatible: true; rows: ScenarioDiffRow[]; changedCount: number; notes: string[] };

function stateValueText(scenario: SavedScenario, id: string): string {
  const value = getOwn(scenario.values, id);
  if (value === undefined) return '（未确认）';
  return typeof value === 'number' ? String(value) : value;
}

function resultCellText(results: ScenarioResults, id: string): { text: string; numeric?: number } {
  const error = getOwn(results.errors, id);
  if (error !== undefined) return { text: `无法计算（${error}）` };
  const value = getOwn(results.values, id);
  if (value === undefined || !Number.isFinite(value)) return { text: '（无结果）' };
  return { text: String(value), numeric: value };
}

function rawResultEquals(a: ScenarioResults, b: ScenarioResults, id: string): boolean {
  const aError = getOwn(a.errors, id);
  const bError = getOwn(b.errors, id);
  if (aError !== undefined || bError !== undefined) return aError === bError;
  return getOwn(a.values, id) === getOwn(b.values, id);
}

/**
 * 并排比较两份方案：仅当同文档、同字段签名、同协议与同规则版本时给出
 * 差异行；任一不兼容都返回明确理由（不输出误导性比较）。
 */
export function compareScenarios(
  a: SavedScenario,
  b: SavedScenario,
  document: GenuiDocument,
  documentHash: string,
): ScenarioComparison {
  const reasons: string[] = [];
  if (a.documentHash !== b.documentHash || a.documentHash !== documentHash) {
    reasons.push('两份方案来自不同的界面内容（文档哈希不同），字段与单位可能不同，无法比较。');
  }
  if (a.stateSignature !== b.stateSignature || a.stateSignature !== documentStateSignature(document)) {
    reasons.push('状态字段定义不同（取值域或选项已变化），无法比较。');
  }
  if (a.protocolVersion !== b.protocolVersion || a.protocolVersion !== document.version) {
    reasons.push(`协议版本不同（方案 v${a.protocolVersion} / v${b.protocolVersion} / 当前 v${document.version}），无法比较。`);
  }
  if (a.ruleVersion !== b.ruleVersion) {
    reasons.push(`计算规则版本不同（规则 ${a.ruleVersion} / 规则 ${b.ruleVersion}），结果口径不同，无法比较。`);
  }
  if (reasons.length > 0) return { compatible: false, reasons };

  const rows: ScenarioDiffRow[] = [];
  const notes: string[] = [];

  if (document.version !== 1) {
    for (const variable of document.state) {
      const left = stateValueText(a, variable.id);
      const right = stateValueText(b, variable.id);
      const rawA = getOwn(a.values, variable.id);
      const rawB = getOwn(b.values, variable.id);
      const row: ScenarioDiffRow = {
        kind: 'state',
        id: variable.id,
        a: left,
        b: right,
        changed: rawA !== rawB,
      };
      if (typeof rawA === 'number' && typeof rawB === 'number') row.delta = rawB - rawA;
      rows.push(row);
    }
    for (const derived of document.derived) {
      const left = resultCellText(a.results, derived.id);
      const right = resultCellText(b.results, derived.id);
      const row: ScenarioDiffRow = {
        kind: 'derived',
        id: derived.id,
        a: left.text,
        b: right.text,
        changed: !rawResultEquals(a.results, b.results, derived.id),
      };
      if (left.numeric !== undefined && right.numeric !== undefined) {
        row.delta = right.numeric - left.numeric;
      }
      rows.push(row);
    }
  }

  const changedCount = rows.filter((row) => row.changed).length;
  if (a.ruleVersion !== CALC_RULE_VERSION || b.ruleVersion !== CALC_RULE_VERSION) {
    notes.push('方案保存时的计算规则版本与当前不同，结果可能需要按当前规则重新计算。');
  }
  if (a.documentHash !== b.documentHash) {
    notes.push('两份方案的资料依据不同，已按当前界面字段展示。');
  }
  return { compatible: true, rows, changedCount, notes };
}

export interface RecomputeDiff {
  id: string;
  saved: string;
  current: string;
  changed: boolean;
}

export interface RecomputeReport {
  /** 当前文档能否按当前规则重算（字段与协议兼容）。 */
  ok: boolean;
  /** 不可重算时的说明。 */
  note?: string;
  /** 保存时规则与当前规则是否不同。 */
  ruleChanged: boolean;
  /** 资料依据（文档）是否与保存时不同。 */
  dataChanged: boolean;
  /** 重算时被忽略的越界参数个数。 */
  droppedFields: number;
  diffs: RecomputeDiff[];
  changed: boolean;
}

/**
 * 「按当前规则重新计算」对照：用方案保存的输入在当前文档上重算派生值，
 * 与保存时的结果逐项对比，提示规则或数据变化。
 */
export function recomputeScenario(
  scenario: SavedScenario,
  document: GenuiDocument,
  documentHash: string,
): RecomputeReport {
  const ruleChanged = scenario.ruleVersion !== CALC_RULE_VERSION;
  const dataChanged = scenario.documentHash !== documentHash;
  if (document.version === 1) {
    return {
      ok: false,
      note: '当前界面没有可重算的派生结果。',
      ruleChanged,
      dataChanged,
      droppedFields: 0,
      diffs: [],
      changed: false,
    };
  }
  if (scenario.protocolVersion !== document.version) {
    return {
      ok: false,
      note: `协议版本不同（方案 v${scenario.protocolVersion} / 当前 v${document.version}），无法按当前规则重算。`,
      ruleChanged,
      dataChanged,
      droppedFields: 0,
      diffs: [],
      changed: false,
    };
  }
  if (scenario.stateSignature !== documentStateSignature(document)) {
    return {
      ok: false,
      note: '状态字段定义已变化，无法按当前规则重算；以下为保存时结果。',
      ruleChanged,
      dataChanged,
      droppedFields: 0,
      diffs: [],
      changed: false,
    };
  }

  const sanitized = sanitizeCardValues(document, scenario.values);
  const calculation: DerivedCalculation =
    document.version === 2
      ? calculateDerived(document, sanitized.values)
      : evaluateComposite(document, sanitized.values).derived;

  const ids = new Set<string>([
    ...Object.keys(scenario.results.values),
    ...Object.keys(scenario.results.errors),
    ...document.derived.map((item) => item.id),
  ]);
  const diffs: RecomputeDiff[] = [];
  for (const id of ids) {
    const saved = resultCellText(scenario.results, id);
    const currentError = getOwn(calculation.errors, id);
    const currentValue = getOwn(calculation.values, id);
    const currentText =
      currentError !== undefined
        ? `无法计算（${currentError}）`
        : currentValue !== undefined && Number.isFinite(currentValue)
          ? String(currentValue)
          : '（无结果）';
    diffs.push({
      id,
      saved: saved.text,
      current: currentText,
      changed: saved.text !== currentText,
    });
  }
  return {
    ok: true,
    ruleChanged,
    dataChanged,
    droppedFields: sanitized.dropped.length,
    diffs,
    changed: diffs.some((item) => item.changed),
  };
}

export function formatScenarioTime(savedAt: number): string {
  const date = new Date(savedAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function resultLabelMap(document: GenuiDocument): Map<string, { label: string; unit?: string }> {
  const map = new Map<string, { label: string; unit?: string }>();
  if (document.version === 1) return map;
  for (const variable of document.state) {
    map.set(variable.id, { label: variable.label, unit: variable.kind === 'number' ? variable.unit : undefined });
  }
  for (const derived of document.derived) {
    map.set(derived.id, { label: derived.label, unit: derived.unit });
  }
  return map;
}

function stateDisplayText(scenario: SavedScenario, id: string, label: string, unit?: string): string {
  const value = getOwn(scenario.values, id);
  if (value === undefined) return `${label}：（未确认）`;
  if (typeof value === 'number') {
    return `${label}：${String(value)}${unit ? ` ${unit}` : ''}`;
  }
  return `${label}：${value}`;
}

function resultDisplayText(results: ScenarioResults, id: string, label: string, unit?: string): string {
  const error = getOwn(results.errors, id);
  if (error !== undefined) return `${label}：无法计算（${error}）`;
  const value = getOwn(results.values, id);
  if (value === undefined || !Number.isFinite(value)) return `${label}：（无结果）`;
  return `${label}：${String(value)}${unit ? ` ${unit}` : ''}`;
}

/** 可读摘要导出与「继续讨论」交接共用的纯文本格式。 */
export function buildScenarioSummary(scenario: SavedScenario, document: GenuiDocument): string {
  const lines: string[] = [];
  lines.push(`方案「${scenario.name}」（保存于 ${formatScenarioTime(scenario.savedAt)}）`);
  lines.push(
    `资料依据：${scenario.source.title || '（无标题）'} · 协议 v${scenario.protocolVersion} · 规则 v${scenario.ruleVersion} · 文档 ${scenario.documentHash}`,
  );
  lines.push('参数：');
  if (document.version === 1) {
    lines.push('（静态文档无参数）');
  } else {
    for (const variable of document.state) {
      lines.push(`- ${stateDisplayText(scenario, variable.id, variable.label, variable.kind === 'number' ? variable.unit : undefined)}`);
    }
  }
  lines.push('结果（保存时）：');
  if (document.version === 1 || document.derived.length === 0) {
    lines.push('（无派生结果）');
  } else {
    for (const derived of document.derived) {
      lines.push(`- ${resultDisplayText(scenario.results, derived.id, derived.label, derived.unit)}`);
    }
  }
  const recompute = recomputeScenario(scenario, document, scenario.documentHash);
  if (recompute.ok && recompute.changed) {
    lines.push('提示：按当前规则重算的结果与保存时不一致（规则或数据已变化）。');
  }
  lines.push('请基于以上保存的方案继续讨论。');
  return lines.join('\n');
}

export interface ComparisonSummaryInput {
  a: SavedScenario;
  b: SavedScenario;
  document: GenuiDocument;
  documentHash: string;
}
/** 两方案差异的可读摘要（导出与「继续讨论」交接共用）。 */
export function buildComparisonSummary(input: ComparisonSummaryInput): string | null {
  const comparison = compareScenarios(input.a, input.b, input.document, input.documentHash);
  if (!comparison.compatible) return null;
  const labels = resultLabelMap(input.document);
  const lines: string[] = [];
  lines.push(`方案对比「${input.a.name}」vs「${input.b.name}」：`);
  for (const row of comparison.rows) {
    if (!row.changed) continue;
    const meta = labels.get(row.id);
    const label = meta?.label ?? row.id;
    const unit = meta?.unit ? ` ${meta.unit}` : '';
    if (row.kind === 'state') {
      lines.push(`- ${label}：${row.a}${unit} → ${row.b}${unit}`);
    } else if (row.delta !== undefined) {
      const sign = row.delta > 0 ? '+' : '';
      lines.push(`- ${label}：${row.a}${unit} → ${row.b}${unit}（${sign}${String(row.delta)}）`);
    } else {
      lines.push(`- ${label}：${row.a} → ${row.b}`);
    }
  }
  const unchanged = comparison.rows.length - comparison.changedCount;
  if (unchanged > 0) lines.push(`其余 ${unchanged} 项参数与结果一致。`);
  if (comparison.notes.length > 0) lines.push(...comparison.notes.map((note) => `提示：${note}`));
  lines.push('请基于以上方案差异继续讨论。');
  return lines.join('\n');
}

/** 保存结果：成功带 message（含淘汰提示），失败带原因。 */
export type ScenarioSaveOutcome =
  | { ok: true; savedAt: number; evicted: number; message: string }
  | { ok: false; message: string };

export type ScenarioOpOutcome =
  | { ok: true; message: string }
  | { ok: false; message: string };

export type ScenarioClearOutcome =
  | { ok: true; removed: number; message: string }
  | { ok: false; message: string };

export type ScenarioImportOutcome =
  | { ok: true; message: string }
  | { ok: false; message: string };

export interface ScenarioSaveRequest {
  name: string;
  values: InteractiveStateValues;
  tables: Record<string, TableViewState>;
  results: ScenarioResults;
}

/**
 * 卡片侧的方案端口（render 只依赖此接口，content 层负责实现）：
 * 列表/保存/删除/清除/导入。实现方绑定当前文档、身份与本机存储。
 */
export interface ScenarioPort {
  /** 当前卡片的文档哈希，用于筛选本界面方案与比较兼容判定。 */
  readonly documentHash: string;
  list(): Promise<SavedScenario[]>;
  save(request: ScenarioSaveRequest): Promise<ScenarioSaveOutcome>;
  remove(id: string, name: string): Promise<ScenarioOpOutcome>;
  clear(): Promise<ScenarioClearOutcome>;
  importText(text: string): Promise<ScenarioImportOutcome>;
}
