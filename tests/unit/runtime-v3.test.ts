import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  evaluateComposite,
  lookupCondition,
  lookupExpression,
} from '../../src/runtime/evaluate';
import type {
  Condition,
  GenuiV3Document,
  NumericExpression,
} from '../../src/protocol/types';

/**
 * 阶段 5：v3 组合求值快照。
 *
 * 渲染阶段只读快照（lookup*），因此这里验证：派生值与内联表达式共享
 * 运算预算、失败互相隔离、条件按状态更新，以及未求值引用的稳定回退。
 */

const C = (value: number): NumericExpression => ({ op: 'const', value });
const S = (id: string): NumericExpression => ({ op: 'state', id });
const D = (id: string): NumericExpression => ({ op: 'derived', id });
const MUL = (left: NumericExpression, right: NumericExpression): NumericExpression => ({
  op: 'multiply',
  left,
  right,
});
const DIV = (left: NumericExpression, right: NumericExpression): NumericExpression => ({
  op: 'divide',
  left,
  right,
});
const GT = (left: NumericExpression, right: NumericExpression): Condition => ({
  op: 'num-gt',
  left,
  right,
});

function documentWith(elements: GenuiV3Document['elements'], extra: Partial<GenuiV3Document> = {}): GenuiV3Document {
  return {
    type: 'genui',
    version: 3,
    state: [{ id: 'amount', label: '数量', kind: 'number', initial: 10, min: 0, max: 100, step: 1 }],
    derived: [{ id: 'double', label: '两倍', expression: MUL(S('amount'), C(2)) }],
    elements,
    ...extra,
  };
}

describe('v3 组合求值', () => {
  it('一次快照内求值派生、图表/表格内联表达式与条件', () => {
    const chartValue = D('double');
    const tableValue = MUL(S('amount'), C(3));
    const condition = GT(D('double'), C(15));
    const document = documentWith([
      { kind: 'chart', chartType: 'bar', items: [{ label: '两倍', value: chartValue }] },
      {
        kind: 'table',
        columns: [{ key: 'v', label: '值', numeric: true }],
        rows: [{ cells: { v: tableValue }, visibleIf: condition }],
      },
      { kind: 'note', text: '两倍超过 15', visibleIf: condition },
    ]);

    const state = createInitialState(document);
    const evaluation = evaluateComposite(document, state);

    expect(state).toEqual({ amount: 10 });
    expect(evaluation.derived.values).toEqual({ double: 20 });
    expect(evaluation.derived.errors).toEqual({});
    expect(lookupExpression(evaluation, chartValue)).toEqual({ ok: true, value: 20 });
    expect(lookupExpression(evaluation, tableValue)).toEqual({ ok: true, value: 30 });
    expect(lookupCondition(evaluation, condition)).toEqual({ ok: true, value: true });
    expect(evaluation.operations).toBeGreaterThan(0);
    expect(evaluation.derived.operations).toBe(evaluation.operations);
  });

  it('状态变化后条件与内联表达式重新求值', () => {
    const chartValue = S('amount');
    const condition = GT(S('amount'), C(15));
    const document = documentWith([
      { kind: 'chart', chartType: 'bar', items: [{ label: '数量', value: chartValue }] },
      { kind: 'note', text: '数量超过 15', visibleIf: condition },
    ]);

    const initial = evaluateComposite(document, { amount: 10 });
    expect(lookupCondition(initial, condition)).toEqual({ ok: true, value: false });

    const changed = evaluateComposite(document, { amount: 20 });
    expect(lookupExpression(changed, chartValue)).toEqual({ ok: true, value: 20 });
    expect(lookupCondition(changed, condition)).toEqual({ ok: true, value: true });
  });

  it('单个表达式失败隔离：同卡片其他数据仍可展示', () => {
    const broken = DIV(C(1), C(0));
    const healthy = C(42);
    const document = documentWith(
      [
        {
          kind: 'chart',
          chartType: 'bar',
          items: [
            { label: '错误项', value: broken },
            { label: '正常项', value: healthy },
          ],
        },
      ],
      { derived: [] },
    );

    const evaluation = evaluateComposite(document, { amount: 10 });
    expect(lookupExpression(evaluation, broken)).toEqual({ ok: false, error: '除数不能为 0' });
    expect(lookupExpression(evaluation, healthy)).toEqual({ ok: true, value: 42 });
  });

  it('状态引用缺失时条件失败但不抛出', () => {
    const condition: Condition = { op: 'state-eq', id: 'missing', value: 'x' };
    // 直接构造未经协议校验的文档，验证运行时防御层。
    const document = documentWith([{ kind: 'note', text: '提示', visibleIf: condition }], { derived: [] });

    let evaluation: ReturnType<typeof evaluateComposite> | undefined;
    expect(() => {
      evaluation = evaluateComposite(document, { amount: 10 });
    }).not.toThrow();
    const result = lookupCondition(evaluation!, condition);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('missing');
  });

  it('未登记的表达式与条件返回稳定的未求值错误', () => {
    const document = documentWith([{ kind: 'text', value: '无表达式' }], { derived: [] });
    const evaluation = evaluateComposite(document, { amount: 10 });

    expect(lookupExpression(evaluation, C(1))).toEqual({ ok: false, error: '表达式未求值' });
    expect(lookupCondition(evaluation, GT(C(1), C(0)))).toEqual({ ok: false, error: '条件未求值' });
  });

  it('派生值失败不阻断无关的内联表达式', () => {
    const brokenDerived: NumericExpression = DIV(C(1), C(0));
    const inline = S('amount');
    const condition = GT(D('broken'), C(0));
    const document = documentWith(
      [
        { kind: 'chart', chartType: 'bar', items: [{ label: '数量', value: inline }] },
        { kind: 'note', text: '提示', visibleIf: condition },
      ],
      { derived: [{ id: 'broken', label: '错误', expression: brokenDerived }] },
    );

    const evaluation = evaluateComposite(document, { amount: 10 });
    expect(evaluation.derived.errors.broken).toBe('除数不能为 0');
    expect(lookupExpression(evaluation, inline)).toEqual({ ok: true, value: 10 });
    expect(lookupCondition(evaluation, condition).ok).toBe(false);
  });
});
