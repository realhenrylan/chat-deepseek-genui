import { describe, expect, it } from 'vitest';
import { GENUI_PROMPT_TEXT } from '../../src/content/prompt';
import type { GenuiV5Document } from '../../src/protocol/types';
import { parseGenui } from '../../src/protocol/validate';
import { createInitialState, evaluateComposite } from '../../src/runtime/evaluate';

function parseV5(raw: string): GenuiV5Document {
  const result = parseGenui(raw);
  expect(result.ok, result.ok ? '' : `${result.code}: ${result.detail}`).toBe(true);
  if (!result.ok || result.document.version !== 5) {
    throw new Error(`Expected v5 document: ${result.ok ? 'not v5' : result.detail}`);
  }
  return result.document;
}

describe('Prompt 与 Schema / Validator 自然写法一致性套件', () => {
  it('柱状图/饼图 items 的 value 可以直接写裸数字，并自动归一为 const 表达式', () => {
    const raw = JSON.stringify({
      type: 'genui',
      version: 5,
      state: [],
      derived: [],
      models: [],
      elements: [
        {
          kind: 'chart',
          chartType: 'bar',
          title: '直接写数字的柱状图',
          items: [
            { label: '项目A', value: 12 },
            { label: '项目B', value: 34.5 },
          ],
        },
      ],
    });

    const doc = parseV5(raw);
    const chart = doc.elements[0] as { kind: 'chart'; items: Array<{ value: unknown }> };
    expect(chart.items[0].value).toEqual({ op: 'const', value: 12 });
    expect(chart.items[1].value).toEqual({ op: 'const', value: 34.5 });

    const evaluation = evaluateComposite(doc, createInitialState(doc));
    expect(evaluation.expressions.size).toBe(2);
  });

  it('折线离散点 series points 的 y 可以直接写裸数字（实测数据自然写法）', () => {
    const raw = JSON.stringify({
      type: 'genui',
      version: 5,
      state: [],
      derived: [],
      models: [],
      elements: [
        {
          kind: 'chart',
          chartType: 'line',
          title: '离散折线图',
          series: [
            {
              label: '实测数据',
              points: [
                { x: 1, y: 3.2 },
                { x: 2, y: 4.8 },
                { x: 3, y: 6.0 },
              ],
            },
          ],
        },
      ],
    });

    const doc = parseV5(raw);
    const chart = doc.elements[0] as {
      kind: 'chart';
      series: Array<{ points: Array<{ y: unknown }> }>;
    };
    expect(chart.series[0].points[0].y).toEqual({ op: 'const', value: 3.2 });
    expect(chart.series[0].points[1].y).toEqual({ op: 'const', value: 4.8 });
    expect(chart.series[0].points[2].y).toEqual({ op: 'const', value: 6.0 });
  });

  it('函数曲线的 domain.start 与 domain.end 可以直接写裸数字', () => {
    const raw = JSON.stringify({
      type: 'genui',
      version: 5,
      state: [],
      derived: [],
      models: [],
      elements: [
        {
          kind: 'chart',
          chartType: 'line',
          title: '抛物线',
          series: [
            {
              label: 'y = x^2',
              function: {
                expression: { op: 'multiply', left: { op: 'x' }, right: { op: 'x' } },
                domain: { start: -10, end: 10 },
              },
            },
          ],
        },
      ],
    });

    const doc = parseV5(raw);
    const chart = doc.elements[0] as {
      kind: 'chart';
      series: Array<{ function: { domain: { start: unknown; end: unknown } } }>;
    };
    expect(chart.series[0].function.domain.start).toEqual({ op: 'const', value: -10 });
    expect(chart.series[0].function.domain.end).toEqual({ op: 'const', value: 10 });

    const evaluation = evaluateComposite(doc, createInitialState(doc));
    expect(evaluation.functions.size).toBe(1);
  });

  it('预算模型的 income 与 expenses[].amount 可以直接写裸数字', () => {
    const raw = JSON.stringify({
      type: 'genui',
      version: 5,
      state: [],
      derived: [],
      models: [
        {
          kind: 'budget',
          id: 'b1',
          label: '月度收支',
          unit: '元',
          precision: 0,
          income: 10000,
          expenses: [
            { label: '房租', amount: 3500 },
            { label: '伙食', amount: 2000 },
          ],
        },
      ],
      elements: [
        { kind: 'value', label: '余额', source: { kind: 'model', model: 'b1', key: 'balance' } },
      ],
    });

    const doc = parseV5(raw);
    const evaluation = evaluateComposite(doc, createInitialState(doc));
    const modelResult = evaluation.models.get('b1');
    expect(modelResult).toBeDefined();
    expect(modelResult?.ok).toBe(true);
    expect(modelResult?.scalars.balance).toBe(4500);
  });

  it('成本模型的 horizon、fee 与 usesPerPeriod 可以直接写裸数字', () => {
    const raw = JSON.stringify({
      type: 'genui',
      version: 5,
      state: [],
      derived: [],
      models: [
        {
          kind: 'cost',
          id: 'c1',
          label: '会员比较',
          horizon: 12,
          plans: [
            { label: '包年', fee: 120, coverage: 12, usesPerPeriod: 10 },
            { label: '包月', fee: 15, coverage: 1, usesPerPeriod: 10 },
          ],
        },
      ],
      elements: [
        { kind: 'value', label: '最低单次', source: { kind: 'model', model: 'c1', key: 'lowestUnitCost' } },
      ],
    });

    const doc = parseV5(raw);
    const evaluation = evaluateComposite(doc, createInitialState(doc));
    const modelResult = evaluation.models.get('c1');
    expect(modelResult).toBeDefined();
    expect(modelResult?.ok).toBe(true);
    expect(modelResult?.scalars.lowestTotalCost).toBe(120);
  });

  it('visibleIf 比较条件中的 left 与 right 可以直接写裸数字', () => {
    const raw = JSON.stringify({
      type: 'genui',
      version: 5,
      state: [
        { id: 'count', label: '数量', kind: 'number', initial: 10, min: 0, max: 100, step: 1 },
      ],
      derived: [],
      models: [],
      elements: [
        {
          kind: 'note',
          text: '数量大于 50 时显示',
          visibleIf: {
            op: 'num-gt',
            left: { op: 'state', id: 'count' },
            right: 50,
          },
        },
      ],
    });

    const doc = parseV5(raw);
    const element = doc.elements[0] as {
      kind: 'note';
      visibleIf: { op: string; left: unknown; right: unknown };
    };
    expect(element.visibleIf.right).toEqual({ op: 'const', value: 50 });

    const evaluation = evaluateComposite(doc, createInitialState(doc));
    // count 初始值为 10，10 > 50 为 false
    const condResult = evaluation.conditions.get(element.visibleIf as never);
    expect(condResult).toEqual({ ok: true, value: false });
  });

  it('二元表达式的 left 或 right 可以直接写裸数字，无需手动包裹 const', () => {
    const raw = JSON.stringify({
      type: 'genui',
      version: 5,
      state: [
        { id: 'base', label: '基数', kind: 'number', initial: 100, min: 0, max: 1000, step: 10 },
      ],
      derived: [
        {
          id: 'total',
          label: '总额',
          expression: {
            op: 'multiply',
            left: { op: 'state', id: 'base' },
            right: 1.2,
          },
        },
      ],
      models: [],
      elements: [
        { kind: 'value', label: '总额', source: { kind: 'derived', id: 'total' } },
      ],
    });

    const doc = parseV5(raw);
    const derived = doc.derived[0];
    const expr = derived.expression as { op: string; left: unknown; right: unknown };
    expect(expr.right).toEqual({ op: 'const', value: 1.2 });

    const evaluation = evaluateComposite(doc, createInitialState(doc));
    expect(evaluation.derived.values['total']).toBe(120);
  });

  it('一元表达式（如 negate）的 value 可以直接写裸数字', () => {
    const raw = JSON.stringify({
      type: 'genui',
      version: 5,
      state: [],
      derived: [
        {
          id: 'neg',
          label: '负数',
          expression: { op: 'negate', value: 42 },
        },
      ],
      models: [],
      elements: [
        { kind: 'value', label: '负数', source: { kind: 'derived', id: 'neg' } },
      ],
    });

    const doc = parseV5(raw);
    const evaluation = evaluateComposite(doc, createInitialState(doc));
    expect(evaluation.derived.values['neg']).toBe(-42);
  });

  it('derived 的顶级 expression 可以直接写裸数字常量', () => {
    const raw = JSON.stringify({
      type: 'genui',
      version: 5,
      state: [],
      derived: [
        {
          id: 'taxRate',
          label: '税率',
          expression: 0.13,
        },
      ],
      models: [],
      elements: [
        { kind: 'value', label: '税率', source: { kind: 'derived', id: 'taxRate' } },
      ],
    });

    const doc = parseV5(raw);
    const evaluation = evaluateComposite(doc, createInitialState(doc));
    expect(evaluation.derived.values['taxRate']).toBe(0.13);
  });

  it('纯对比表格 + 柱状图（无需计算模型，models 为空数组）无障碍通过', () => {
    const raw = JSON.stringify({
      type: 'genui',
      version: 5,
      title: '模型综合对比',
      state: [],
      derived: [],
      models: [],
      elements: [
        {
          kind: 'table',
          title: '基准测试得分',
          columns: [
            { key: 'model', label: '模型' },
            { key: 'mmlu', label: 'MMLU 得分', numeric: true },
          ],
          rows: [
            { cells: { model: 'Gemini 3.8 Flash', mmlu: 85.5 } },
            { cells: { model: 'Argon 4', mmlu: 89.2 } },
          ],
        },
        {
          kind: 'chart',
          chartType: 'bar',
          title: '得分直方图',
          items: [
            { label: 'Gemini 3.8 Flash', value: 85.5 },
            { label: 'Argon 4', value: 89.2 },
          ],
        },
      ],
    });

    const doc = parseV5(raw);
    const evaluation = evaluateComposite(doc, createInitialState(doc));
    expect(evaluation.operations).toBeGreaterThanOrEqual(0);
  });

  it('提示词自带的示例 2（纯对比表与柱图，无模型）能直接被本地解析与执行', () => {
    const matches = [...GENUI_PROMPT_TEXT.matchAll(/```genui\n([\s\S]*?)\n```/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const example2 = parseV5(matches[1][1]);

    expect(example2.version).toBe(5);
    expect(example2.models).toEqual([]);
    expect(example2.elements.length).toBe(2);

    const evaluation = evaluateComposite(example2, createInitialState(example2));
    expect(evaluation.expressions.size).toBe(2);
  });
});
