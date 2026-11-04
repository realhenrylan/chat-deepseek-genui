import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  evaluateComposite,
  lookupExpression,
  lookupModel,
  lookupModelScalar,
  modelTable,
} from '../../src/runtime/evaluate';
import type {
  BudgetModel,
  CostModel,
  GenuiV5Document,
  GenuiV5Element,
  NumericExpression,
  PreferenceModel,
  SemanticModel,
} from '../../src/protocol/types';

/**
 * v5：预算、成本与偏好语义模型运行时。
 *
 * 关注业务规则而非协议形状：金额按精度转整数最小单位、缺失不当 0、
 * 零值/超支/零周期/零次数/并列/空候选的明确语义，以及模型失败隔离与
 * 渲染快照的一致性。
 */

const C = (value: number): NumericExpression => ({ op: 'const', value });
const M = (model: string, key: string): NumericExpression => ({ op: 'model', model, key });

/** 构造一条加法链，用于验证模型级运算预算。 */
function chain(depth: number): NumericExpression {
  let expression: NumericExpression = C(1);
  for (let index = 0; index < depth; index += 1) {
    expression = { op: 'add', left: expression, right: C(1) };
  }
  return expression;
}

function doc(models: SemanticModel[], elements: GenuiV5Element[] = []): GenuiV5Document {
  return {
    type: 'genui',
    version: 5,
    state: [],
    derived: [],
    models,
    elements,
  };
}

function evaluate(models: SemanticModel[], elements: GenuiV5Element[] = []) {
  const document = doc(models, elements);
  return {
    document,
    evaluation: evaluateComposite(document, createInitialState(document)),
  };
}

function budget(overrides: Partial<BudgetModel> = {}): BudgetModel {
  return {
    kind: 'budget',
    id: 'budget',
    label: '月度预算',
    unit: '元',
    income: C(1000),
    expenses: [
      { label: '房租', amount: C(600) },
      { label: '餐饮', amount: C(500) },
    ],
    ...overrides,
  };
}

function cost(overrides: Partial<CostModel> = {}): CostModel {
  return {
    kind: 'cost',
    id: 'cost',
    label: '成本比较',
    horizon: C(10),
    plans: [
      { label: '方案 A', fee: C(100), coverage: 4, usesPerPeriod: C(2) },
      { label: '方案 B', fee: C(60), coverage: 10, usesPerPeriod: C(1) },
    ],
    ...overrides,
  };
}

function preference(overrides: Partial<PreferenceModel> = {}): PreferenceModel {
  return {
    kind: 'preference',
    id: 'preference',
    label: '偏好比较',
    candidates: [
      { label: '候选 A', values: { price: 100, quality: 8 } },
      { label: '候选 B', values: { price: 80, quality: null } },
      { label: '候选 C', values: { price: 60, quality: 6 } },
    ],
    dimensions: [
      { id: 'price', label: '价格', weight: 2, direction: 'lower' },
      { id: 'quality', label: '质量', weight: 1, direction: 'higher' },
    ],
    ...overrides,
  };
}

describe('v5 预算模型', () => {
  it('按精度转整数最小单位计算收入、支出、余额、占比与超支', () => {
    const { evaluation } = evaluate([budget()]);
    const result = lookupModel(evaluation, 'budget');
    expect(result).not.toBeNull();
    if (!result) throw new Error('期望模型结果');

    expect(result.ok).toBe(true);
    expect(result.scalars).toMatchObject({
      income: 1000,
      expenses: 1100,
      balance: -100,
      overspend: 1,
      usage: 110,
      itemCount: 2,
    });

    const summary = modelTable(result);
    expect(summary?.columns.map((column) => column.key)).toEqual(['item', 'amount', 'share']);
    expect(summary?.rows).toEqual([
      { item: '收入', amount: 1000, share: null },
      { item: '支出', amount: 1100, share: 110 },
      { item: '余额', amount: -100, share: null },
    ]);

    const items = modelTable(result, 'items');
    expect(items?.rows).toEqual([
      { item: '房租', amount: 600, share: 54.5 },
      { item: '餐饮', amount: 500, share: 45.5 },
    ]);
    expect(result.chartItems).toEqual([
      { label: '收入', value: 1000 },
      { label: '支出', value: 1100 },
    ]);
    expect(result.basis.some((basis) => basis.label === '超支' && basis.value === '是')).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('超过收入'))).toBe(true);
  });

  it('明细金额使用与合计相同的精度，不显示未舍入的原始值', () => {
    const { evaluation } = evaluate([
      budget({
        precision: 2,
        income: C(10),
        expenses: [{ label: '零碎支出', amount: C(1.234) }],
      }),
    ]);
    const result = lookupModel(evaluation, 'budget');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars.expenses).toBe(1.23);
    expect(modelTable(result)?.rows[1]).toMatchObject({ item: '支出', amount: 1.23 });
    expect(modelTable(result, 'items')?.rows[0]).toMatchObject({ item: '零碎支出', amount: 1.23 });
  });

  it('收入为 0 时占比不可用而不是 0；负支出按 0 计并给出诊断', () => {
    const { evaluation } = evaluate([
      budget({
        income: C(0),
        expenses: [{ label: '退款', amount: C(-50) }],
      }),
    ]);
    const result = lookupModel(evaluation, 'budget');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars.income).toBe(0);
    expect(result.scalars.expenses).toBe(0);
    expect(result.scalars.balance).toBe(0);
    expect(result.scalars.overspend).toBe(0);
    expect(result.scalars.usage).toBeNull();
    expect(result.scalars.itemCount).toBe(1);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('收入为 0'))).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('负数'))).toBe(true);
    expect(modelTable(result, 'items')?.rows[0]).toMatchObject({ item: '退款', amount: 0, share: null });
  });

  it('收入与支出相等时不超支，支出占比为 100%', () => {
    const { evaluation } = evaluate([
      budget({ income: C(300), expenses: [{ label: '全部', amount: C(300) }] }),
    ]);
    const result = lookupModel(evaluation, 'budget');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars).toMatchObject({ balance: 0, overspend: 0, usage: 100 });
  });

  it('没有支出项时支出为 0，占比为 0 且给出提示', () => {
    const { evaluation } = evaluate([budget({ expenses: [] })]);
    const result = lookupModel(evaluation, 'budget');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars).toMatchObject({ expenses: 0, balance: 1000, overspend: 0, usage: 0, itemCount: 0 });
    expect(modelTable(result, 'items')?.rows).toEqual([]);
    expect(modelTable(result, 'items')?.emptyText).toBe('暂无支出项');
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('没有支出项'))).toBe(true);
  });
});

describe('v5 成本模型', () => {
  it('按整份购买计算总成本，并按单次成本排序方案', () => {
    const { evaluation } = evaluate([cost()]);
    const result = lookupModel(evaluation, 'cost');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars).toMatchObject({
      horizon: 10,
      planCount: 2,
      lowestTotalCost: 60,
      lowestUnitCost: 6,
    });

    const table = modelTable(result);
    expect(table?.columns.map((column) => column.key)).toEqual([
      'plan',
      'purchases',
      'coverage',
      'totalCost',
      'totalUses',
      'unitCost',
    ]);
    expect(table?.rows).toEqual([
      { plan: '方案 B', purchases: 1, coverage: 10, totalCost: 60, totalUses: 10, unitCost: 6 },
      { plan: '方案 A', purchases: 3, coverage: 4, totalCost: 300, totalUses: 20, unitCost: 15 },
    ]);
    expect(result.chartItems.map((item) => item.label)).toEqual(['方案 B', '方案 A']);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('整份购买'))).toBe(true);
  });

  it('小数周期恰好整除时不会因浮点误差多买一份', () => {
    const { evaluation } = evaluate([
      cost({
        horizon: C(0.07),
        plans: [{ label: '方案 A', fee: C(100), coverage: 0.01, usesPerPeriod: C(1) }],
      }),
    ]);
    const result = lookupModel(evaluation, 'cost');
    if (!result) throw new Error('期望模型结果');

    expect(modelTable(result)?.rows[0]).toMatchObject({
      purchases: 7,
      totalCost: 700,
      totalUses: 0.07,
    });
    expect(modelTable(result)?.rows[0].unitCost).toBeCloseTo(10000, 6);
  });

  it('周期为 0 时不购买、总成本与次数为 0、单次成本不可用', () => {
    const { evaluation } = evaluate([cost({ horizon: C(0) })]);
    const result = lookupModel(evaluation, 'cost');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars).toMatchObject({
      horizon: 0,
      lowestTotalCost: 0,
      lowestUnitCost: null,
    });
    expect(modelTable(result)?.rows).toEqual([
      { plan: '方案 A', purchases: 0, coverage: 4, totalCost: 0, totalUses: 0, unitCost: null },
      { plan: '方案 B', purchases: 0, coverage: 10, totalCost: 0, totalUses: 0, unitCost: null },
    ]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('周期为 0'))).toBe(true);
  });

  it('次数为 0 时总成本仍按整份计算，单次成本不可用', () => {
    const { evaluation } = evaluate([
      cost({
        plans: [{ label: '方案 A', fee: C(100), coverage: 5, usesPerPeriod: C(0) }],
      }),
    ]);
    const result = lookupModel(evaluation, 'cost');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars).toMatchObject({ lowestTotalCost: 200, lowestUnitCost: null });
    expect(modelTable(result)?.rows[0]).toMatchObject({
      purchases: 2,
      totalCost: 200,
      totalUses: 0,
      unitCost: null,
    });
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('总次数为 0'))).toBe(true);
  });

  it('负数周期按 0 计，负数费用按 0 计并给出诊断', () => {
    const { evaluation } = evaluate([
      cost({
        horizon: C(-5),
        plans: [{ label: '方案 A', fee: C(-100), coverage: 2, usesPerPeriod: C(1) }],
      }),
    ]);
    const result = lookupModel(evaluation, 'cost');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars.horizon).toBe(0);
    expect(modelTable(result)?.rows[0]).toMatchObject({ totalCost: 0, totalUses: 0, unitCost: null });
    expect(result.diagnostics.filter((diagnostic) => diagnostic.message.includes('负数')).length).toBe(2);
  });
});

describe('v5 偏好模型', () => {
  it('缺失维度不按 0、不进分母；排序与得分分解一致', () => {
    const { evaluation } = evaluate([preference()]);
    const result = lookupModel(evaluation, 'preference');
    if (!result) throw new Error('期望模型结果');
    expect(result.scalars).toMatchObject({
      candidateCount: 3,
      eligibleCount: 3,
      rankedCount: 3,
      topScore: 66.7,
      weightTotal: 3,
      dimensionCount: 2,
    });

    const ranking = modelTable(result);
    expect(ranking?.rows).toEqual([
      { rank: 1, candidate: '候选 C', score: 66.7, missing: 0 },
      { rank: 2, candidate: '候选 B', score: 50, missing: 1 },
      { rank: 3, candidate: '候选 A', score: 33.3, missing: 0 },
    ]);
    expect(result.chartItems).toEqual([
      { label: '候选 C', value: 66.7 },
      { label: '候选 B', value: 50 },
      { label: '候选 A', value: 33.3 },
    ]);

    const breakdown = modelTable(result, 'breakdown');
    expect(breakdown?.columns.map((column) => column.key)).toEqual([
      'candidate',
      'score',
      'd_price',
      'd_quality',
    ]);
    expect(breakdown?.rows).toEqual([
      { candidate: '候选 C', score: 66.7, d_price: 100, d_quality: 0 },
      { candidate: '候选 B', score: 50, d_price: 50, d_quality: null },
      { candidate: '候选 A', score: 33.3, d_price: 0, d_quality: 100 },
    ]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('缺失维度不按 0'))).toBe(true);
  });

  it('同分候选共享名次，后续名次按竞争排名跳号', () => {
    const { evaluation } = evaluate([
      preference({
        candidates: [
          { label: '并列 A', values: { quality: 10 } },
          { label: '并列 B', values: { quality: 10 } },
          { label: '较低', values: { quality: 5 } },
        ],
        dimensions: [{ id: 'quality', label: '质量', weight: 1, direction: 'higher' }],
      }),
    ]);
    const result = lookupModel(evaluation, 'preference');
    if (!result) throw new Error('期望模型结果');

    expect(modelTable(result)?.rows).toEqual([
      { rank: 1, candidate: '并列 A', score: 100, missing: 0 },
      { rank: 1, candidate: '并列 B', score: 100, missing: 0 },
      { rank: 3, candidate: '较低', score: 0, missing: 0 },
    ]);
    expect(result.scalars.topScore).toBe(100);
  });

  it('筛选时缺失筛选维度不通过；未通过候选不参与排名', () => {
    const { evaluation } = evaluate([
      preference({ filters: [{ dimension: 'quality', min: C(7) }] }),
    ]);
    const result = lookupModel(evaluation, 'preference');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars).toMatchObject({ candidateCount: 3, eligibleCount: 1, rankedCount: 1, topScore: 100 });
    expect(modelTable(result)?.rows).toEqual([
      { rank: 1, candidate: '候选 A', score: 100, missing: 0 },
    ]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('缺少筛选维度'))).toBe(true);
  });

  it('筛选阈值直接写数字常量时按同一规则过滤', () => {
    const { evaluation } = evaluate([
      preference({ filters: [{ dimension: 'quality', min: 7 }] }),
    ]);
    const result = lookupModel(evaluation, 'preference');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars).toMatchObject({ candidateCount: 3, eligibleCount: 1, rankedCount: 1 });
    expect(modelTable(result)?.rows).toEqual([
      { rank: 1, candidate: '候选 A', score: 100, missing: 0 },
    ]);
  });

  it('没有候选资料时给出明确空状态', () => {
    const { evaluation } = evaluate([preference({ candidates: [] })]);
    const result = lookupModel(evaluation, 'preference');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars).toMatchObject({
      candidateCount: 0,
      eligibleCount: 0,
      rankedCount: 0,
      topScore: null,
    });
    expect(modelTable(result)?.rows).toEqual([]);
    expect(modelTable(result)?.emptyText).toBe('没有候选资料');
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('没有候选资料'))).toBe(true);
  });

  it('所有候选都被筛掉时排名为空并说明原因', () => {
    const { evaluation } = evaluate([
      preference({ filters: [{ dimension: 'price', max: C(50) }] }),
    ]);
    const result = lookupModel(evaluation, 'preference');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars).toMatchObject({ candidateCount: 3, eligibleCount: 0, rankedCount: 0, topScore: null });
    expect(modelTable(result)?.rows).toEqual([]);
    expect(modelTable(result)?.emptyText).toBe('没有候选通过筛选');
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('没有候选通过筛选'))).toBe(true);
  });

  it('没有任何可计权维度的候选不参与排名，缺失不当 0', () => {
    const { evaluation } = evaluate([
      preference({
        candidates: [
          { label: '无资料', values: { price: null, quality: null } },
          { label: '完整', values: { price: 100, quality: 8 } },
        ],
      }),
    ]);
    const result = lookupModel(evaluation, 'preference');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars).toMatchObject({ eligibleCount: 2, rankedCount: 1, topScore: 100 });
    expect(modelTable(result)?.rows).toEqual([
      { rank: 1, candidate: '完整', score: 100, missing: 0 },
      { rank: null, candidate: '无资料', score: null, missing: 2 },
    ]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('未参与排名'))).toBe(true);
  });

  it('权重为 0 的维度不进入得分分母', () => {
    const { evaluation } = evaluate([
      preference({
        candidates: [
          { label: '缺价格', values: { quality: 9 } },
          { label: '完整', values: { price: 100, quality: 5 } },
        ],
        dimensions: [
          { id: 'price', label: '价格', weight: 1, direction: 'lower' },
          { id: 'quality', label: '质量', weight: 0, direction: 'higher' },
        ],
      }),
    ]);
    const result = lookupModel(evaluation, 'preference');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars).toMatchObject({ rankedCount: 1, topScore: 100, weightTotal: 1 });
    expect(modelTable(result)?.rows).toEqual([
      { rank: 1, candidate: '完整', score: 100, missing: 0 },
      { rank: null, candidate: '缺价格', score: null, missing: 1 },
    ]);
  });

  it('权重可引用状态变量，调整权重会改变排名', () => {
    const model = preference({
      dimensions: [
        { id: 'price', label: '价格', weight: { op: 'state', id: 'priceWeight' }, direction: 'lower' },
        { id: 'quality', label: '质量', weight: { op: 'state', id: 'qualityWeight' }, direction: 'higher' },
      ],
    });
    const document = {
      ...doc([model]),
      state: [
        { id: 'priceWeight', label: '价格权重', kind: 'number' as const, initial: 1, min: 0, max: 10, step: 1 },
        { id: 'qualityWeight', label: '质量权重', kind: 'number' as const, initial: 0, min: 0, max: 10, step: 1 },
      ],
    };

    const priceFirst = evaluateComposite(document, { priceWeight: 1, qualityWeight: 0 });
    const priceResult = lookupModel(priceFirst, 'preference');
    if (!priceResult) throw new Error('期望模型结果');
    expect(modelTable(priceResult)?.rows[0]).toMatchObject({ candidate: '候选 C', score: 100 });

    const qualityFirst = evaluateComposite(document, { priceWeight: 0, qualityWeight: 1 });
    const qualityResult = lookupModel(qualityFirst, 'preference');
    if (!qualityResult) throw new Error('期望模型结果');
    expect(modelTable(qualityResult)?.rows[0]).toMatchObject({ candidate: '候选 A', score: 100 });
    expect(modelTable(qualityResult)?.rows[1]).toMatchObject({ candidate: '候选 C', score: 0 });
  });

  it('所有权重为 0 时得分不可用并给出诊断', () => {
    const model = preference({
      dimensions: [
        { id: 'price', label: '价格', weight: { op: 'state', id: 'priceWeight' }, direction: 'lower' },
      ],
    });
    const document = {
      ...doc([model]),
      state: [
        { id: 'priceWeight', label: '价格权重', kind: 'number' as const, initial: 0, min: 0, max: 10, step: 1 },
      ],
    };
    const evaluation = evaluateComposite(document, { priceWeight: 0 });
    const result = lookupModel(evaluation, 'preference');
    if (!result) throw new Error('期望模型结果');

    expect(result.scalars).toMatchObject({ rankedCount: 0, topScore: null, weightTotal: 0 });
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('权重合计为 0'))).toBe(true);
  });
});

describe('v5 模型引用与快照', () => {
  it('元素表达式读取模型标量，并与模型快照一致', () => {
    const cell = M('budget', 'balance');
    const element: GenuiV5Element = {
      kind: 'table',
      columns: [{ key: 'balance', label: '余额', numeric: true }],
      rows: [{ cells: { balance: cell } }],
    };
    const { evaluation } = evaluate([budget()], [element]);

    expect(lookupModelScalar(evaluation, 'budget', 'balance')).toEqual({ ok: true, value: -100 });
    expect(lookupExpression(evaluation, cell)).toEqual({ ok: true, value: -100 });
    expect(evaluation.models.get('budget')?.scalars.balance).toBe(-100);
  });

  it('模型标量为 null 时读取得到明确错误，不伪造 0', () => {
    const { evaluation } = evaluate([budget({ income: C(0), expenses: [{ label: '支出', amount: C(10) }] })]);
    expect(lookupModelScalar(evaluation, 'budget', 'usage')).toEqual({
      ok: false,
      error: '该模型值在当前数据下不可用',
    });

    const cell = M('budget', 'usage');
    const document = doc(
      [budget({ income: C(0), expenses: [{ label: '支出', amount: C(10) }] })],
      [{ kind: 'table', columns: [{ key: 'v', label: '值' }], rows: [{ cells: { v: cell } }] }],
    );
    const result = evaluateComposite(document, createInitialState(document));
    expect(lookupExpression(result, cell)).toEqual({
      ok: false,
      error: '模型值 budget.usage 不可用',
    });
  });

  it('模型失败只影响自身与依赖它的模型，独立模型仍可计算', () => {
    const { evaluation } = evaluate([
      budget({ id: 'bad', income: { op: 'divide', left: C(1), right: C(0) } }),
      budget({ id: 'dependent', income: M('bad', 'income') }),
      budget({ id: 'good', income: C(500), expenses: [] }),
    ]);

    const bad = lookupModel(evaluation, 'bad');
    const dependent = lookupModel(evaluation, 'dependent');
    const good = lookupModel(evaluation, 'good');
    if (!bad || !dependent || !good) throw new Error('期望三个模型结果');

    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('除数不能为 0');
    expect(dependent.ok).toBe(false);
    expect(dependent.error).toContain('bad.income');
    expect(good.ok).toBe(true);
    expect(good.scalars.income).toBe(500);
  });

  it('同一模型结果被多处引用时返回同一份快照', () => {
    const exprA = M('budget', 'balance');
    const exprB = M('budget', 'balance');
    const document = doc(
      [budget()],
      [
        { kind: 'table', columns: [{ key: 'a', label: 'A' }], rows: [{ cells: { a: exprA } }] },
        { kind: 'table', columns: [{ key: 'b', label: 'B' }], rows: [{ cells: { b: exprB } }] },
      ],
    );
    const evaluation = evaluateComposite(document, createInitialState(document));

    expect(evaluation.models.get('budget')?.scalars.balance).toBe(-100);
    expect(lookupExpression(evaluation, exprA)).toEqual({ ok: true, value: -100 });
    expect(lookupExpression(evaluation, exprB)).toEqual({ ok: true, value: -100 });
  });

  it('每个模型使用独立的 maxModelWork 预算，超过共享 500 次仍可完成', () => {
    const heavy = budget({
      expenses: Array.from({ length: 20 }, (_, index) => ({
        label: `支出 ${index + 1}`,
        amount: chain(30),
      })),
    });
    const { evaluation } = evaluate([heavy]);
    const result = lookupModel(evaluation, 'budget');
    if (!result) throw new Error('期望模型结果');

    expect(result.ok).toBe(true);
    expect(result.operations).toBeGreaterThan(500);
    expect(result.operations).toBeLessThanOrEqual(5000);
  });

  it('模型运算超限只让自身失败，不占用共享池', () => {
    const overflow = budget({
      id: 'overflow',
      expenses: Array.from({ length: 20 }, (_, index) => ({
        label: `大支出 ${index + 1}`,
        amount: chain(300),
      })),
    });
    const { evaluation } = evaluate([
      overflow,
      budget({ id: 'simple', income: C(500), expenses: [] }),
    ]);

    const failed = lookupModel(evaluation, 'overflow');
    const simple = lookupModel(evaluation, 'simple');
    if (!failed || !simple) throw new Error('期望模型结果');
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('计算量');
    expect(simple.ok).toBe(true);
    expect(simple.scalars.income).toBe(500);
  });

  it('状态变化后按新状态重新计算模型', () => {
    const document: GenuiV5Document = {
      ...doc([
        budget({
          income: { op: 'state', id: 'income' },
          expenses: [{ label: '支出', amount: C(100) }],
        }),
      ]),
      state: [
        {
          id: 'income',
          label: '收入',
          kind: 'number',
          initial: 500,
          min: 0,
          max: 2000,
          step: 100,
        },
      ],
    };
    const initial = evaluateComposite(document, createInitialState(document));
    const changed = evaluateComposite(document, { income: 800 });

    expect(initial.models.get('budget')?.scalars.balance).toBe(400);
    expect(changed.models.get('budget')?.scalars.balance).toBe(700);
  });
});
