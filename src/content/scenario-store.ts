/**
 * 具名方案的本机存储与「方案端口」实现（issue #6）。
 *
 * - 一条方案一个 storage 键（`genuiScenario:<id>`），避免多标签页互相覆盖；
 * - 保存后按 savedAt 保留最近 MAX_SCENARIOS 条，超出时删除最旧记录；
 * - 读取时丢弃结构异常或异常巨大的记录（isScenarioRecord），不做猜测迁移；
 * - 导入先做格式/大小/版本/引用校验（parseScenarioImport + checkScenarioDocument），
 *   只解析 JSON 不执行任何导入内容中的代码，且已存在同 id 的方案不覆盖；
 * - 清除/删除直接移除本地键；只使用 chrome.storage.local，不做云同步或上传。
 */
import type { GenuiDocument, InteractiveStateValues } from '../protocol/types';
import { documentStateSignature, sanitizeCardValues, sanitizeTableViews, type TableViewState } from '../runtime/card-state';
import {
  CALC_RULE_VERSION,
  MAX_SCENARIO_CHARS,
  MAX_SCENARIO_NAME_LENGTH,
  checkScenarioDocument,
  createScenario,
  isScenarioRecord,
  parseScenarioImport,
  validateScenarioReferences,
  type ScenarioClearOutcome,
  type ScenarioImportOutcome,
  type ScenarioOpOutcome,
  type ScenarioPort,
  type ScenarioSaveOutcome,
  type ScenarioSaveRequest,
  type SavedScenario,
} from '../runtime/scenario';
import { describeStorageError, type PlanStorageArea } from './plan-store';

export const SCENARIO_KEY_PREFIX = 'genuiScenario:';
export const MAX_SCENARIOS = 50;

/** 与 plan-store 共用同一异步存储接口，便于单测注入内存实现。 */
export type ScenarioStorageArea = PlanStorageArea;

export interface ScenarioStore {
  loadAll(): Promise<Record<string, SavedScenario>>;
  save(scenario: SavedScenario): Promise<ScenarioSaveOutcome>;
  remove(id: string): Promise<ScenarioOpOutcome>;
  clear(): Promise<ScenarioClearOutcome>;
}

/** 按 savedAt 从新到旧排序；读取与容量淘汰共用同一口径。 */
export function sortScenarios(
  scenarios: Record<string, SavedScenario>,
): Array<[string, SavedScenario]> {
  return Object.entries(scenarios).sort((left, right) => {
    const delta = right[1].savedAt - left[1].savedAt;
    return delta !== 0 ? delta : left[0].localeCompare(right[0]);
  });
}

function storageKey(id: string): string {
  return `${SCENARIO_KEY_PREFIX}${id}`;
}

function scenarioIdOf(key: string): string | null {
  if (!key.startsWith(SCENARIO_KEY_PREFIX)) return null;
  const trimmed = key.slice(SCENARIO_KEY_PREFIX.length);
  return trimmed.length > 0 ? trimmed : null;
}

export function createScenarioStore(
  area: ScenarioStorageArea,
  limit = MAX_SCENARIOS,
): ScenarioStore {
  const max = Math.max(1, limit);

  async function loadAll(): Promise<Record<string, SavedScenario>> {
    const stored = await area.get(null);
    const scenarios: Record<string, SavedScenario> = {};
    for (const [key, value] of Object.entries(stored)) {
      const id = scenarioIdOf(key);
      if (!id || !isScenarioRecord(value)) continue;
      scenarios[id] = value;
    }
    return scenarios;
  }

  return {
    loadAll,

    async save(scenario) {
      if (!isScenarioRecord(scenario)) {
        return { ok: false, message: '保存失败：方案记录无效。' };
      }
      try {
        const all = await loadAll();
        all[scenario.id] = scenario;
        const ordered = sortScenarios(all);
        const kept = ordered.slice(0, max);
        const evicted = ordered.slice(max);

        await area.set({ [storageKey(scenario.id)]: scenario });
        if (evicted.length > 0) {
          await area.remove(evicted.map(([id]) => storageKey(id)));
        }
        // 新记录本身也可能因时间戳异常被淘汰；如实反馈，不留幽灵状态。
        const retained = kept.some(([id]) => id === scenario.id);
        if (!retained) {
          return { ok: false, message: '保存失败：方案列表已满，当前记录未能保留。' };
        }
        const suffix = evicted.length > 0 ? `；超出容量上限，已清理最早 ${evicted.length} 条保存。` : '。';
        return {
          ok: true,
          savedAt: scenario.savedAt,
          evicted: evicted.length,
          message: `已保存方案「${scenario.name}」到本机${suffix}`,
        };
      } catch (error) {
        return { ok: false, message: `保存失败：${describeStorageError(error)}` };
      }
    },

    async remove(id) {
      try {
        await area.remove(storageKey(id));
        return { ok: true, message: '已从本机删除。' };
      } catch (error) {
        return { ok: false, message: `删除失败：${describeStorageError(error)}` };
      }
    },

    async clear() {
      try {
        const stored = await area.get(null);
        const keys = Object.keys(stored).filter((key) => key.startsWith(SCENARIO_KEY_PREFIX));
        if (keys.length > 0) await area.remove(keys);
        return {
          ok: true,
          removed: keys.length,
          message: keys.length > 0 ? `已清除本机保存的 ${keys.length} 条方案。` : '本机没有已保存的方案。',
        };
      } catch (error) {
        return { ok: false, message: `清除失败：${describeStorageError(error)}` };
      }
    },
  };
}

/** 生产适配：缺少扩展存储 API（单测/非扩展页面）时返回 null。 */
export function createChromeScenarioStore(): ScenarioStore | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null;
  }
  const area: ScenarioStorageArea = {
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove(keys),
  };
  return createScenarioStore(area);
}

export interface ScenarioPortContext {
  store: ScenarioStore;
  document: GenuiDocument;
  documentHash: string;
  source: {
    sessionId: string;
    messageKey: string;
    duplicateIndex: number;
    title: string;
  };
  now: () => number;
}

/**
 * 绑定当前卡片的方案端口：保存时按当前文档 sanitize 参数与表格视图，
 * 导入时先校验格式/大小/版本/引用且不覆盖已有方案。
 */
export function createScenarioPort(context: ScenarioPortContext): ScenarioPort {
  const { store, document, documentHash, source, now } = context;

  return {
    documentHash,

    async list() {
      try {
        return sortScenarios(await store.loadAll()).map(([, scenario]) => scenario);
      } catch {
        return [];
      }
    },

    async save(request: ScenarioSaveRequest): Promise<ScenarioSaveOutcome> {
      const name = request.name.trim().slice(0, MAX_SCENARIO_NAME_LENGTH);
      if (!name) {
        return { ok: false, message: '保存失败：请先填写方案名称。' };
      }
      const sanitizedValues: InteractiveStateValues = sanitizeCardValues(document, request.values).values;
      const tables: Record<string, TableViewState> = sanitizeTableViews(request.tables);
      const scenario = createScenario({
        name,
        savedAt: now(),
        documentHash,
        stateSignature: documentStateSignature(document),
        protocolVersion: document.version,
        source,
        values: sanitizedValues,
        tables,
        results: {
          values: sanitizeResultValues(request.results.values),
          errors: sanitizeResultErrors(request.results.errors),
        },
      });
      return store.save(scenario);
    },

    async remove(id, name) {
      const outcome = await store.remove(id);
      return outcome.ok ? { ok: true, message: `已删除方案「${name}」。` } : outcome;
    },

    async clear() {
      return store.clear();
    },

    async importText(text): Promise<ScenarioImportOutcome> {
      const parsed = parseScenarioImport(text);
      if (!parsed.ok) return { ok: false, message: parsed.message };
      const match = checkScenarioDocument(parsed.scenario, document, documentHash);
      if (!match.ok) return { ok: false, message: `${match.message}，未导入。` };
      try {
        const existing = await store.loadAll();
        if (existing[parsed.scenario.id]) {
          return {
            ok: true,
            message: `本机已存在同名方案「${parsed.scenario.name}」，未覆盖；如需替换请先删除原方案。`,
          };
        }
        const references = validateScenarioReferences(parsed.scenario, document);
        if (!references.ok) return { ok: false, message: references.message };
        const outcome = await store.save(parsed.scenario);
        if (!outcome.ok) return { ok: false, message: outcome.message };
        return {
          ok: true,
          message: `已导入方案「${parsed.scenario.name}」（规则 v${parsed.scenario.ruleVersion}，协议 v${parsed.scenario.protocolVersion}）。`,
        };
      } catch (error) {
        return { ok: false, message: `导入失败：${describeStorageError(error)}` };
      }
    },
  };
}

function sanitizeResultValues(input: Record<string, number>): Record<string, number> {
  const output: Record<string, number> = {};
  for (const [id, value] of Object.entries(input)) {
    if (Number.isFinite(value)) output[id] = value;
  }
  return output;
}

function sanitizeResultErrors(input: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [id, error] of Object.entries(input)) {
    if (typeof error === 'string' && error.length > 0) output[id] = error.slice(0, 512);
  }
  return output;
}

/** 记录当前规则版本，供保存路径核对（导出时随 scenario 一起写入）。 */
export const CURRENT_RULE_VERSION = CALC_RULE_VERSION;

/** 单条方案记录的字符数上限（与 runtime 层共用同一常量）。 */
export const MAX_SCENARIO_STORAGE_CHARS = MAX_SCENARIO_CHARS;
