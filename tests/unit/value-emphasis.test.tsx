import { afterEach, describe, expect, it } from 'vitest';
import type {
  BudgetModel,
  ComposableValueElement,
  GenuiDocument,
  GenuiV3Document,
  GenuiV4Document,
  GenuiV5Document,
  NumericExpression,
} from '../../src/protocol/types';
import { parseGenui } from '../../src/protocol/validate';
import { mountCard, type MountedCard } from '../../src/render/mount';

/**
 * issue #12：value.emphasis 只表达展示优先级。
 *
 * 协议层确认 v3–v5 接受可选 emphasis、v1/v2 仍关闭字段集合；渲染层确认
 * 文档顺序中前两个显式 primary 获得强调，其余（含显式 normal）保持普通，
 * 求值结果、完整可访问文本、单位与错误呈现不因强调改变。
 */

const C = (value: number): NumericExpression => ({ op: 'const', value });

const SCORE_STATE = {
  id: 'score',
  label: '总分',
  kind: 'number' as const,
  initial: 10,
  min: 0,
  max: 100,
  step: 1,
  unit: '分',
};

function v3(elements: GenuiV3Document['elements']): GenuiV3Document {
  return {
    type: 'genui',
    version: 3,
    title: '强调测试',
    state: [SCORE_STATE],
    derived: [],
    elements,
  };
}

function v5(
  models: GenuiV5Document['models'],
  elements: GenuiV5Document['elements'],
): GenuiV5Document {
  return {
    type: 'genui',
    version: 5,
    title: '强调测试',
    state: [],
    derived: [],
    models,
    elements,
  };
}

function budget(): BudgetModel {
  return {
    kind: 'budget',
    id: 'budget',
    label: '月度预算',
    unit: '元',
    precision: 0,
    income: C(1000),
    expenses: [{ label: '房租', amount: C(400) }],
  };
}

let mounted: MountedCard | null = null;

/** 等待 React 把点击触发的状态更新刷入 DOM。 */
function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(doc: GenuiDocument): HTMLElement {
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

describe('value.emphasis 协议边界', () => {
  it('v3/v4/v5 接受 normal 与 primary，缺省字段仍有效', () => {
    const value: ComposableValueElement = {
      kind: 'value',
      label: '结果',
      source: { kind: 'state', id: 'score' },
    };
    const v3doc = v3([value, { ...value, emphasis: 'normal' }, { ...value, emphasis: 'primary' }]);
    const v4doc: GenuiV4Document = { ...v3doc, version: 4 };
    // v5 的 models 至少一项；这里用预算模型只为满足协议要求。
    const v5doc = v5([budget()], [value, { ...value, emphasis: 'primary' }]);
    v5doc.state = [SCORE_STATE];

    for (const [version, doc] of [['v3', v3doc], ['v4', v4doc], ['v5', v5doc]] as const) {
      const result = parseGenui(JSON.stringify(doc));
      expect(result.ok, `${version}: ${result.ok ? '' : result.detail}`).toBe(true);
    }
  });

  it('v5 模型值也接受 emphasis', () => {
    const doc = v5(
      [budget()],
      [
        {
          kind: 'value',
          label: '余额',
          source: { kind: 'model', model: 'budget', key: 'balance' },
          emphasis: 'primary',
        },
      ],
    );
    const result = parseGenui(JSON.stringify(doc));
    expect(result.ok, result.ok ? '' : result.detail).toBe(true);
  });

  it('拒绝未知的 emphasis 枚举值', () => {
    const bad = v3([
      {
        kind: 'value',
        label: '结果',
        source: { kind: 'state', id: 'score' },
        emphasis: 'highlight',
      } as unknown as GenuiV3Document['elements'][number],
    ]);
    const result = parseGenui(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('schema-violation');
  });

  it('v1/v2 不接受新增的 emphasis 字段', () => {
    const v2 = {
      type: 'genui',
      version: 2,
      state: [SCORE_STATE],
      derived: [],
      elements: [
        {
          kind: 'value',
          label: '结果',
          source: { kind: 'state', id: 'score' },
          emphasis: 'primary',
        },
      ],
    };
    const v1 = {
      type: 'genui',
      version: 1,
      elements: [{ kind: 'text', value: '说明', emphasis: 'primary' }],
    };

    for (const doc of [v2, v1]) {
      const result = parseGenui(JSON.stringify(doc));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('schema-violation');
    }
  });
});

describe('value.emphasis 渲染', () => {
  it('只强调文档顺序中的前两个显式 primary，显式 normal 与多余 primary 保持普通', () => {
    const host = mount(
      v3([
        {
          kind: 'section',
          title: '分组',
          children: [
            {
              kind: 'columns',
              columns: [
                [
                  {
                    kind: 'value',
                    label: '主要 A',
                    source: { kind: 'state', id: 'score' },
                    emphasis: 'primary',
                  },
                  {
                    kind: 'value',
                    label: '普通 B',
                    source: { kind: 'state', id: 'score' },
                    emphasis: 'normal',
                  },
                ],
                [
                  {
                    kind: 'value',
                    label: '主要 C',
                    source: { kind: 'state', id: 'score' },
                    emphasis: 'primary',
                  },
                  {
                    kind: 'value',
                    label: '主要 D',
                    source: { kind: 'state', id: 'score' },
                    emphasis: 'primary',
                  },
                ],
              ],
            },
          ],
        },
      ]),
    );
    const root = shadow(host);
    const values = [...root.querySelectorAll<HTMLElement>('.genui-value')];
    expect(values).toHaveLength(4);

    const labels = values.map((value) => value.querySelector('.genui-value-label')?.textContent);
    expect(labels).toEqual(['主要 A', '普通 B', '主要 C', '主要 D']);
    expect(values.map((value) => value.dataset.emphasis)).toEqual([
      'primary',
      undefined,
      'primary',
      undefined,
    ]);
    expect(root.querySelectorAll('.genui-value-primary')).toHaveLength(2);

    // A 是 primary，B 是 normal；同一来源的数值与单位排版完全一致。
    const first = values[0].querySelector('.genui-value-output');
    const second = values[1].querySelector('.genui-value-output');
    expect(first?.textContent).toBe('10 分');
    expect(second?.textContent).toBe('10 分');
    expect(first?.getAttribute('aria-label')).toBe('主要 A：10 分');
    expect(first?.querySelector('.genui-value-number')?.textContent).toBe('10');
    expect(first?.querySelector('.genui-value-unit')?.textContent).toBe(' 分');
  });

  it('0 个 primary 不强调，1 个与 2 个 primary 时全部获得强调', () => {
    for (const count of [0, 1, 2]) {
      mounted?.unmount();
      mounted = null;
      globalThis.document.body.replaceChildren();
      const host = mount(
        v3(
          Array.from({ length: 3 }, (_, index) => ({
            kind: 'value' as const,
            label: `结果 ${index + 1}`,
            source: { kind: 'state' as const, id: 'score' },
            ...(index < count ? { emphasis: 'primary' as const } : {}),
          })),
        ),
      );
      expect(shadow(host).querySelectorAll('.genui-value-primary')).toHaveLength(count);
    }
  });

  it('负值、小数、长标签和单位仍保留完整文本与可访问名称', () => {
    const doc = v3([
      {
        kind: 'value',
        label: '扣除税费后的可支配余额',
        source: { kind: 'state', id: 'score' },
        emphasis: 'primary',
      },
    ]);
    doc.state = [
      {
        ...SCORE_STATE,
        initial: -1234.5,
        min: -10000,
        max: 10000,
        step: 0.1,
        unit: '元',
      },
    ];
    const host = mount(doc);
    const root = shadow(host);
    const output = root.querySelector('.genui-value-output');
    const label = '扣除税费后的可支配余额';

    expect(output?.textContent).toBe('-1234.5 元');
    expect(output?.getAttribute('aria-label')).toBe(`${label}：-1234.5 元`);
    expect(root.textContent).toContain(label);
    expect(root.querySelector('.genui-value-primary')).not.toBeNull();
  });

  it('大数不截断，也不因强调改变原始数值', () => {
    const doc = v3([
      {
        kind: 'value',
        label: '年度总预算',
        source: { kind: 'state', id: 'score' },
        emphasis: 'primary',
      },
    ]);
    doc.state = [
      {
        ...SCORE_STATE,
        initial: 999_999_999_999,
        min: 0,
        max: 1_000_000_000_000,
        step: 1,
        unit: '元',
      },
    ];
    const root = shadow(mount(doc));
    expect(root.querySelector('.genui-value-output')?.textContent).toBe('999999999999 元');
  });

  it('求值失败时在结果位置显示错误，而不是把主结果写成 0', () => {
    const doc = v3([
      {
        kind: 'value',
        label: '除零结果',
        source: { kind: 'derived', id: 'broken' },
        emphasis: 'primary',
      },
    ]);
    doc.derived = [{
      id: 'broken',
      label: '坏值',
      expression: { op: 'divide', left: C(1), right: C(0) },
    }];
    // 直接挂载已经过校验的文档；这里只验证渲染层对求值错误的表现。
    const host = mount(doc);
    const root = shadow(host);
    expect(root.querySelector('.genui-value-primary')).not.toBeNull();
    expect(root.querySelector('.genui-runtime-error')?.textContent).toContain('无法计算');
    expect(root.querySelector('.genui-value-output')).toBeNull();
    expect(root.textContent).not.toContain('除零结果0');
  });

  it('强调不改变求值结果或计算依据内容', () => {
    const primaryDoc = v5(
      [budget()],
      [
        {
          kind: 'value',
          label: '月结余',
          source: { kind: 'model', model: 'budget', key: 'balance' },
          unit: '元',
          emphasis: 'primary',
        },
        { kind: 'explain', model: 'budget' },
      ],
    );
    const primaryRoot = shadow(mount(primaryDoc));
    const primaryValue = primaryRoot.querySelector('.genui-value-output')?.textContent;
    const primaryExplain = primaryRoot.querySelector('.genui-explain')?.textContent;

    mounted?.unmount();
    mounted = null;
    globalThis.document.body.replaceChildren();

    const plainRoot = shadow(
      mount(
        v5(
          [budget()],
          [
            {
              kind: 'value',
              label: '月结余',
              source: { kind: 'model', model: 'budget', key: 'balance' },
              unit: '元',
            },
            { kind: 'explain', model: 'budget' },
          ],
        ),
      ),
    );

    expect(primaryValue).toBe(plainRoot.querySelector('.genui-value-output')?.textContent);
    expect(primaryExplain).toBe(plainRoot.querySelector('.genui-explain')?.textContent);
    expect(plainRoot.querySelector('.genui-value-primary')).toBeNull();
  });

  it('最长单位与无空格长标签仍保留完整文本和可访问名称', () => {
    const longLabel = '长'.repeat(120);
    const longUnit = '这是一个正好二十个字符的超长计量单位名称';
    expect(longUnit).toHaveLength(20);
    const doc = v3([
      {
        kind: 'value',
        label: longLabel,
        source: { kind: 'state', id: 'score' },
        emphasis: 'primary',
      },
    ]);
    doc.state = [
      {
        ...SCORE_STATE,
        initial: -1234.5,
        min: -10000,
        max: 10000,
        step: 0.1,
        unit: longUnit,
      },
    ];
    const root = shadow(mount(doc));
    const output = root.querySelector('.genui-value-output');
    const label = root.querySelector('.genui-value-label');

    expect(label?.textContent).toBe(longLabel);
    expect(output?.textContent).toBe(`-1234.5 ${longUnit}`);
    expect(output?.getAttribute('aria-label')).toBe(`${longLabel}：-1234.5 ${longUnit}`);
    expect(output?.querySelector('.genui-value-unit')?.textContent).toBe(` ${longUnit}`);
    expect(root.querySelector('.genui-value-primary')).not.toBeNull();
  });

  it('有无 emphasis 时“继续讨论”摘要内容完全一致', async () => {
    function interactive(emphasis?: 'primary'): GenuiV3Document {
      return v3([
        {
          kind: 'value',
          label: '总分',
          source: { kind: 'state', id: 'score' },
          ...(emphasis ? { emphasis } : {}),
        },
      ]);
    }
    async function summary(host: HTMLElement): Promise<string> {
      await flushUi();
      const root = shadow(host);
      root.querySelector<HTMLButtonElement>('.genui-card-followup')?.click();
      await flushUi();
      return root.querySelector<HTMLTextAreaElement>('.genui-followup-text')?.value ?? '';
    }

    const primarySummary = await summary(mount(interactive('primary')));
    expect(primarySummary).toContain('总分');
    mounted?.unmount();
    mounted = null;
    globalThis.document.body.replaceChildren();

    const plainSummary = await summary(mount(interactive()));
    expect(primarySummary).toBe(plainSummary);
  });

  it('v5 模型值强调读取同一份模型快照，不改变数值', () => {
    const host = mount(
      v5(
        [budget()],
        [
          {
            kind: 'value',
            label: '月结余',
            source: { kind: 'model', model: 'budget', key: 'balance' },
            unit: '元',
            emphasis: 'primary',
          },
        ],
      ),
    );
    const root = shadow(host);
    const output = root.querySelector('.genui-value-output');

    expect(output?.textContent).toBe('600 元');
    expect(output?.getAttribute('aria-label')).toBe('月结余：600 元');
    expect(root.querySelector('.genui-value-primary')).not.toBeNull();
  });
});
