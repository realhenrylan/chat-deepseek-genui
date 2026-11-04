import { describe, expect, it } from 'vitest';
import {
  PLAN_MAX_LENGTH,
  PLAN_TYPE,
  createPlan,
  parsePlanImport,
  serializePlan,
  validateStateValues,
} from '../../src/protocol/plan';
import type { GenuiV4Document } from '../../src/protocol/types';

const DOC: GenuiV4Document = {
  type: 'genui',
  version: 4,
  title: '可导出方案',
  sources: [
    { id: 'stats', label: '统计公报', url: 'https://example.com/report', publishedAt: '2026-01-02' },
  ],
  state: [
    {
      id: 'amount',
      label: '金额',
      kind: 'number',
      initial: 10,
      min: 0,
      max: 100,
      step: 1,
      unit: '元',
      basis: { kind: 'reference', sourceId: 'stats', asOf: '2026-01-02' },
    },
    {
      id: 'category',
      label: '类别',
      kind: 'select',
      initial: 'food',
      options: [
        { label: '餐饮', value: 'food' },
        { label: '交通', value: 'transport' },
      ],
      basis: { kind: 'user' },
    },
  ],
  derived: [
    {
      id: 'double',
      label: '翻倍',
      expression: {
        op: 'multiply',
        left: { op: 'state', id: 'amount' },
        right: { op: 'const', value: 2 },
      },
      basis: { kind: 'computed' },
    },
  ],
  elements: [
    { kind: 'slider', bind: 'amount' },
    { kind: 'select', bind: 'category' },
    { kind: 'value', label: '翻倍结果', source: { kind: 'derived', id: 'double' }, unit: '元' },
  ],
};

const NOW = new Date('2026-03-04T05:06:07.000Z');

describe('方案导出/导入', () => {
  it('导出再导入保留文档、来源/依据、当前状态与导出时间', () => {
    const plan = createPlan(DOC, { amount: 20, category: 'transport' }, NOW);
    expect(plan.type).toBe(PLAN_TYPE);
    expect(plan.exportedAt).toBe('2026-03-04T05:06:07.000Z');

    const raw = serializePlan(DOC, { amount: 20, category: 'transport' }, NOW);
    expect(raw).toContain('"sources"');
    expect(raw).toContain('"basis"');

    const result = parsePlanImport(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.exportedAt).toBe(NOW.toISOString());
    expect(result.plan.state).toEqual({ amount: 20, category: 'transport' });
    expect(result.plan.document.version).toBe(4);
    if (result.plan.document.version === 4) {
      expect(result.plan.document.sources?.[0]?.label).toBe('统计公报');
      expect(result.plan.document.state[0]?.basis?.kind).toBe('reference');
    }
  });

  it('v1 静态界面没有可导出状态', () => {
    expect(() =>
      createPlan(
        { type: 'genui', version: 1, elements: [{ kind: 'text', value: '静态' }] },
        {},
        NOW,
      ),
    ).toThrow('静态 v1 界面没有可导出的交互状态');
  });

  it('拒绝非 JSON、错误根节点、未知字段、错误类型与未知格式版本', () => {
    expect(parsePlanImport('不是 JSON')).toMatchObject({ ok: false, code: 'invalid-plan' });
    expect(parsePlanImport('[]')).toMatchObject({ ok: false, code: 'invalid-plan' });

    const base = JSON.parse(serializePlan(DOC, { amount: 10, category: 'food' }, NOW));
    expect(parsePlanImport(JSON.stringify({ ...base, extra: 1 }))).toMatchObject({
      ok: false,
      code: 'invalid-plan',
    });
    expect(parsePlanImport(JSON.stringify({ ...base, type: 'other' }))).toMatchObject({
      ok: false,
      code: 'invalid-plan',
    });
    expect(parsePlanImport(JSON.stringify({ ...base, formatVersion: 2 }))).toMatchObject({
      ok: false,
      code: 'unsupported-version',
    });
    expect(parsePlanImport(JSON.stringify({ ...base, exportedAt: '2026-02-30' }))).toMatchObject({
      ok: false,
      code: 'invalid-plan',
    });
  });

  it('拒绝无效界面文档与 v1 文档', () => {
    const base = JSON.parse(serializePlan(DOC, { amount: 10, category: 'food' }, NOW));
    expect(
      parsePlanImport(JSON.stringify({ ...base, document: { type: 'genui', version: 5 } })),
    ).toMatchObject({ ok: false, code: 'invalid-document' });
    expect(
      parsePlanImport(
        JSON.stringify({
          ...base,
          document: { type: 'genui', version: 1, elements: [{ kind: 'text', value: '静态' }] },
        }),
      ),
    ).toMatchObject({ ok: false, code: 'invalid-document' });
  });

  it('状态缺项、多项、越界、步长不符与非法选项都被拒绝', () => {
    const base = JSON.parse(serializePlan(DOC, { amount: 10, category: 'food' }, NOW));

    for (const state of [
      { amount: 10 },
      { amount: 10, category: 'food', extra: 1 },
      { amount: 101, category: 'food' },
      { amount: 10.5, category: 'food' },
      { amount: 10, category: 'unknown' },
    ]) {
      expect(
        parsePlanImport(JSON.stringify({ ...base, state })),
        JSON.stringify(state),
      ).toMatchObject({ ok: false, code: 'invalid-state' });
    }
  });

  it('超过方案长度上限时拒绝', () => {
    expect(parsePlanImport('x'.repeat(PLAN_MAX_LENGTH + 1))).toMatchObject({
      ok: false,
      code: 'too-large',
    });
  });

  it('记录并校验用户修改过的输入', () => {
    const plan = createPlan(DOC, { amount: 20, category: 'food' }, NOW, ['amount', 'category']);
    expect(plan.editedState).toEqual(['amount', 'category']);
    const parsed = parsePlanImport(serializePlan(DOC, { amount: 20, category: 'food' }, NOW, ['amount']));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.plan.editedState).toEqual(['amount']);

    const empty = createPlan(DOC, { amount: 20, category: 'food' }, NOW, []);
    expect(empty.editedState).toBeUndefined();

    const base = JSON.parse(serializePlan(DOC, { amount: 10, category: 'food' }, NOW));
    expect(
      parsePlanImport(JSON.stringify({ ...base, editedState: ['missing'] })),
    ).toMatchObject({ ok: false, code: 'invalid-state' });
    expect(
      parsePlanImport(JSON.stringify({ ...base, editedState: ['amount', 'amount'] })),
    ).toMatchObject({ ok: false, code: 'invalid-state' });
    expect(parsePlanImport(JSON.stringify({ ...base, editedState: 'amount' }))).toMatchObject({
      ok: false,
      code: 'invalid-state',
    });
  });

  it('validateStateValues 不把缺失值补成 0', () => {
    const result = validateStateValues(DOC.state, { category: 'food' });
    expect(result).toMatchObject({ ok: false, detail: '缺少状态项：amount' });
  });
});
