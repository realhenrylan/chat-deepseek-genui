import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS, type GenuiV2Document } from '../../src/protocol/types';
import { parseGenui } from '../../src/protocol/validate';

const VALID: GenuiV2Document = {
  type: 'genui',
  version: 2,
  title: '月度预算',
  state: [
    {
      id: 'budget',
      label: '总预算',
      kind: 'number',
      initial: 5000,
      min: 0,
      max: 10000,
      step: 100,
      unit: '元',
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
    },
  ],
  derived: [
    {
      id: 'remaining',
      label: '剩余预算',
      unit: '元',
      expression: {
        op: 'subtract',
        left: { op: 'state', id: 'budget' },
        right: { op: 'const', value: 1200 },
      },
    },
  ],
  elements: [
    { kind: 'slider', bind: 'budget' },
    { kind: 'select', bind: 'category' },
    { kind: 'value', label: '当前余额', source: { kind: 'derived', id: 'remaining' } },
  ],
};

function raw(document: unknown): string {
  return JSON.stringify(document);
}

function expectFailure(document: unknown, code: string): string {
  const result = parseGenui(raw(document));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('期望协议验证失败');
  expect(result.code).toBe(code);
  return result.detail;
}

function fullBinary(depth: number): unknown {
  if (depth === 0) return { op: 'const', value: 1 };
  return { op: 'add', left: fullBinary(depth - 1), right: fullBinary(depth - 1) };
}

describe('genui v2 声明式交互协议', () => {
  it('接受本地状态、滑块/选择绑定和白名单派生运算', () => {
    const result = parseGenui(raw(VALID));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.version).toBe(2);
    if (result.document.version !== 2) throw new Error('期望 v2');
    expect(result.document.state).toHaveLength(2);
    expect(result.document.derived[0].id).toBe('remaining');
  });

  it('继续接受既有 v1 静态 Card', () => {
    const result = parseGenui(
      '{"type":"genui","version":1,"elements":[{"kind":"text","value":"兼容"}]}',
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.version).toBe(1);
  });

  it('协议文档中的预算规划示例可以通过真实解析链路', () => {
    const example = readFileSync(join(process.cwd(), 'docs/examples/budget-v2.json'), 'utf8');
    const result = parseGenui(example);

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.document.version).toBe(2);
  });

  it('拒绝未定义的状态绑定', () => {
    const document = structuredClone(VALID);
    document.elements[0] = { kind: 'slider', bind: 'missing' };
    expectFailure(document, 'invalid-reference');
  });

  it('拒绝运算中未知的状态引用', () => {
    const document = structuredClone(VALID);
    document.derived[0].expression = { op: 'state', id: 'missing' };
    expectFailure(document, 'invalid-reference');
  });

  it('拒绝重复状态 ID 与状态/派生值 ID 冲突', () => {
    const duplicate = structuredClone(VALID);
    duplicate.state[1].id = 'budget';
    expectFailure(duplicate, 'invalid-reference');

    const collision = structuredClone(VALID);
    collision.derived[0].id = 'budget';
    expectFailure(collision, 'invalid-reference');
  });

  it('拒绝派生值中的循环依赖', () => {
    const document = structuredClone(VALID);
    document.derived = [
      { id: 'first', label: '甲', expression: { op: 'derived', id: 'second' } },
      { id: 'second', label: '乙', expression: { op: 'derived', id: 'first' } },
    ];
    document.elements[2] = { kind: 'value', label: '甲', source: { kind: 'derived', id: 'first' } };
    expectFailure(document, 'dependency-cycle');
  });

  it('拒绝对选择状态执行数值运算', () => {
    const document = structuredClone(VALID);
    document.derived[0].expression = { op: 'state', id: 'category' };
    expectFailure(document, 'invalid-reference');
  });

  it('拒绝初始值越界、无效步长和不存在的选择项', () => {
    const outOfRange = structuredClone(VALID);
    outOfRange.state[0].initial = 12000;
    expectFailure(outOfRange, 'semantic-violation');

    const badStep = structuredClone(VALID);
    const numberState = badStep.state[0];
    if (numberState.kind !== 'number') throw new Error('测试数据应是数值状态');
    numberState.step = 0;
    expectFailure(badStep, 'schema-violation');

    const badOption = structuredClone(VALID);
    badOption.state[1].initial = 'unknown';
    expectFailure(badOption, 'semantic-violation');
  });

  it('拒绝超过表达式嵌套深度上限的计算树', () => {
    let expression: unknown = { op: 'const', value: 1 };
    for (let index = 0; index < LIMITS.maxExpressionDepth; index += 1) {
      expression = { op: 'negate', value: expression };
    }
    const document = structuredClone(VALID);
    document.derived[0].expression = expression as GenuiV2Document['derived'][number]['expression'];
    expectFailure(document, 'too-complex');
  });

  it('拒绝总表达式节点数超限的文件', () => {
    const document = structuredClone(VALID);
    document.derived = [
      { id: 'large', label: '大树', expression: fullBinary(6) as GenuiV2Document['derived'][number]['expression'] },
    ];
    document.elements[2] = { kind: 'value', label: '大树', source: { kind: 'derived', id: 'large' } };
    expectFailure(document, 'too-complex');
  });

  it('拒绝超出状态、派生项与选项规模上限的文档', () => {
    const manyStates = structuredClone(VALID);
    manyStates.state = Array.from({ length: LIMITS.maxStateVariables + 1 }, (_, index) => ({
      id: `value${index}`,
      label: `值 ${index}`,
      kind: 'number' as const,
      initial: 1,
      min: 0,
      max: 2,
      step: 1,
    }));
    expectFailure(manyStates, 'schema-violation');

    const manyOptions = structuredClone(VALID);
    const select = manyOptions.state[1];
    if (select.kind !== 'select') throw new Error('测试数据应是选择状态');
    select.options = Array.from({ length: LIMITS.maxSelectOptions + 1 }, (_, index) => ({
      label: `选项 ${index}`,
      value: `option${index}`,
    }));
    expectFailure(manyOptions, 'schema-violation');
  });
});

/** 只带一个数值状态的最小 v2 文档，用于步长对齐的语义校验回归。 */
function numericDocument(variable: {
  initial: number;
  min: number;
  max: number;
  step: number;
}): GenuiV2Document {
  return {
    type: 'genui',
    version: 2,
    title: '步长校验',
    state: [
      { id: 'amount', label: '数量', kind: 'number', ...variable },
    ],
    derived: [],
    elements: [{ kind: 'slider', bind: 'amount' }],
  };
}

describe('步长对齐的协议校验（Phase 4 P2：大步数容差回归）', () => {
  it('拒绝大步数下半步等明显不对齐的初始值', () => {
    // 旧相对容差 1e-9*max(1,steps) 在 steps≈1e9 时放行 0.5 的偏差。
    expectFailure(
      numericDocument({ initial: 1000000000.5, min: 0, max: 1000000000000, step: 1 }),
      'semantic-violation',
    );
    expectFailure(
      numericDocument({ initial: -0.5, min: -1000000000000, max: 1000, step: 1 }),
      'semantic-violation',
    );
  });

  it('拒绝大步数下不对齐的最大值', () => {
    expectFailure(
      numericDocument({ initial: 0, min: 0, max: 999999999999.5, step: 1 }),
      'semantic-violation',
    );
  });

  it('继续接受合法的大整数、十进制步长、非零 min 与负数范围', () => {
    const largeInteger = numericDocument({ initial: 1000000000000, min: 0, max: 1000000000000, step: 1 });
    expect(parseGenui(raw(largeInteger)).ok).toBe(true);

    const decimalStep = numericDocument({ initial: 0.3, min: 0, max: 1, step: 0.1 });
    expect(parseGenui(raw(decimalStep)).ok).toBe(true);

    const offsetMin = numericDocument({ initial: 1005, min: 5, max: 2005, step: 10 });
    expect(parseGenui(raw(offsetMin)).ok).toBe(true);

    const negativeRange = numericDocument({ initial: -999.5, min: -1000, max: 1000, step: 0.5 });
    expect(parseGenui(raw(negativeRange)).ok).toBe(true);
  });

  it('接受与 Object.prototype 同名的合法 ID（constructor/toString）', () => {
    const document: GenuiV2Document = {
      type: 'genui',
      version: 2,
      title: '原型同名 ID',
      state: [
        { id: 'constructor', label: '数量', kind: 'number', initial: 42, min: 0, max: 100, step: 1 },
      ],
      derived: [
        {
          id: 'toString',
          label: '翻倍',
          expression: {
            op: 'add',
            left: { op: 'state', id: 'constructor' },
            right: { op: 'state', id: 'constructor' },
          },
        },
      ],
      elements: [
        { kind: 'number-input', bind: 'constructor' },
        { kind: 'value', label: '派生结果', source: { kind: 'derived', id: 'toString' } },
      ],
    };

    const result = parseGenui(raw(document));
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });
});
