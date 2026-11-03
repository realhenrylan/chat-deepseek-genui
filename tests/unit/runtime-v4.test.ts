import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  evaluateComposite,
  lookupExpression,
  lookupFunctionSeries,
} from '../../src/runtime/evaluate';
import type {
  ChartFunctionDefinition,
  ChartFunctionSeries,
  FunctionExpression,
  GenuiV4Document,
  GenuiV4Element,
  NumericExpression,
} from '../../src/protocol/types';

/**
 * v4：函数曲线采样运行时快照。
 *
 * 渲染阶段只读快照（lookupFunctionSeries），这里验证：公式只声明一次、
 * 采样与数值结果一致、零点覆盖的对称加倍重采样、a=0 的设计性静默回退、
 * 失败样本丢弃与整系列运算预算，以及与离散系列的互不干扰。
 */

const X: FunctionExpression = { op: 'x' };
const C = (value: number): FunctionExpression & NumericExpression => ({ op: 'const', value });
const S = (id: string): FunctionExpression & NumericExpression => ({ op: 'state', id });
const ADD = (l: FunctionExpression, r: FunctionExpression): FunctionExpression => ({ op: 'add', left: l, right: r });
const SUB = (l: FunctionExpression, r: FunctionExpression): FunctionExpression => ({ op: 'subtract', left: l, right: r });
const MUL = (l: FunctionExpression, r: FunctionExpression): FunctionExpression => ({ op: 'multiply', left: l, right: r });
const DIV = (l: FunctionExpression, r: FunctionExpression): FunctionExpression => ({ op: 'divide', left: l, right: r });

/** y = a·x² + b·x + c。 */
const PARABOLA: FunctionExpression = ADD(MUL(S('a'), MUL(X, X)), ADD(MUL(S('b'), X), S('c')));
// 对称轴 -b/(2a)：domain 边界是普通表达式，这里内联字面量保证 NumericExpression。
const vertexDomain = (): { start: NumericExpression; end: NumericExpression } => {
  const vertexX: NumericExpression = {
    op: 'divide',
    left: { op: 'negate', value: S('b') },
    right: { op: 'multiply', left: C(2), right: S('a') },
  };
  return {
    start: { op: 'subtract', left: vertexX, right: C(10) },
    end: { op: 'add', left: vertexX, right: C(10) },
  };
};

const states = [
  { id: 'a', label: 'a', kind: 'number' as const, initial: 1, min: -2, max: 2, step: 0.5 },
  { id: 'b', label: 'b', kind: 'number' as const, initial: 0, min: -4, max: 4, step: 0.5 },
  { id: 'c', label: 'c', kind: 'number' as const, initial: 0, min: -5, max: 5, step: 0.5 },
];

function documentWith(elements: GenuiV4Element[], extra: Partial<GenuiV4Document> = {}): GenuiV4Document {
  const document: GenuiV4Document = { type: 'genui', version: 4, state: states, derived: [], elements };
  return { ...document, ...extra };
}

function lineElement(series: Array<ChartFunctionSeries | { label: string; color?: string } & { points: Array<{ x: number; y: NumericExpression }> }>) {
  return { kind: 'chart' as const, chartType: 'line' as const, series };
}

function seriesWith(
  definition: Partial<ChartFunctionDefinition> & Pick<ChartFunctionDefinition, 'expression'>,
): ChartFunctionSeries {
  return { label: '曲线', function: definition as ChartFunctionDefinition };
}

describe('v4 函数曲线采样', () => {
  it('公式只声明一次，采样结果与手工计算一致', () => {
    const series = seriesWith({ expression: PARABOLA });
    const document = documentWith([lineElement([series])]);
    const state = createInitialState(document);
    const evaluation = evaluateComposite(document, state);
    const result = lookupFunctionSeries(evaluation, series.function);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('期望采样成功');
    expect(result.domain).toEqual({ start: -10, end: 10 });
    expect(result.expanded).toBe(false);
    expect(result.fallbackDomain).toBe(false);
    expect(result.dropped).toBe(0);
    expect(result.xs).toHaveLength(41);
    for (let index = 0; index < result.xs.length; index += 1) {
      const x = result.xs[index];
      expect(result.ys[index]).not.toBeNull();
      expect(result.ys[index]).toBeCloseTo(x * x, 10);
    }
  });

  it('a=0 时对称轴除零按设计静默回退默认区间，曲线退化为直线', () => {
    const series = seriesWith({
      expression: PARABOLA,
      domain: vertexDomain(),
      features: ['zero'],
    });
    const document = documentWith([lineElement([series])]);
    const evaluation = evaluateComposite(document, { a: 0, b: 4, c: 0 });
    const result = lookupFunctionSeries(evaluation, series.function);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('期望采样成功');
    expect(result.fallbackDomain).toBe(true);
    expect(result.domain).toEqual({ start: -10, end: 10 });
    // y = 4x：x=0 是默认区间 41 等分的样本点，零点被精确覆盖。
    expect(result.expanded).toBe(false);
    expect(result.ys[20]).toBe(0);
    expect(result.ys[0]).toBeCloseTo(-40, 9);
    expect(result.ys[40]).toBeCloseTo(40, 9);
    expect(result.dropped).toBe(0);
  });

  it('参数变化后按新状态重采样；未声明 features 时不扩展', () => {
    const series = seriesWith({ expression: PARABOLA, domain: vertexDomain() });
    const document = documentWith([lineElement([series])]);
    const evaluation = evaluateComposite(document, { a: 0.1, b: 4, c: 0 });
    const result = lookupFunctionSeries(evaluation, series.function);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('期望采样成功');
    // 初始区间 [-30,-10]（顶点 x=-20）内无零点，且整体为负。
    expect(result.expanded).toBe(false);
    expect(result.domain).toEqual({ start: -30, end: -10 });
    expect(result.ys.every((y) => y !== null && y < 0)).toBe(true);
    expect(result.dropped).toBe(0);
  });

  it('声明 features:["zero"] 时把零点纳入视口（a=0.1, b=4）', () => {
    const series = seriesWith({
      expression: PARABOLA,
      domain: vertexDomain(),
      features: ['zero'],
    });
    const document = documentWith([lineElement([series])]);
    const evaluation = evaluateComposite(document, { a: 0.1, b: 4, c: 0 });
    const result = lookupFunctionSeries(evaluation, series.function);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('期望采样成功');
    // ×2 对称扩展一轮后变为 [顶点-40, 顶点+40] = [-40, 0]，两个根都在边界上。
    expect(result.expanded).toBe(true);
    expect(result.domain).toEqual({ start: -40, end: 0 });
    const ys = result.ys.filter((y): y is number => y !== null);
    expect(Math.min(...ys)).toBeLessThan(0);
    // x=-40 与 x=0 处 f≈0（浮点误差内）。
    expect(result.ys[0]).toBeCloseTo(0, 6);
    expect(result.ys[40]).toBeCloseTo(0, 6);
    expect(result.dropped).toBe(0);
    expect(result.fallbackDomain).toBe(false);
  });

  it('单个样本求值失败时丢弃该点并标记 dropped，渲染为折线断裂', () => {
    const f = (x: FunctionExpression) => DIV(x, SUB(x, C(1)));
    const series = seriesWith({ expression: f(X), samples: 41 });
    const document = documentWith([lineElement([series])]);
    const evaluation = evaluateComposite(document, { a: 1, b: 0, c: 0 });
    const result = lookupFunctionSeries(evaluation, series.function);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('期望采样成功');
    // 默认区间 [-10,10] 的第 22 个采样点 x=1 正好是除零位置。
    expect(result.dropped).toBe(1);
    expect(result.ys[22]).toBeNull();
    expect(result.ys[21]).not.toBeNull();
    expect(result.ys[23]).not.toBeNull();
  });

  it('常量函数不随 x 变化，只采样一轮且不扩展', () => {
    const series = seriesWith({ expression: C(7), features: ['zero'] });
    const document = documentWith([lineElement([series])]);
    const evaluation = evaluateComposite(document, { a: 1, b: 0, c: 0 });
    const result = lookupFunctionSeries(evaluation, series.function);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('期望采样成功');
    expect(result.xs).toHaveLength(41);
    expect(result.ys.every((y) => y === 7)).toBe(true);
    expect(result.expanded).toBe(false);
  });

  it('单系列采样运算量超过专用预算时整系列失败并给出原因', () => {
    // 深度 7、127 节点的 x+x 树：50 个样本 × 127 次运算 > 每系列 5000 预算。
    const series = seriesWith({ expression: buildXTree(6), samples: 50 });
    const document = documentWith([lineElement([series])]);
    const evaluation = evaluateComposite(document, { a: 1, b: 0, c: 0 });
    const result = lookupFunctionSeries(evaluation, series.function);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('期望整系列失败');
    expect(result.error).toBe('函数曲线采样运算量超过上限');
  });

  it('函数采样预算独立：超预算不影响同一快照的离散点与派生值', () => {
    // 两个 127 节点子树相加：255 节点，50 样本 × 255 次运算远超预算。
    const heavy = ADD(buildXTree(6), buildXTree(6));
    const sum: NumericExpression = { op: 'add', left: S('a'), right: S('b') };
    const heavySeries = seriesWith({ expression: heavy, samples: 50 });
    const element = lineElement([
      heavySeries,
      { label: '实测', points: [{ x: 0, y: sum }, { x: 1, y: sum }] },
    ]) as GenuiV4Element;
    const document = documentWith(
      [element, { kind: 'value', label: '和', source: { kind: 'derived', id: 'sum' } }],
      { derived: [{ id: 'sum', label: '和', expression: sum }] },
    );

    const evaluation = evaluateComposite(document, { a: 1, b: 2, c: 3 });
    expect(lookupFunctionSeries(evaluation, heavySeries.function).ok).toBe(false);
    // 离散点的内联表达式与派生值共享同一对象，仍按共享预算正常求值。
    expect(lookupExpression(evaluation, sum)).toEqual({ ok: true, value: 3 });
  });

  it('未求值的函数曲线按稳定回退返回局部错误', () => {
    const document = documentWith([{ kind: 'note', text: '无图表' }]);
    const evaluation = evaluateComposite(document, { a: 1, b: 0, c: 0 });
    const orphan = seriesWith({ expression: PARABOLA });
    expect(lookupFunctionSeries(evaluation, orphan.function)).toEqual({
      ok: false,
      error: '函数曲线未求值',
    });
  });
});

/** 深度 depth 的平衡 x+x 树（2^(depth+1) 个叶子）。 */
function buildXTree(depth: number): FunctionExpression {
  return depth === 0 ? X : ADD(buildXTree(depth - 1), buildXTree(depth - 1));
}
