/**
 * 方案导出/导入（Issue 8 验收：导出、导入与继续讨论保留必要依据与时间）。
 *
 * 只交换纯数据：协议文档（含 v6 sources/basis）+ 当前状态 + 导出时间。
 * - 导入复用 parseGenui 的完整结构/语义校验，不执行任何代码；
 * - 状态逐项校验范围、步长与选项，缺项或多项都拒绝；
 * - 旧协议（v2–v5）也可以导出导入，依据字段缺省时按未知处理；
 * - 插件不请求来源 URL，也不把导入内容写回聊天页面。
 */

import { isStepAligned } from './step';
import { isValidProvenanceDate } from './provenance';
import {
  type GenuiDocument,
  type InteractiveStateValues,
  type StateVariable,
} from './types';
import { parseGenui } from './validate';

export const PLAN_TYPE = 'genui-plan';
export const PLAN_FORMAT_VERSION = 1;
/** 方案文件上限；比协议原始 JSON 宽松，容纳文档与状态。 */
export const PLAN_MAX_LENGTH = 256 * 1024;

export type InteractiveDocument = Exclude<GenuiDocument, { version: 1 }>;

export interface GenuiPlan {
  type: typeof PLAN_TYPE;
  formatVersion: typeof PLAN_FORMAT_VERSION;
  /** ISO 时间，表示导出瞬间；不是资料核验时间。 */
  exportedAt: string;
  document: InteractiveDocument;
  state: InteractiveStateValues;
  /**
   * 已被用户修改的状态 id。界面与摘要据此把「当前值」与「原始依据」区分开；
   * 缺省表示旧方案没有记录，导入时可从 state 与 initial 的差异推断。
   */
  editedState?: string[];
}

export type PlanFailureCode =
  | 'too-large'
  | 'invalid-plan'
  | 'unsupported-version'
  | 'invalid-document'
  | 'invalid-state';

export type PlanImportResult =
  | { ok: true; plan: GenuiPlan }
  | { ok: false; code: PlanFailureCode; detail: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function planFailure(code: PlanFailureCode, detail: string): PlanImportResult {
  return { ok: false, code, detail };
}

/**
 * 逐项校验导入状态：键必须与文档状态项一一对应。
 * 缺失值不会被补成 0，多余键也不会被静默忽略。
 */
export function validateStateValues(
  variables: readonly StateVariable[],
  state: unknown,
): { ok: true; state: InteractiveStateValues } | { ok: false; detail: string } {
  if (!isRecord(state)) {
    return { ok: false, detail: 'state 必须是对象' };
  }
  for (const key of Object.keys(state)) {
    if (!variables.some((variable) => variable.id === key)) {
      return { ok: false, detail: `state 包含未定义的状态项：${key}` };
    }
  }
  const values: InteractiveStateValues = {};
  for (const variable of variables) {
    if (!own(state, variable.id)) {
      return { ok: false, detail: `缺少状态项：${variable.id}` };
    }
    const value = state[variable.id];
    if (variable.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, detail: `状态 ${variable.id} 必须是有限数字` };
      }
      if (
        value < variable.min ||
        value > variable.max ||
        !isStepAligned(value, variable.min, variable.step)
      ) {
        return { ok: false, detail: `状态 ${variable.id} 超出范围或不符合步长` };
      }
      values[variable.id] = value;
      continue;
    }
    if (typeof value !== 'string' || !variable.options.some((option) => option.value === value)) {
      return { ok: false, detail: `状态 ${variable.id} 不在允许选项中` };
    }
    values[variable.id] = value;
  }
  return { ok: true, state: values };
}

/** 生成可下载的方案对象；v1 没有可交互状态，不导出。 */
export function createPlan(
  document: GenuiDocument,
  state: InteractiveStateValues,
  now: Date = new Date(),
  editedState: readonly string[] = [],
): GenuiPlan {
  if (document.version === 1) {
    throw new Error('静态 v1 界面没有可导出的交互状态');
  }
  const knownIds = new Set(document.state.map((variable) => variable.id));
  const edited = [...new Set(editedState)].filter((id) => knownIds.has(id)).sort();
  return {
    type: PLAN_TYPE,
    formatVersion: PLAN_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    document,
    state: { ...state },
    ...(edited.length === 0 ? {} : { editedState: edited }),
  };
}

export function serializePlan(
  document: GenuiDocument,
  state: InteractiveStateValues,
  now: Date = new Date(),
  editedState: readonly string[] = [],
): string {
  return JSON.stringify(createPlan(document, state, now, editedState), null, 2);
}

/**
 * 解析并验证方案文件。错误 detail 面向界面反馈，不包含原始内容片段。
 */
export function parsePlanImport(raw: string): PlanImportResult {
  if (raw.length > PLAN_MAX_LENGTH) {
    return planFailure('too-large', `方案文件超过 ${PLAN_MAX_LENGTH} 字符`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return planFailure('invalid-plan', '方案文件不是合法 JSON');
  }
  if (!isRecord(parsed)) {
    return planFailure('invalid-plan', '方案文件根节点必须是对象');
  }
  const allowed = new Set([
    'type',
    'formatVersion',
    'exportedAt',
    'document',
    'state',
    'editedState',
  ]);
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key)) {
      return planFailure('invalid-plan', `方案文件包含未知字段：${key}`);
    }
  }
  if (parsed.type !== PLAN_TYPE) {
    return planFailure('invalid-plan', '不是 GenUI 方案文件');
  }
  if (parsed.formatVersion !== PLAN_FORMAT_VERSION) {
    return planFailure('unsupported-version', `不支持的方案格式版本：${String(parsed.formatVersion)}`);
  }
  if (
    typeof parsed.exportedAt !== 'string' ||
    !isValidProvenanceDate(parsed.exportedAt)
  ) {
    return planFailure('invalid-plan', '导出时间无效');
  }
  if (!isRecord(parsed.document)) {
    return planFailure('invalid-document', '方案缺少界面文档');
  }
  const documentResult = parseGenui(JSON.stringify(parsed.document));
  if (!documentResult.ok) {
    return planFailure(
      'invalid-document',
      `方案中的界面无法通过校验：${documentResult.detail}`,
    );
  }
  if (documentResult.document.version === 1) {
    return planFailure('invalid-document', '静态 v1 界面没有可恢复的交互状态');
  }
  const stateResult = validateStateValues(documentResult.document.state, parsed.state);
  if (!stateResult.ok) {
    return planFailure('invalid-state', stateResult.detail);
  }
  let editedState: string[] | undefined;
  if (own(parsed, 'editedState')) {
    const rawEdited = parsed.editedState;
    if (!Array.isArray(rawEdited) || rawEdited.some((id) => typeof id !== 'string')) {
      return planFailure('invalid-state', 'editedState 必须是状态 id 数组');
    }
    const ids = rawEdited as string[];
    if (new Set(ids).size !== ids.length) {
      return planFailure('invalid-state', 'editedState 包含重复项');
    }
    for (const id of ids) {
      if (!documentResult.document.state.some((variable) => variable.id === id)) {
        return planFailure('invalid-state', `editedState 包含未定义的状态项：${id}`);
      }
    }
    editedState = [...ids].sort();
  }
  return {
    ok: true,
    plan: {
      type: PLAN_TYPE,
      formatVersion: PLAN_FORMAT_VERSION,
      exportedAt: parsed.exportedAt,
      document: documentResult.document,
      state: stateResult.state,
      ...(editedState === undefined ? {} : { editedState }),
    },
  };
}
