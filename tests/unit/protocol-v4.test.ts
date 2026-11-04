import { describe, expect, it } from 'vitest';
import { parseGenui } from '../../src/protocol/validate';
import type {
  ChartFunctionSeries,
  ChartSeries,
  FunctionExpression,
  GenuiFailureCode,
  GenuiV4Document,
  NumericExpression,
  ParseGenuiResult,
} from '../../src/protocol/types';

/**
 * v4：函数曲线系列协议校验。
 *
 * 结构由构建期生成的 JSON Schema 负责；本文件重点覆盖字段白名单、
 * `x` 变量的使用边界（仅函数表达式内允许）、采样数与零点特征，
 * 以及 v3/v4 的版本边界与离散折线兼容。
 */

const X = { op: 'x' } as FunctionExpression;
const C = (value: number): NumericExpression => ({ op: 'const', value });
const S = (id: string): NumericExpression => ({ op: 'state', id });
const MUL = (left: FunctionExpression, right: FunctionExpression): FunctionExpression => ({
  op: 'multiply',
  left,
  right,
});
const ADD = (left: FunctionExpression, right: FunctionExpression): FunctionExpression => ({
  op: 'add',
  left,
  right,
});

/** 二次函数 y = a·x² + b·x + c（公式只声明一次，允许局部 x）。 */
const PARABOLA: FunctionExpression = ADD(MUL(S('a'), MUL(X, X)), ADD(MUL(S('b'), X), S('c')));

function seriesWith(function_?: Partial<ChartFunctionSeries['function']>): ChartFunctionSeries {
  return {
    label: '曲线',
    function: {
      expression: PARABOLA,
      samples: 9,
      ...function_,
    },
  };
}

function lineElement(series: Array<ChartSeries | ChartFunctionSeries>) {
  return { kind: 'chart', chartType: 'line', series };
}

function doc(elements: unknown[] = [lineElement([seriesWith()])]): GenuiV4Document {
  return {
    type: 'genui',
    version: 4,
    state: [
      { id: 'a', label: 'a', kind: 'number', initial: 1, min: -2, max: 2, step: 0.5 },
      { id: 'b', label: 'b', kind: 'number', initial: 0, min: -4, max: 4, step: 0.5 },
      { id: 'c', label: 'c', kind: 'number', initial: 0, min: -5, max: 5, step: 0.5 },
    ],
    derived: [],
    elements: elements as GenuiV4Document['elements'],
  };
}

function expectFailure(result: ParseGenuiResult, code: GenuiFailureCode): string {
  expect(result.ok, `期望失败 ${code}，实际成功`).toBe(false);
  if (result.ok) throw new Error('期望失败');
  expect(result.code).toBe(code);
  expect(result.detail.length).toBeGreaterThan(0);
  return result.detail;
}

describe('genui v4 函数曲线系列', () => {
  it('接受只含函数曲线的 v4 文档', () => {
    const result = parseGenui(JSON.stringify(doc()));
    expect(result.ok, result.ok ? '' : `${result.code} ${result.detail}`).toBe(true);
    if (result.ok) expect(result.document.version).toBe(4);
  });

  it('函数表达式允许局部 x 与 state/derived 引用', () => {
    const elements = [
      lineElement([seriesWith({ expression: PARABOLA })]),
    ];
    const result = parseGenui(JSON.stringify(doc(elements)));
    expect(result.ok).toBe(true);
  });

  it('v3 文档不允许使用函数曲线系列', () => {
    const detail = expectFailure(
      parseGenui(JSON.stringify({ ...doc(), version: 3 })),
      'schema-violation',
    );
    expect(detail.length).toBeGreaterThan(0);
  });

  it('derived 表达式禁止使用变量 x', () => {
    const document = {
      ...doc(),
      derived: [{ id: 'bad', label: '坏', expression: MUL(X, X) }],
    };
    // {op:'x'} 只出现在函数曲线表达式定义里，schema 层即拒绝；语义层为纵深防御。
    expectFailure(parseGenui(JSON.stringify(document)), 'schema-violation');
  });

  it('离散折线点的 y 表达式禁止使用变量 x', () => {
    const elements = [
      lineElement([
        {
          label: '离散',
          points: [
            { x: 0, y: MUL(X, X) as unknown as NumericExpression },
            { x: 1, y: C(1) },
          ],
        },
      ]),
    ];
    expectFailure(parseGenui(JSON.stringify({ ...doc(), elements })), 'schema-violation');
  });

  it('domain 表达式是普通表达式，禁止使用变量 x', () => {
    const elements = [
      lineElement([
        seriesWith({
          domain: {
            start: X as unknown as NumericExpression,
            end: { op: 'add', left: S('a'), right: C(1) },
          },
        }),
      ]),
    ];
    expectFailure(parseGenui(JSON.stringify(doc(elements))), 'schema-violation');
  });

  it('samples 必须是 5–50 的整数', () => {
    for (const samples of [4, 51, 9.5]) {
      const bad = { ...doc(), elements: [lineElement([seriesWith({ samples })])] };
      expect(parseGenui(JSON.stringify(bad)).ok).toBe(false);
    }
    const detail = expectFailure(
      parseGenui(JSON.stringify({ ...doc(), elements: [lineElement([seriesWith({ samples: 51 })])] })),
      'schema-violation',
    );
    expect(detail.length).toBeGreaterThan(0);
  });

  it('features 只接受恰一个 zero', () => {
    const withZero = parseGenui(
      JSON.stringify({ ...doc(), elements: [lineElement([seriesWith({ features: ['zero'] })])] }),
    );
    expect(withZero.ok).toBe(true);
    const doubled = { ...doc(), elements: [lineElement([seriesWith({ features: ['zero', 'zero'] })])] };
    expectFailure(parseGenui(JSON.stringify(doubled)), 'schema-violation');
    const top = { ...doc(), elements: [lineElement([seriesWith({ features: ['top'] as never })])] };
    expectFailure(parseGenui(JSON.stringify(top)), 'schema-violation');
  });

  it('函数曲线定义与系列对象保持字段白名单', () => {
    const badDefinition = {
      label: '曲线',
      function: { expression: PARABOLA, samples: 9, evil: 1 },
    };
    const withBadDefinition = { ...doc(), elements: [lineElement([badDefinition as ChartFunctionSeries])] };
    expectFailure(parseGenui(JSON.stringify(withBadDefinition)), 'schema-violation');
    const badSeries = { label: '曲线', function: PARABOLA } as unknown as ChartFunctionSeries;
    const withBadSeries = { ...doc(), elements: [lineElement([badSeries])] };
    expectFailure(parseGenui(JSON.stringify(withBadSeries)), 'schema-violation');
  });

  it('domain 必须 start/end 且不得多余字段', () => {
    const elements = [
      lineElement([
        seriesWith({
          domain: { start: C(-2), end: C(2), evil: C(0) } as never,
        }),
      ]),
    ];
    expect(expectFailure(parseGenui(JSON.stringify(doc(elements))), 'schema-violation').length).toBeGreaterThan(0);
  });

  it('单一图表内函数采样总数超过上限时拒绝', () => {
    const five = [1, 2, 3, 4, 5].map((number) => ({
      label: `曲线${number}`,
      function: { expression: PARABOLA, samples: 50 },
    }));
    const tooMany = { ...doc(), elements: [lineElement(five)] };
    const detail = expectFailure(parseGenui(JSON.stringify(tooMany)), 'too-complex');
    expect(detail).toContain('函数曲线采样总数超过上限');
  });

  it('文档范围累计采样：多个图表超过文档级上限时拒绝', () => {
    // 每图 3 系列 × 50 = 150，单图内合法；两图合计 300 必须超过文档级 200。
    const three = [1, 2, 3].map((number) => ({
      label: `曲线${number}`,
      function: { expression: PARABOLA, samples: 50 },
    }));
    const tooMany = { ...doc(), elements: [lineElement(three), lineElement(three)] };
    const detail = expectFailure(parseGenui(JSON.stringify(tooMany)), 'too-complex');
    expect(detail).toContain('函数曲线采样总数超过上限');
  });

  it('文档范围累计采样：合计恰好等于上限时接受', () => {
    const two = [1, 2].map((number) => ({
      label: `曲线${number}`,
      function: { expression: PARABOLA, samples: 50 },
    }));
    const result = parseGenui(
      JSON.stringify({ ...doc(), elements: [lineElement(two), lineElement(two)] }),
    );
    expect(result.ok).toBe(true);
  });

  it('嵌套布局中的图表也计入文档级采样总数', () => {
    const three = [1, 2, 3].map((number) => ({
      label: `曲线${number}`,
      function: { expression: PARABOLA, samples: 50 },
    }));
    const two = [1, 2].map((number) => ({
      label: `曲线${number}`,
      function: { expression: PARABOLA, samples: 50 },
    }));
    const combined = {
      ...doc(),
      elements: [
        lineElement(three),
        { kind: 'section', title: '嵌套', children: [lineElement(two)] },
      ],
    };
    const detail = expectFailure(parseGenui(JSON.stringify(combined)), 'too-complex');
    expect(detail).toContain('函数曲线采样总数超过上限');
  });

  it('函数系列与离散系列可在同一图表混用', () => {
    const elements = [
      lineElement([
        seriesWith(),
        {
          label: '实测',
          points: [
            { x: -1, y: C(2) },
            { x: 0, y: C(0) },
            { x: 1, y: C(2) },
          ],
        },
      ]),
    ];
    const result = parseGenui(JSON.stringify(doc(elements)));
    expect(result.ok, result.ok ? '' : `${result.code} ${result.detail}`).toBe(true);
  });

  it('函数系列颜色仍必须是六位十六进制', () => {
    const elements = [
      lineElement([{ label: '曲线', color: 'url(https://evil.example)', function: { expression: PARABOLA, samples: 9 } }]),
    ];
    expectFailure(parseGenui(JSON.stringify(doc(elements))), 'schema-violation');
  });
});
