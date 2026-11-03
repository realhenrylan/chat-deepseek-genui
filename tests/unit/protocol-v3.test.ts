import { describe, expect, it } from 'vitest';
import { parseGenui } from '../../src/protocol/validate';
import type {
  Condition,
  GenuiFailureCode,
  GenuiV3Document,
  NumericExpression,
  ParseGenuiResult,
} from '../../src/protocol/types';

/**
 * 阶段 5：genui v3（组合元素 + 条件显示）协议与语义校验。
 *
 * 结构由构建期生成的 JSON Schema 负责；本文件重点覆盖 Schema 无法表达的
 * 引用、预算、排序/列约束，以及 v3 与 v1/v2 的版本边界。
 */

const C = (value: number): NumericExpression => ({ op: 'const', value });
const S = (id: string): NumericExpression => ({ op: 'state', id });
const D = (id: string): NumericExpression => ({ op: 'derived', id });
const GT = (left: NumericExpression, right: NumericExpression): Condition => ({
  op: 'num-gt',
  left,
  right,
});

function doc(overrides: Partial<GenuiV3Document> = {}): GenuiV3Document {
  return {
    type: 'genui',
    version: 3,
    title: '测试组合卡片',
    state: [{ id: 'amount', label: '金额', kind: 'number', initial: 10, min: 0, max: 100, step: 1 }],
    derived: [],
    elements: [{ kind: 'text', value: '你好' }],
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

describe('genui v3 协议', () => {
  it('接受最小的组合文档', () => {
    const result = parseGenui(JSON.stringify(doc()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.version).toBe(3);
  });

  it('version 6 返回 unsupported-version 并说明支持范围', () => {
    const detail = expectFailure(
      parseGenui('{"type":"genui","version":6,"state":[],"derived":[],"elements":[{"kind":"text","value":"x"}]}'),
      'unsupported-version',
    );
    expect(detail).toContain('6');
    expect(detail).toContain('1–5');
  });

  it('v2 文档不允许使用 v3 的 text.visibleIf', () => {
    const raw = {
      type: 'genui',
      version: 2,
      state: [],
      derived: [],
      elements: [{ kind: 'text', value: 'x', visibleIf: GT(C(1), C(0)) }],
    };
    expectFailure(parseGenui(JSON.stringify(raw)), 'schema-violation');
  });

  it('图表颜色只接受六位十六进制值', () => {
    const element = {
      kind: 'chart',
      chartType: 'bar',
      items: [{ label: 'A', value: C(1) }],
      series: [{ label: 'A', color: 'url(https://evil.example/paint)', points: [{ x: 0, y: C(1) }] }],
    };
    const withColor = {
      ...doc(),
      elements: [
        {
          kind: 'chart',
          chartType: 'line',
          series: [
            {
              label: 'A',
              color: 'red',
              points: [
                { x: 0, y: C(1) },
                { x: 1, y: C(2) },
              ],
            },
          ],
        },
      ],
    };
    expectFailure(parseGenui(JSON.stringify(withColor)), 'schema-violation');
    // 合法 hex 应通过。
    const valid = {
      ...withColor,
      elements: [
        {
          kind: 'chart',
          chartType: 'line',
          series: [
            {
              label: 'A',
              color: '#3988ff',
              points: [
                { x: 0, y: C(1) },
                { x: 1, y: C(2) },
              ],
            },
          ],
        },
      ],
    };
    expect(parseGenui(JSON.stringify(valid)).ok).toBe(true);
    // 防止未使用变量被 lint 误判。
    expect(element.kind).toBe('chart');
  });

  it('条件引用不存在/非选择状态时返回 invalid-reference', () => {
    const missing = doc({
      elements: [
        {
          kind: 'note',
          text: '提示',
          visibleIf: { op: 'state-eq', id: 'nope', value: 'x' },
        },
      ],
    });
    expect(expectFailure(parseGenui(JSON.stringify(missing)), 'invalid-reference')).toContain('nope');

    const numeric = doc({
      elements: [{ kind: 'note', text: '提示', visibleIf: { op: 'state-eq', id: 'amount', value: 'x' } }],
    });
    expect(expectFailure(parseGenui(JSON.stringify(numeric)), 'invalid-reference')).toContain('amount');
  });

  it('表格 visibleIf 也会做引用与条件校验', () => {
    const invalid = doc({
      elements: [
        {
          kind: 'table',
          columns: [{ key: 'name', label: '项目' }],
          rows: [{ cells: { name: '只有一行' } }],
          visibleIf: { op: 'num-gt', left: S('missing'), right: C(0) },
        },
      ],
    });
    expect(expectFailure(parseGenui(JSON.stringify(invalid)), 'invalid-reference')).toContain('missing');

    const valid = doc({
      elements: [
        {
          kind: 'table',
          columns: [{ key: 'name', label: '项目' }],
          rows: [{ cells: { name: '只有一行' } }],
          visibleIf: GT(S('amount'), C(5)),
        },
      ],
    });
    expect(parseGenui(JSON.stringify(valid)).ok).toBe(true);
  });

  it('条件引用选择状态的未知选项时返回 semantic-violation', () => {
    const conditional = doc({
      state: [
        {
          id: 'mode',
          label: '模式',
          kind: 'select',
          initial: 'a',
          options: [{ label: 'A', value: 'a' }],
        },
      ],
      elements: [{ kind: 'note', text: '提示', visibleIf: { op: 'state-eq', id: 'mode', value: 'b' } }],
    });
    expect(expectFailure(parseGenui(JSON.stringify(conditional)), 'semantic-violation')).toContain('b');
  });

  it('表格行出现未定义列或初始排序引用未知列时返回 invalid-reference', () => {
    const table = (overrides: Record<string, unknown>) => ({
      ...doc(),
      elements: [
        {
          kind: 'table',
          columns: [{ key: 'name', label: '名称' }],
          rows: [{ cells: { name: 'A' } }],
          ...overrides,
        },
      ],
    });
    expect(
      expectFailure(parseGenui(JSON.stringify(table({ rows: [{ cells: { other: 'A' } }] }))), 'invalid-reference'),
    ).toContain('other');
    expect(
      expectFailure(parseGenui(JSON.stringify(table({ initialSort: { key: 'missing', dir: 'asc' } }))), 'invalid-reference'),
    ).toContain('missing');
  });

  it('initialSort 使用 direction 时返回 schema-violation', () => {
    const raw = {
      ...doc(),
      elements: [
        {
          kind: 'table',
          columns: [{ key: 'name', label: '名称' }],
          rows: [{ cells: { name: 'A' } }],
          initialSort: { key: 'name', direction: 'asc' },
        },
      ],
    };
    expectFailure(parseGenui(JSON.stringify(raw)), 'schema-violation');
  });

  it('表格列 key 重复返回 semantic-violation', () => {
    const duplicate = doc({
      elements: [
        {
          kind: 'table',
          columns: [
            { key: 'name', label: '名称' },
            { key: 'name', label: '名称 2' },
          ],
          rows: [{ cells: { name: 'A' } }],
        },
      ],
    });
    expect(expectFailure(parseGenui(JSON.stringify(duplicate)), 'semantic-violation')).toContain('name');
  });

  it('折线图 x 必须严格递增', () => {
    const line = doc({
      elements: [
        {
          kind: 'chart',
          chartType: 'line',
          series: [
            {
              label: 'A',
              points: [
                { x: 1, y: C(1) },
                { x: 1, y: C(2) },
              ],
            },
          ],
        },
      ],
    });
    expect(expectFailure(parseGenui(JSON.stringify(line)), 'semantic-violation')).toContain('x');
  });

  it('表达式节点预算在 v3 图表/表格/派生之间共享', () => {
    const columns = Array.from({ length: 10 }, (_, index) => ({ key: `c${index}`, label: `列 ${index}` }));
    const rows = Array.from({ length: 30 }, () => ({
      cells: Object.fromEntries(columns.map((column) => [column.key, C(1)])),
    }));
    const overBudget = doc({
      derived: [{ id: 'one', label: '一', expression: C(1) }],
      elements: [{ kind: 'table', columns, rows }],
    });
    expect(expectFailure(parseGenui(JSON.stringify(overBudget)), 'too-complex')).toContain('表达式');
  });

  it('条件节点预算与深度上限返回 too-complex', () => {
    const leaf = GT(C(1), C(0));
    const group = { op: 'and' as const, conditions: Array.from({ length: 10 }, () => leaf) };
    const wide = {
      op: 'and' as const,
      conditions: Array.from({ length: 10 }, () => group),
    };
    const overBudget = doc({
      elements: Array.from({ length: 1 }, () => ({ kind: 'note' as const, text: '提示', visibleIf: wide })),
    });
    expect(expectFailure(parseGenui(JSON.stringify(overBudget)), 'too-complex')).toContain('条件');

    let deep: Condition = leaf;
    for (let index = 0; index < 6; index += 1) deep = { op: 'not', condition: deep };
    const tooDeep = doc({
      elements: [{ kind: 'note', text: '提示', visibleIf: deep }],
    });
    expect(expectFailure(parseGenui(JSON.stringify(tooDeep)), 'too-complex')).toContain('条件');
  });

  it('组合布局嵌套超过面板深度返回 too-complex', () => {
    const nested = {
      kind: 'section',
      children: [
        {
          kind: 'columns',
          columns: [
            [
              {
                kind: 'section',
                children: [
                  {
                    kind: 'columns',
                    columns: [[{ kind: 'text', value: '太深' }], [{ kind: 'text', value: '太深' }]],
                  },
                ],
              },
            ],
            [{ kind: 'text', value: '浅' }],
          ],
        },
      ],
    };
    expect(expectFailure(parseGenui(JSON.stringify(doc({ elements: [nested] as never }))), 'too-complex')).toContain(
      '嵌套',
    );
  });

  it('图表与表格内联表达式引用不存在的值返回 invalid-reference', () => {
    const chart = doc({
      elements: [
        {
          kind: 'chart',
          chartType: 'bar',
          items: [{ label: 'A', value: D('missing') }],
        },
      ],
    });
    expect(expectFailure(parseGenui(JSON.stringify(chart)), 'invalid-reference')).toContain('missing');

    const table = doc({
      elements: [
        {
          kind: 'table',
          columns: [{ key: 'amount', label: '金额', numeric: true }],
          rows: [{ cells: { amount: S('missing') } }],
        },
      ],
    });
    expect(expectFailure(parseGenui(JSON.stringify(table)), 'invalid-reference')).toContain('missing');
  });
});
