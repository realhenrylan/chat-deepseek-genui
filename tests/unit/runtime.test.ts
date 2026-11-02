import { describe, expect, it } from 'vitest';
import { calculateDerived, createInitialState } from '../../src/runtime/evaluate';
import type { GenuiV2Document, NumericExpression } from '../../src/protocol/types';

function expression(op: 'const' | 'state' | 'derived', value: number | string): NumericExpression {
  if (op === 'const') return { op, value: value as number };
  return { op, id: value as string };
}

const DOCUMENT: GenuiV2Document = {
  type: 'genui',
  version: 2,
  state: [
    { id: 'amount', label: '金额', kind: 'number', initial: 8, min: 0, max: 100, step: 1 },
    { id: 'divisor', label: '除数', kind: 'number', initial: 2, min: 0, max: 10, step: 1 },
    { id: 'choice', label: '选项', kind: 'select', initial: 'a', options: [{ label: 'A', value: 'a' }] },
  ],
  derived: [
    { id: 'sum', label: '和', expression: { op: 'add', left: expression('state', 'amount'), right: expression('const', 2) } },
    { id: 'difference', label: '差', expression: { op: 'subtract', left: expression('state', 'amount'), right: expression('const', 2) } },
    { id: 'product', label: '积', expression: { op: 'multiply', left: expression('state', 'amount'), right: expression('const', 2) } },
    { id: 'quotient', label: '商', expression: { op: 'divide', left: expression('state', 'amount'), right: expression('state', 'divisor') } },
    { id: 'minimum', label: '小值', expression: { op: 'min', left: expression('state', 'amount'), right: expression('const', 3) } },
    { id: 'maximum', label: '大值', expression: { op: 'max', left: expression('state', 'amount'), right: expression('const', 3) } },
    { id: 'rounded', label: '舍入', expression: { op: 'round', value: { op: 'divide', left: expression('state', 'amount'), right: expression('const', 3) } } },
    { id: 'absolute', label: '绝对值', expression: { op: 'abs', value: { op: 'negate', value: expression('state', 'amount') } } },
    { id: 'floor', label: '向下', expression: { op: 'floor', value: { op: 'divide', left: expression('state', 'amount'), right: expression('const', 3) } } },
    { id: 'ceil', label: '向上', expression: { op: 'ceil', value: { op: 'divide', left: expression('state', 'amount'), right: expression('const', 3) } } },
    { id: 'dependent', label: '依赖', expression: { op: 'add', left: expression('derived', 'sum'), right: expression('const', 1) } },
  ],
  elements: [{ kind: 'value', label: '结果', source: { kind: 'derived', id: 'sum' } }],
};

describe('受限本地计算运行时', () => {
  it('按文档创建独立的初始状态快照', () => {
    const first = createInitialState(DOCUMENT);
    const second = createInitialState(DOCUMENT);

    expect(first).toEqual({ amount: 8, divisor: 2, choice: 'a' });
    first.amount = 20;
    expect(second.amount).toBe(8);
  });

  it('解释白名单算术、单目运算与派生值依赖', () => {
    const calculation = calculateDerived(DOCUMENT, createInitialState(DOCUMENT));

    expect(calculation.errors).toEqual({});
    expect(calculation.values).toEqual({
      sum: 10,
      difference: 6,
      product: 16,
      quotient: 4,
      minimum: 3,
      maximum: 8,
      rounded: 3,
      absolute: 8,
      floor: 2,
      ceil: 3,
      dependent: 11,
    });
    expect(calculation.operations).toBeLessThan(100);
  });

  it('除零只让受影响的派生值显示错误，依赖它的值也能定位失败', () => {
    const state = { ...createInitialState(DOCUMENT), divisor: 0 };
    const calculation = calculateDerived(DOCUMENT, state);

    expect(calculation.values.quotient).toBeUndefined();
    expect(calculation.errors.quotient).toBe('除数不能为 0');
    expect(calculation.errors.dependent).toBeUndefined();
    expect(calculation.values.dependent).toBe(11);
  });

  it('严格拒绝超出计算上限但按 12 位精度显示仍落在上限内的结果', () => {
    const document: GenuiV2Document = {
      ...DOCUMENT,
      state: [
        { id: 'distance', label: '距离', kind: 'number', initial: 1_000_000_000_000, min: 0, max: 1_000_000_000_000, step: 1 },
      ],
      derived: [
        {
          id: 'plusOne',
          label: '加一',
          expression: {
            op: 'add',
            left: expression('state', 'distance'),
            right: expression('const', 1),
          },
        },
      ],
    };
    const calculation = calculateDerived(document, createInitialState(document));

    expect(calculation.values.plusOne).toBeUndefined();
    expect(calculation.errors.plusOne).toBe('结果超出可计算范围');
  });

  it('计算溢出不会返回 Infinity 或极端数量级', () => {
    const document: GenuiV2Document = {
      ...DOCUMENT,
      derived: [
        { id: 'overflow', label: '溢出', expression: { op: 'multiply', left: expression('const', 2_000_000), right: expression('const', 1_000_000) } },
      ],
    };
    const calculation = calculateDerived(document, createInitialState(document));

    expect(calculation.values.overflow).toBeUndefined();
    expect(calculation.errors.overflow).toBe('结果超出可计算范围');
  });

  it('防御超限表达式执行，并给出本地错误', () => {
    let tree: NumericExpression = expression('const', 1);
    for (let index = 0; index < 510; index += 1) {
      tree = { op: 'negate', value: tree };
    }
    const document: GenuiV2Document = {
      ...DOCUMENT,
      derived: [{ id: 'tooMany', label: '超限', expression: tree }],
    };
    const calculation = calculateDerived(document, createInitialState(document));

    expect(calculation.values.tooMany).toBeUndefined();
    expect(calculation.errors.tooMany).toBe('计算量超过单次更新上限');
    expect(calculation.operations).toBe(501);
  });
});
