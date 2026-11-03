import type { GenuiDocument, InteractiveStateValues } from '../protocol/types';
import { isStepAligned } from '../protocol/step';
import { createInitialState } from './evaluate';
import { hashString } from './hash';

/**
 * 卡片业务状态（issue #2）：与 React 组件生命周期分离的输入值 + 表格视图状态。
 *
 * - 组件只负责把变化写入外部仓库；重新挂载时从仓库读回，避免节点替换、
 *   流式重渲染导致用户调好的参数回到初值；
 * - 持久化只保存这里定义的字段，且仅在用户点击「保存方案」后写入；
 * - 恢复前必须通过文档哈希与状态结构签名校验；任一不匹配即按新文档重置，
 *   不把旧输入应用到不兼容的文档；
 * - 状态结构版本独立于协议版本，后续字段调整时可整体拒绝旧记录。
 */

/** 卡片状态结构版本；语义变化时递增，旧记录会因不匹配被丢弃。 */
export const CARD_STATE_VERSION = 1;

/** 表格的筛选与排序（视图状态，不改变文档 state）。 */
export interface TableViewState {
  filter: string;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
}

export interface CardUiState {
  values: InteractiveStateValues;
  /** 以组合渲染路径为键；文档结构变化会使路径变化，旧条目自然失效。 */
  tables: Record<string, TableViewState>;
}

/** 本机保存的方案记录；键为卡片身份键，记录内再存身份分片用于校验。 */
export interface SavedCardPlan {
  stateVersion: number;
  documentHash: string;
  stateSignature: string;
  /** 账号作用域哈希（不保存原始账号 id）。 */
  accountId: string;
  sessionId: string;
  messageKey: string;
  duplicateIndex: number;
  savedAt: number;
  values: InteractiveStateValues;
  tables: Record<string, TableViewState>;
}

export type PlanSaveResult =
  | { ok: true; savedAt: number; evicted: number }
  | { ok: false; message: string };

export type PlanClearResult = { ok: true } | { ok: false; message: string };

const MAX_TABLE_VIEWS = 40;
const MAX_TABLE_FILTER_LENGTH = 200;
const MAX_TABLE_SORT_KEY_LENGTH = 64;
/** 行序号上限：文档最多 30 行，这里放宽以便跨版本恢复时再按文档校验。 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 初始卡片状态：交互值取协议初始值，表格视图为空（渲染时回退 initialSort）。 */
export function createCardUiState(doc: GenuiDocument): CardUiState {
  return {
    values: doc.version === 1 ? {} : createInitialState(doc),
    tables: {},
  };
}

/**
 * 状态结构签名：协议版本 + 每个状态变量的类型与取值域。
 * 与文档哈希配合，覆盖「同哈希但状态范围被改写」的极端情况。
 */
export function documentStateSignature(doc: GenuiDocument): string {
  if (doc.version === 1) return 'v1';
  const parts = doc.state.map((variable) => {
    if (variable.kind === 'number') {
      return [
        'number',
        variable.id,
        variable.initial,
        variable.min,
        variable.max,
        variable.step,
      ];
    }
    return ['select', variable.id, variable.initial, variable.options.map((option) => option.value)];
  });
  return hashString(JSON.stringify([doc.version, parts]));
}

/**
 * 按当前文档校验并清洗交互值：只接受仍存在、类型匹配、位于范围内且
 * 步长对齐的字段；其余字段回落该变量的初始值并报告。
 */
export function sanitizeCardValues(
  doc: GenuiDocument,
  input: unknown,
): { values: InteractiveStateValues; dropped: string[] } {
  if (doc.version === 1) return { values: {}, dropped: [] };
  const source = isRecord(input) ? input : {};
  const values: InteractiveStateValues = {};
  const dropped: string[] = [];

  for (const variable of doc.state) {
    const candidate = Object.hasOwn(source, variable.id) ? source[variable.id] : undefined;
    if (variable.kind === 'number') {
      if (
        typeof candidate === 'number' &&
        Number.isFinite(candidate) &&
        candidate >= variable.min &&
        candidate <= variable.max &&
        isStepAligned(candidate, variable.min, variable.step)
      ) {
        values[variable.id] = candidate;
      } else {
        values[variable.id] = variable.initial;
        if (candidate !== undefined) dropped.push(variable.id);
      }
    } else if (
      typeof candidate === 'string' &&
      variable.options.some((option) => option.value === candidate)
    ) {
      values[variable.id] = candidate;
    } else {
      values[variable.id] = variable.initial;
      if (candidate !== undefined) dropped.push(variable.id);
    }
  }

  return { values, dropped };
}

/** 清洗表格视图状态：限制条目数、筛选文本长度与排序键形状。 */
export function sanitizeTableViews(input: unknown): Record<string, TableViewState> {
  if (!isRecord(input)) return {};
  const views: Record<string, TableViewState> = {};
  let count = 0;

  for (const [path, raw] of Object.entries(input)) {
    if (count >= MAX_TABLE_VIEWS) break;
    if (typeof path !== 'string' || path.length === 0 || path.length > 160) continue;
    if (!isRecord(raw)) continue;

    const filter =
      typeof raw.filter === 'string' ? raw.filter.slice(0, MAX_TABLE_FILTER_LENGTH) : '';
    let sort: TableViewState['sort'] = null;
    if (isRecord(raw.sort)) {
      const key = raw.sort.key;
      const dir = raw.sort.dir;
      if (
        typeof key === 'string' &&
        key.length > 0 &&
        key.length <= MAX_TABLE_SORT_KEY_LENGTH &&
        (dir === 'asc' || dir === 'desc')
      ) {
        sort = { key, dir };
      }
    }
    views[path] = { filter, sort };
    count += 1;
  }

  return views;
}

/**
 * 用保存记录恢复状态：调用方必须先确认记录与当前文档兼容
 * （isCompatibleSavedPlan）；这里只做字段级清洗，不判断身份。
 */
export function restoreCardUiState(
  doc: GenuiDocument,
  plan: Pick<SavedCardPlan, 'values' | 'tables'>,
): { state: CardUiState; dropped: string[] } {
  const { values, dropped } = sanitizeCardValues(doc, plan.values);
  return { state: { values, tables: sanitizeTableViews(plan.tables) }, dropped };
}

/** 保存记录是否适用于当前文档（同原始文本 + 同状态结构 + 同状态版本）。 */
export function isCompatibleSavedPlan(
  plan: SavedCardPlan,
  doc: GenuiDocument,
  documentHash: string,
): boolean {
  return (
    plan.stateVersion === CARD_STATE_VERSION &&
    plan.documentHash === documentHash &&
    plan.stateSignature === documentStateSignature(doc)
  );
}
