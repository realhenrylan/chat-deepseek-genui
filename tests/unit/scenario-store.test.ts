import { describe, expect, it } from 'vitest';
import {
  SCENARIO_KEY_PREFIX,
  createScenarioPort,
  createScenarioStore,
  createChromeScenarioStore,
  type ScenarioStorageArea,
} from '../../src/content/scenario-store';
import type { GenuiV3Document } from '../../src/protocol/types';
import { documentStateSignature } from '../../src/runtime/card-state';
import {
  CALC_RULE_VERSION,
  compareScenarios,
  createScenario,
  recomputeScenario,
  type SavedScenario,
} from '../../src/runtime/scenario';

/**
 * issue #6：方案存储契约与比较/重算逻辑。
 *
 * - 一条方案一个前缀键、容量淘汰、损坏记录读取时丢弃；
 * - 导入校验顺序与不覆盖语义；
 * - 比较仅在兼容时给出差异，不兼容时给出明确理由；
 * - 「当时保存的结果」与「按当前规则重算」可区分。
 */

class FakeArea implements ScenarioStorageArea {
  readonly items = new Map<string, unknown>();
  failSet: Error | null = null;

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) return Object.fromEntries(this.items);
    const list = typeof keys === 'string' ? [keys] : keys;
    const result: Record<string, unknown> = {};
    for (const key of list) {
      if (this.items.has(key)) result[key] = this.items.get(key);
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (this.failSet) throw this.failSet;
    for (const [key, value] of Object.entries(items)) this.items.set(key, value);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === 'string' ? [keys] : keys) this.items.delete(key);
  }
}

const DOC: GenuiV3Document = {
  type: 'genui',
  version: 3,
  title: '预算规划',
  state: [
    { id: 'budget', label: '预算', kind: 'number', initial: 5000, min: 0, max: 100000, step: 100, unit: '元' },
  ],
  derived: [
    { id: 'total', label: '合计', expression: { op: 'state', id: 'budget' } },
  ],
  elements: [],
};

function scenario(id: string, savedAt: number, overrides: Partial<SavedScenario> = {}): SavedScenario {
  return {
    ...createScenario({
      name: `方案 ${id}`,
      savedAt,
      documentHash: 'doc-hash',
      stateSignature: documentStateSignature(DOC),
      protocolVersion: 3,
      source: { sessionId: '/a/chat/s/session', messageKey: 'vl:1', duplicateIndex: 0, title: '预算规划' },
      values: { budget: 5000 },
      tables: {},
      results: { values: { total: 5000 }, errors: {} },
    }),
    ...overrides,
  };
}

describe('方案存储：键、淘汰与读取校验', () => {
  it('一条方案一个前缀键，loadAll 还原 id', async () => {
    const area = new FakeArea();
    const store = createScenarioStore(area);
    const record = scenario('alpha', 100);

    const outcome = await store.save(record);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.message).toContain('已保存方案「方案 alpha」');
    expect([...area.items.keys()]).toEqual([`${SCENARIO_KEY_PREFIX}${record.id}`]);

    const loaded = await store.loadAll();
    expect(loaded[record.id]?.values).toEqual({ budget: 5000 });
  });

  it('超出容量按 savedAt 淘汰最旧', async () => {
    const area = new FakeArea();
    const store = createScenarioStore(area, 3);
    for (let index = 0; index < 5; index += 1) {
      await store.save(scenario(`s${index}`, 100 + index));
    }
    const loaded = await store.loadAll();
    expect(Object.keys(loaded)).toHaveLength(3);
    const savedAts = Object.values(loaded).map((item) => item.savedAt).sort();
    expect(savedAts).toEqual([102, 103, 104]);
  });

  it('损坏记录与异物键在读取时丢弃', async () => {
    const area = new FakeArea();
    const store = createScenarioStore(area);
    const good = scenario('good', 100);
    area.items.set(`${SCENARIO_KEY_PREFIX}good`, good);
    area.items.set(`${SCENARIO_KEY_PREFIX}broken`, { format: 'genui-scenario' });
    area.items.set('genuiPlan:other', { plan: true });
    area.items.set('unrelated', 42);

    const loaded = await store.loadAll();
    expect(Object.keys(loaded)).toEqual(['good']);
  });

  it('存储写入失败给出可读反馈', async () => {
    const area = new FakeArea();
    area.failSet = new Error('QuotaBytesExceeded');
    const store = createScenarioStore(area);
    const outcome = await store.save(scenario('x', 1));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('本机存储空间不足');
  });

  it('无扩展存储 API 时 createChromeScenarioStore 返回 null', () => {
    expect(createChromeScenarioStore()).toBeNull();
  });

  it('clear 移除全部方案键并报告数量', async () => {
    const area = new FakeArea();
    const store = createScenarioStore(area);
    await store.save(scenario('a', 1));
    await store.save(scenario('b', 2));
    area.items.set('genuiPlan:keep', { plan: true });

    const outcome = await store.clear();
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.removed).toBe(2);
      expect(outcome.message).toContain('2 条方案');
    }
    expect([...area.items.keys()]).toEqual(['genuiPlan:keep']);
  });
});

describe('方案端口：保存、导入与身份', () => {
  function makePort(area: FakeArea, now = () => 1000) {
    return createScenarioPort({
      store: createScenarioStore(area),
      document: DOC,
      documentHash: 'doc-hash',
      source: { sessionId: '/a/chat/s/session', messageKey: 'vl:1', duplicateIndex: 0, title: '预算规划' },
      now,
    });
  }

  it('保存时按当前文档 sanitize 参数并写入身份与版本', async () => {
    const area = new FakeArea();
    const port = makePort(area);
    const outcome = await port.save({
      name: '  超范围  ',
      values: { budget: 999999999, evil: 1 } as never,
      tables: {},
      results: { values: { total: Number.NaN }, errors: { total: 'x'.repeat(900) } },
    });
    expect(outcome.ok).toBe(true);
    const stored = [...area.items.values()][0] as SavedScenario;
    // 越界回落 initial，未知字段被剔除。
    expect(stored.values).toEqual({ budget: 5000 });
    expect(stored.results.values).toEqual({});
    expect(stored.results.errors.total).toHaveLength(512);
    expect(stored.protocolVersion).toBe(3);
    expect(stored.ruleVersion).toBe(CALC_RULE_VERSION);
    expect(stored.source.title).toBe('预算规划');
    expect(stored.name).toBe('超范围');
  });

  it('名称为空时拒绝保存', async () => {
    const port = makePort(new FakeArea());
    const outcome = await port.save({ name: '   ', values: {}, tables: {}, results: { values: {}, errors: {} } });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('请先填写方案名称');
  });

  it('导入错误分类：损坏、旧格式标记、不支持版本、超大', async () => {
    const port = makePort(new FakeArea());
    expect((await port.importText('{oops')).message).toContain('不是有效的 JSON');
    expect((await port.importText('{"foo":1}')).message).toContain('缺少方案格式标记');
    expect((await port.importText(JSON.stringify({ format: 'genui-scenario', version: 7 }))).message).toContain(
      '高于当前支持的版本',
    );
    expect((await port.importText('a'.repeat(70 * 1024))).message).toContain('文件过大');
  });

  it('导入跨界面方案被拒绝，同 id 不覆盖', async () => {
    const area = new FakeArea();
    const port = makePort(area);
    const original = scenario('fixed', 123, { id: 'fixed' });
    expect((await port.importText(JSON.stringify(original))).ok).toBe(true);

    const tampered: SavedScenario = { ...original, values: { budget: 1 } };
    const second = await port.importText(JSON.stringify(tampered));
    expect(second.ok).toBe(true);
    expect(second.message).toContain('未覆盖');
    const stored = area.items.get(`${SCENARIO_KEY_PREFIX}fixed`) as SavedScenario;
    expect(stored.values).toEqual({ budget: 5000 });

    const foreign: SavedScenario = { ...original, documentHash: 'other' };
    const third = await port.importText(JSON.stringify(foreign));
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.message).toContain('文档哈希不同');
  });

  it('list 返回按时间新到旧的方案', async () => {
    const area = new FakeArea();
    const port = makePort(area);
    await port.save({ name: '早', values: {}, tables: {}, results: { values: {}, errors: {} } });
    const later = makePort(area, () => 2000);
    await later.save({ name: '晚', values: {}, tables: {}, results: { values: {}, errors: {} } });
    const list = await port.list();
    expect(list.map((item) => item.name)).toEqual(['晚', '早']);
  });
});

describe('比较与重算', () => {
  it('兼容方案给出逐项差异与变化计数', () => {
    const a = scenario('a', 1, { values: { budget: 4000 }, results: { values: { total: 4000 }, errors: {} } });
    const b = scenario('b', 2, { values: { budget: 7000 }, results: { values: { total: 7000 }, errors: {} } });
    const comparison = compareScenarios(a, b, DOC, 'doc-hash');
    expect(comparison.compatible).toBe(true);
    if (comparison.compatible) {
      expect(comparison.changedCount).toBe(2);
      const budgetRow = comparison.rows.find((row) => row.id === 'budget');
      expect(budgetRow?.a).toBe('4000');
      expect(budgetRow?.b).toBe('7000');
      expect(budgetRow?.delta).toBe(3000);
    }
  });

  it('不同文档、签名、协议或规则版本明确说明不兼容', () => {
    const base = scenario('a', 1);
    const foreignDoc: SavedScenario = { ...base, documentHash: 'other' };
    const foreignSig: SavedScenario = { ...base, stateSignature: 'other' };
    const foreignProtocol: SavedScenario = { ...base, protocolVersion: 2 };
    const foreignRule: SavedScenario = { ...base, ruleVersion: 99 };

    for (const other of [foreignDoc, foreignSig, foreignProtocol, foreignRule]) {
      const comparison = compareScenarios(base, other, DOC, 'doc-hash');
      expect(comparison.compatible).toBe(false);
      if (!comparison.compatible) expect(comparison.reasons.length).toBeGreaterThan(0);
    }
    // 文档哈希不同也要对照当前文档校验。
    expect(compareScenarios(base, base, DOC, 'not-the-hash').compatible).toBe(false);
  });

  it('重算区分「当时保存的结果」与「按当前规则重算」', () => {
    const stale = scenario('stale', 1, { values: { budget: 4000 }, results: { values: { total: 999 }, errors: {} } });
    const report = recomputeScenario(stale, DOC, 'doc-hash');
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.changed).toBe(true);
      const diff = report.diffs.find((item) => item.id === 'total');
      expect(diff?.saved).toBe('999');
      expect(diff?.current).toBe('4000');
      expect(diff?.changed).toBe(true);
    }
    // 一致时不变。
    const fresh = scenario('fresh', 1, { values: { budget: 4000 }, results: { values: { total: 4000 }, errors: {} } });
    const same = recomputeScenario(fresh, DOC, 'doc-hash');
    expect(same.ok && same.changed).toBe(false);
    // 协议不兼容时明确不可重算。
    const incompatible: SavedScenario = { ...stale, protocolVersion: 1 };
    const blocked = recomputeScenario(incompatible, DOC, 'doc-hash');
    expect(blocked.ok).toBe(false);
  });
});
