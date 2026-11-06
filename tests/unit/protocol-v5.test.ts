import { describe, expect, it } from 'vitest';
import { parseGenui } from '../../src/protocol/validate';
import type {
  BudgetModel,
  CostModel,
  GenuiFailureCode,
  GenuiV5Document,
  GenuiV5Element,
  NumericExpression,
  ParseGenuiResult,
  PreferenceModel,
  SemanticModel,
} from '../../src/protocol/types';

/**
 * v5：可组合语义模型协议校验。
 *
 * JSON Schema 负责字段白名单、集合上限与形状；语义层额外保证模型只能
 * 引用更早声明的模型、标量键属于对应模型、视图与模型类型匹配，以及
 * 偏好维度/筛选/候选值的一致性。这里覆盖这些边界，不重复运行时计算。
 */

const C = (value: number): NumericExpression => ({ op: 'const', value });
const M = (model: string, key: string): NumericExpression => ({ op: 'model', model, key });

function doc(
  models: SemanticModel[],
  elements: unknown[] = [{ kind: 'text', value: '说明' }],
): GenuiV5Document {
  return {
    type: 'genui',
    version: 5,
    state: [],
    derived: [],
    models,
    elements: elements as GenuiV5Element[],
  };
}

function budget(overrides: Partial<BudgetModel> = {}): BudgetModel {
  return {
    kind: 'budget',
    id: 'budget',
    label: '月度预算',
    unit: '元',
    income: C(1000),
    expenses: [{ label: '房租', amount: C(600) }],
    ...overrides,
  };
}

function cost(overrides: Partial<CostModel> = {}): CostModel {
  return {
    kind: 'cost',
    id: 'cost',
    label: '成本比较',
    horizon: C(10),
    plans: [{ label: '方案 A', fee: C(100), coverage: 4, usesPerPeriod: C(2) }],
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
    ],
    dimensions: [
      { id: 'price', label: '价格', weight: 2, direction: 'lower' },
      { id: 'quality', label: '质量', weight: 1, direction: 'higher' },
    ],
    ...overrides,
  };
}

function expectFailure(result: ParseGenuiResult, code: GenuiFailureCode): string {
  expect(result.ok, `期望失败 ${code}，实际成功`).toBe(false);
  if (result.ok) throw new Error('期望失败');
  expect(result.code).toBe(code);
  expect(result.detail.length).toBeGreaterThan(0);
  return result.detail;
}

describe('genui v5 语义模型协议', () => {
  it('接受只含一个预算模型与文本的 v5 文档', () => {
    const result = parseGenui(JSON.stringify(doc([budget()])));
    expect(result.ok, result.ok ? '' : `${result.code} ${result.detail}`).toBe(true);
    if (result.ok) expect(result.document.version).toBe(5);
  });

  it('接受三类模型、模型表格/图表/数值与解释元素', () => {
    const models: SemanticModel[] = [
      budget(),
      cost({ horizon: M('budget', 'balance') }),
      preference(),
    ];
    const elements = [
      { kind: 'table', title: '预算摘要', source: { model: 'budget', view: 'summary' } },
      { kind: 'table', title: '方案', source: { model: 'cost' } },
      { kind: 'chart', chartType: 'bar', title: '排名', source: { model: 'preference' } },
      { kind: 'value', label: '余额', source: { kind: 'model', model: 'budget', key: 'balance' } },
      { kind: 'explain', model: 'preference', title: '排名依据' },
    ];
    const result = parseGenui(JSON.stringify(doc(models, elements)));
    expect(result.ok, result.ok ? '' : `${result.code} ${result.detail}`).toBe(true);
  });

  it('v5 表格与图表可以只声明模型来源', () => {
    const result = parseGenui(
      JSON.stringify(
        doc(
          [preference()],
          [
            { kind: 'table', source: { model: 'preference', view: 'breakdown' } },
            { kind: 'chart', chartType: 'pie', source: { model: 'preference' } },
          ],
        ),
      ),
    );
    expect(result.ok, result.ok ? '' : `${result.code} ${result.detail}`).toBe(true);
  });

  it('模型来源可以带可选的 kind:model 标记', () => {
    const result = parseGenui(
      JSON.stringify(
        doc(
          [budget()],
          [
            { kind: 'table', source: { kind: 'model', model: 'budget', view: 'summary' } },
            { kind: 'chart', chartType: 'bar', source: { kind: 'model', model: 'budget' } },
          ],
        ),
      ),
    );
    expect(result.ok, result.ok ? '' : `${result.code} ${result.detail}`).toBe(true);
  });

  it('模型输入可以引用更早声明的模型标量', () => {
    const result = parseGenui(
      JSON.stringify(
        doc([
          budget(),
          cost({ horizon: M('budget', 'balance'), plans: [{ label: 'A', fee: C(10), coverage: 1, usesPerPeriod: C(1) }] }),
        ]),
      ),
    );
    expect(result.ok, result.ok ? '' : `${result.code} ${result.detail}`).toBe(true);
  });

  it('模型输入不能引用更晚声明的模型', () => {
    const detail = expectFailure(
      parseGenui(
        JSON.stringify(
          doc([
            budget({ income: M('later', 'income') }),
            budget({ id: 'later', income: C(10) }),
          ]),
        ),
      ),
      'invalid-reference',
    );
    expect(detail).toContain('更早');
  });

  it('模型输入不能引用自身', () => {
    const detail = expectFailure(
      parseGenui(JSON.stringify(doc([budget({ income: M('budget', 'income') })]))),
      'invalid-reference',
    );
    expect(detail).toContain('更早');
  });

  it('模型标量键必须属于对应模型类型', () => {
    const detail = expectFailure(
      parseGenui(
        JSON.stringify(
          doc([
            budget(),
            cost({
              horizon: M('budget', 'topScore'),
              plans: [{ label: 'A', fee: C(10), coverage: 1, usesPerPeriod: C(1) }],
            }),
          ]),
        ),
      ),
      'invalid-reference',
    );
    expect(detail).toContain('topScore');
  });

  it('v1–v4 文档不允许 model 表达式', () => {
    const v4 = {
      type: 'genui',
      version: 4,
      state: [],
      derived: [],
      elements: [
        {
          kind: 'chart',
          chartType: 'line',
          series: [{ label: 'S', points: [{ x: 0, y: M('budget', 'balance') }] }],
        },
      ],
    };
    expectFailure(parseGenui(JSON.stringify(v4)), 'schema-violation');
  });

  it('derived 表达式不能引用模型', () => {
    const document = {
      ...doc([budget()]),
      derived: [{ id: 'copy', label: '复制', expression: M('budget', 'balance') }],
    };
    expectFailure(parseGenui(JSON.stringify(document)), 'schema-violation');
  });

  it('模型表格视图必须与模型类型匹配', () => {
    const detail = expectFailure(
      parseGenui(
        JSON.stringify(doc([budget()], [{ kind: 'table', source: { model: 'budget', view: 'plans' } }])),
      ),
      'invalid-reference',
    );
    expect(detail).toContain('plans');
  });

  it('模型表格不能同时声明 source 与 columns/rows', () => {
    const element = {
      kind: 'table',
      source: { model: 'budget' },
      columns: [{ key: 'a', label: 'A' }],
      rows: [{ cells: { a: 'x' } }],
    };
    expectFailure(parseGenui(JSON.stringify(doc([budget()], [element]))), 'schema-violation');
  });

  it('模型图表不能同时声明 source 与 items', () => {
    const element = {
      kind: 'chart',
      chartType: 'bar',
      source: { model: 'budget' },
      items: [{ label: 'A', value: C(1) }],
    };
    expectFailure(parseGenui(JSON.stringify(doc([budget()], [element]))), 'schema-violation');
  });

  it('模型数值键必须是该模型支持的标量', () => {
    const detail = expectFailure(
      parseGenui(
        JSON.stringify(
          doc([budget()], [{ kind: 'value', label: 'x', source: { kind: 'model', model: 'budget', key: 'missing' } }]),
        ),
      ),
      'invalid-reference',
    );
    expect(detail).toContain('missing');
  });

  it('解释元素必须引用已声明的模型', () => {
    expectFailure(
      parseGenui(JSON.stringify(doc([budget()], [{ kind: 'explain', model: 'nope' }]))),
      'invalid-reference',
    );
  });

  it('偏好维度 id 必须唯一', () => {
    const detail = expectFailure(
      parseGenui(
        JSON.stringify(
          doc([
            preference({
              dimensions: [
                { id: 'price', label: '价格', weight: 1, direction: 'lower' },
                { id: 'price', label: '价格 2', weight: 1, direction: 'lower' },
              ],
            }),
          ]),
        ),
      ),
      'semantic-violation',
    );
    expect(detail).toContain('重复');
  });

  it('偏好至少需要一个大于 0 的权重', () => {
    expectFailure(
      parseGenui(
        JSON.stringify(
          doc([
            preference({
              dimensions: [{ id: 'price', label: '价格', weight: 0, direction: 'lower' }],
              candidates: [{ label: 'A', values: { price: 1 } }],
            }),
          ]),
        ),
      ),
      'semantic-violation',
    );
  });

  it('偏好权重可以引用状态变量，以便用户交互调整', () => {
    const document = {
      ...doc([
        preference({
          dimensions: [
            { id: 'price', label: '价格', weight: { op: 'state', id: 'priceWeight' }, direction: 'lower' },
            { id: 'quality', label: '质量', weight: 1, direction: 'higher' },
          ],
        }),
      ]),
      state: [
        {
          id: 'priceWeight',
          label: '价格权重',
          kind: 'number',
          initial: 3,
          min: 0,
          max: 10,
          step: 1,
        },
      ],
    };
    const result = parseGenui(JSON.stringify(document));
    expect(result.ok, result.ok ? '' : `${result.code} ${result.detail}`).toBe(true);
  });

  it('偏好数字权重超过上限会被拒绝', () => {
    expectFailure(
      parseGenui(
        JSON.stringify(
          doc([
            preference({
              dimensions: [
                { id: 'price', label: '价格', weight: 1001, direction: 'lower' },
              ],
            }),
          ]),
        ),
      ),
      'schema-violation',
    );
  });

  it('偏好筛选必须引用已声明维度且每个维度最多一次', () => {
    expectFailure(
      parseGenui(
        JSON.stringify(doc([preference({ filters: [{ dimension: 'missing', min: C(0) }] })])),
      ),
      'invalid-reference',
    );
    expectFailure(
      parseGenui(
        JSON.stringify(
          doc([
            preference({
              filters: [
                { dimension: 'price', min: C(0) },
                { dimension: 'price', max: C(10) },
              ],
            }),
          ]),
        ),
      ),
      'semantic-violation',
    );
  });

  it('偏好筛选阈值可以直接写数字常量', () => {
    const parsed = parseGenui(
      JSON.stringify(
        doc([
          preference({
            filters: [{ dimension: 'price', min: 50, max: 120 }],
          }),
        ]),
      ),
    );
    expect(parsed.ok).toBe(true);
  });

  it('候选值不能包含未声明的维度', () => {
    const detail = expectFailure(
      parseGenui(
        JSON.stringify(
          doc([
            preference({
              candidates: [{ label: 'A', values: { price: 1, unknown: 2 } }],
            }),
          ]),
        ),
      ),
      'invalid-reference',
    );
    expect(detail).toContain('unknown');
  });

  it('模型数量超过上限时结构校验失败', () => {
    const models = Array.from({ length: 5 }, (_, index) =>
      budget({ id: `b${index}`, income: C(index + 1) }),
    );
    expectFailure(parseGenui(JSON.stringify(doc(models))), 'schema-violation');
  });

  it('模型对象拒绝未声明字段', () => {
    const model = { ...budget(), extra: true };
    expectFailure(parseGenui(JSON.stringify(doc([model as unknown as SemanticModel]))), 'schema-violation');
  });
  it('v5 支持空的 models 数组（纯对比表或无需模型的场景）', () => {
    const document: GenuiV5Document = {
      type: 'genui',
      version: 5,
      title: 'Gemini 3.8 Flash vs Gemini 4 Argon',
      state: [],
      derived: [],
      models: [],
      elements: [
        {
          kind: 'table',
          title: '核心规格与性能对比',
          sortable: true,
          initialSort: { key: 'dimension', dir: 'asc' },
          columns: [
            { key: 'dimension', label: '对比维度' },
            { key: 'flash', label: 'Gemini 3.8 Flash' },
            { key: 'argon', label: 'Gemini 4 Argon' },
          ],
          rows: [
            {
              cells: {
                dimension: '定位',
                flash: '生产默认主力',
                argon: '旗舰模型',
              },
            },
          ],
        },
      ],
    };
    const result = parseGenui(JSON.stringify(document));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.version).toBe(5);
      expect((result.document as GenuiV5Document).models).toEqual([]);
    }
  });
});
