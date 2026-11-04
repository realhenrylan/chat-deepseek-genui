import type { CardUiState } from './card-state';

/**
 * 页面内卡片状态仓库（issue #2）：以稳定卡片身份为键，保存业务输入与
 * 表格筛选/排序。React 组件卸载、DOM 节点替换或流式重渲染后，重新挂载
 * 的卡片仍能读回同一份状态。
 *
 * 只保存在当前页面内存：刷新即失效，除非用户主动「保存方案」写入
 * chrome.storage.local。条目有上限并按插入顺序淘汰，避免长时间会话无限增长。
 */
export const MAX_IN_MEMORY_CARD_STATES = 200;

export interface CardStateStore {
  get(key: string): CardUiState | undefined;
  set(key: string, state: CardUiState): void;
  delete(key: string): void;
  clear(): void;
  size(): number;
}

export function createCardStateStore(limit = MAX_IN_MEMORY_CARD_STATES): CardStateStore {
  const states = new Map<string, CardUiState>();
  const max = Math.max(1, limit);

  const trim = (): void => {
    while (states.size > max) {
      const oldest = states.keys().next();
      if (oldest.done) return;
      states.delete(oldest.value);
    }
  };

  return {
    get(key) {
      return states.get(key);
    },
    set(key, state) {
      // 先删除再写入，使 Map 的插入顺序反映最近使用时间（LRU 淘汰）。
      states.delete(key);
      states.set(key, state);
      trim();
    },
    delete(key) {
      states.delete(key);
    },
    clear() {
      states.clear();
    },
    size() {
      return states.size;
    },
  };
}
