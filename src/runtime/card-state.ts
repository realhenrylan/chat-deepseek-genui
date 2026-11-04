import type { GenuiDocument, InteractiveStateValues } from '../protocol/types';
import { createInitialState } from './evaluate';

/**
 * 卡片业务状态（issue #2）：与 React 组件生命周期分离的输入值 + 表格视图状态。
 *
 * - 组件只负责把变化写入外部仓库；重新挂载时从仓库读回，避免节点替换、
 *   流式重渲染导致用户调好的参数回到初值；
 * - 状态只保存在页面内仓库，不写入扩展存储，也不跨刷新恢复；
 * - 状态结构版本独立于协议版本，后续字段调整时可整体拒绝旧记录。
 */

/** 卡片状态结构版本；语义变化时递增。 */
export const CARD_STATE_VERSION = 1;

/** 表格的筛选、排序与候选项选择（视图状态，不改变文档 state）。 */
export interface TableViewState {
  filter: string;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  /** 选中的候选项：文档中的原始行序号（0 基），排序/筛选不改变它。 */
  selected?: number | null;
  /**
   * 显式指定的对比候选项（原始行序号）。可见行超过两行时，
   * 用户必须自己选择对比项，不能猜测「另一行」是谁。
   */
  compare?: number | null;
}

export interface CardUiState {
  values: InteractiveStateValues;
  /** 以组合渲染路径为键；文档结构变化会使路径变化，旧条目自然失效。 */
  tables: Record<string, TableViewState>;
}

/** 初始卡片状态：交互值取协议初始值，表格视图为空（渲染时回退 initialSort）。 */
export function createCardUiState(doc: GenuiDocument): CardUiState {
  return {
    values: doc.version === 1 ? {} : createInitialState(doc),
    tables: {},
  };
}
