import { afterEach, describe, expect, it } from 'vitest';
import type {
  BudgetModel,
  GenuiV5Document,
  GenuiV5Element,
  NumericExpression,
  PreferenceModel,
} from '../../src/protocol/types';
import { mountCard, type MountedCard } from '../../src/render/mount';

/**
 * v5：模型来源的数值/表格/图表与解释元素渲染。
 *
 * 所有视图都读取 evaluateComposite 生成的同一份 ModelResult 快照；
 * 这里验证渲染接线、缺失值的显式呈现与失败可见性。
 */

const C = (value: number): NumericExpression => ({ op: 'const', value });

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

function preference(): PreferenceModel {
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
  };
}

function v5(
  models: GenuiV5Document['models'],
  elements: GenuiV5Element[],
  overrides: Partial<GenuiV5Document> = {},
): GenuiV5Document {
  return {
    type: 'genui',
    version: 5,
    title: '语义模型卡片',
    state: [],
    derived: [],
    models,
    elements,
    ...overrides,
  };
}

let mounted: MountedCard | null = null;

function mount(doc: GenuiV5Document): HTMLElement {
  const host = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(host);
  mounted = mountCard(host, { document: doc, rawJson: JSON.stringify(doc) });
  return host;
}

function shadow(host: HTMLElement): ShadowRoot {
  const root = host.shadowRoot;
  expect(root).not.toBeNull();
  return root!;
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  globalThis.document.body.replaceChildren();
});

describe('v5 语义模型渲染', () => {
  it('数值、表格、图表与解释读取同一份预算快照', () => {
    const host = mount(
      v5([budget()], [
        {
          kind: 'value',
          label: '余额',
          source: { kind: 'model', model: 'budget', key: 'balance' },
          unit: '元',
        },
        { kind: 'table', title: '预算摘要', source: { model: 'budget', view: 'summary' } },
        { kind: 'chart', chartType: 'bar', title: '收支', source: { model: 'budget' } },
        { kind: 'explain', model: 'budget', title: '预算依据' },
      ]),
    );
    const root = shadow(host);

    expect(root.querySelector('.genui-value-output')?.textContent).toContain('-100');
    expect(root.querySelectorAll('.genui-table tbody tr')).toHaveLength(3);
    expect(root.textContent).toContain('预算摘要');
    expect(root.textContent).toContain('收入');
    expect(root.textContent).toContain('支出');
    expect(root.querySelectorAll('.genui-bar-row')).toHaveLength(2);
    expect(root.querySelectorAll('.genui-explain-basis-row').length).toBeGreaterThanOrEqual(5);
    expect(root.textContent).toContain('收入 − 支出 = 余额');
    expect(root.textContent).toContain('支出超过收入');
    expect(root.querySelector('.genui-table-warning')).toBeNull();
  });

  it('偏好得分分解表把缺失维度显示为占位符，解释列出权重依据', () => {
    const host = mount(
      v5([preference()], [
        { kind: 'table', source: { model: 'preference', view: 'breakdown' } },
        { kind: 'explain', model: 'preference' },
      ]),
    );
    const root = shadow(host);

    const rows = [...root.querySelectorAll('.genui-table tbody tr')].map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('候选 C');
    expect(rows[0]).toContain('66.7');
    expect(rows[1]).toContain('候选 B');
    expect(rows[1]).toContain('—');
    expect(root.textContent).toContain('权重合计');
    expect(root.textContent).toContain('缺失维度不按 0 计');
  });

  it('模型值不可用时显示明确原因，不显示 0', () => {
    const host = mount(
      v5(
        [budget({ income: C(0), expenses: [{ label: '支出', amount: C(10) }] })],
        [
          {
            kind: 'value',
            label: '支出占比',
            source: { kind: 'model', model: 'budget', key: 'usage' },
          },
        ],
      ),
    );
    const root = shadow(host);

    expect(root.textContent).toContain('无法计算：该模型值在当前数据下不可用');
    expect(root.querySelector('.genui-value-output')).toBeNull();
  });

  it('模型计算失败时错误可见且限制在该模型', () => {
    const broken = budget({
      id: 'broken',
      income: { op: 'divide', left: C(1), right: C(0) },
    });
    const host = mount(
      v5([broken, budget({ id: 'healthy' })], [
        { kind: 'table', source: { model: 'broken' } },
        { kind: 'explain', model: 'broken' },
        {
          kind: 'value',
          label: '健康余额',
          source: { kind: 'model', model: 'healthy', key: 'balance' },
        },
      ]),
    );
    const root = shadow(host);

    expect(root.querySelector('.genui-table-warning')?.textContent).toContain('除数不能为 0');
    expect(root.querySelector('.genui-explain-error')?.textContent).toContain('除数不能为 0');
    expect(root.querySelector('.genui-value-output')?.textContent).toContain('-100');
  });

  it('解释元素遵守 visibleIf 条件', () => {
    const model = budget();
    const host = mount(
      v5([model], [
        {
          kind: 'explain',
          model: 'budget',
          visibleIf: { op: 'num-gt', left: C(1), right: C(0) },
        },
      ]),
    );
    const root = shadow(host);
    expect(root.querySelector('.genui-explain')).not.toBeNull();

    mounted?.unmount();
    mounted = null;
    globalThis.document.body.replaceChildren();
  });
});
