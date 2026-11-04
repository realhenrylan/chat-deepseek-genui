import { describe, expect, it } from 'vitest';
import type { GenuiDocument, StateVariable } from '../../src/protocol/types';
import { buildContinueSummary, MAX_CONTINUE_SUMMARY_LENGTH } from '../../src/render/summarize';
import type {
  ContinueCandidate,
  ContinueTableSnapshot,
} from '../../src/render/summarize';

/**
 * 阶段 6：继续讨论摘要生成。
 *
 * 模型输出按不可信输入处理；摘要只汇总已声明的状态变量与派生结果，
 * 数值展示与卡片一致（formatNumber / 选项标签 / 单位），派生失败如实标注。
 */

const DOC: GenuiDocument = {
  type: 'genui',
  version: 2,
  title: '本地预算计算',
  state: [
    { id: 'budget', label: '总预算', kind: 'number', initial: 100, min: 0, max: 200, step: 10, unit: '元' },
    { id: 'spent', label: '已支出', kind: 'number', initial: 40, min: 0, max: 100, step: 10, unit: '元' },
    { id: 'category', label: '类别', kind: 'select', initial: 'food', options: [
      { label: '餐饮', value: 'food' }, { label: '交通', value: 'transport' },
    ] },
  ],
  derived: [{
    id: 'balance', label: '余额', unit: '元',
    expression: { op: 'subtract', left: { op: 'state', id: 'budget' }, right: { op: 'state', id: 'spent' } },
  }],
  elements: [],
};

const DOM_STATE = { budget: 100, spent: 40, category: 'transport' };

describe('buildContinueSummary', () => {
  it('包含标题、状态变量（含选择项标签与单位）与派生结果', () => {
    const summary = buildContinueSummary({
      title: DOC.title,
      state: DOC.state,
      derived: DOC.derived,
      stateValues: DOM_STATE,
      derivedValues: { balance: 60 },
      derivedErrors: {},
    });

    expect(summary).toContain('本地预算计算');
    expect(summary).toContain('总预算：100 元');
    expect(summary).toContain('已支出：40 元');
    expect(summary).toContain('类别：交通');
    expect(summary).toContain('余额：60 元');
    expect(summary).toContain('请基于以上当前条件与结果继续讨论');
  });

  it('无标题时使用兜底名称', () => {
    const summary = buildContinueSummary({
      state: DOC.state,
      derived: DOC.derived,
      stateValues: DOM_STATE,
      derivedValues: { balance: 60 },
      derivedErrors: {},
    });
    expect(summary).toContain('继续讨论当前界面');
  });

  it('派生计算失败时如实标注，不编造数值', () => {
    const summary = buildContinueSummary({
      title: DOC.title,
      state: DOC.state,
      derived: DOC.derived,
      stateValues: DOM_STATE,
      derivedValues: {},
      derivedErrors: { balance: '除数为零' },
    });
    expect(summary).toContain('余额：无法计算（除数为零）');
    expect(summary).not.toMatch(/余额：\d/);
  });

  it('派生值缺失也不编造', () => {
    const summary = buildContinueSummary({
      title: DOC.title,
      state: DOC.state,
      derived: DOC.derived,
      stateValues: DOM_STATE,
      derivedValues: {},
      derivedErrors: {},
    });
    expect(summary).toContain('余额：无法计算（暂无结果）');
  });

  it('v3 文档同样适用', () => {
    const doc: GenuiDocument = {
      type: 'genui',
      version: 3,
      title: '选购比较',
      state: [{ id: 'budget', label: '预算', kind: 'number', initial: 50, min: 0, max: 100, step: 1, unit: '元' }],
      derived: [],
      elements: [],
    };
    const summary = buildContinueSummary({
      title: doc.title,
      state: doc.state,
      derived: doc.derived,
      stateValues: { budget: 80 },
      derivedValues: {},
      derivedErrors: {},
    });
    expect(summary).toContain('选购比较');
    expect(summary).toContain('预算：80 元');
  });

  it('原型同名状态/派生 ID 只读取自有属性', () => {
    const doc: GenuiDocument = {
      type: 'genui',
      version: 2,
      title: '原型同名 ID',
      state: [
        {
          id: 'constructor',
          label: '数量',
          kind: 'number',
          initial: 42,
          min: 0,
          max: 100,
          step: 1,
        },
      ],
      derived: [{
        id: 'toString',
        label: '翻倍',
        expression: { op: 'add', left: { op: 'state', id: 'constructor' }, right: { op: 'state', id: 'constructor' } },
      }],
      elements: [],
    };
    const summary = buildContinueSummary({
      title: doc.title,
      state: doc.state,
      derived: doc.derived,
      stateValues: { constructor: 50 },
      derivedValues: { toString: 100 },
      derivedErrors: {},
    });
    expect(summary).toContain('数量：50');
    expect(summary).toContain('翻倍：100');
  });

  it('状态值缺失时如实标注未确认', () => {
    const summary = buildContinueSummary({
      title: DOC.title,
      state: DOC.state,
      derived: DOC.derived,
      stateValues: { budget: 100 },
      derivedValues: {},
      derivedErrors: { balance: '状态值缺失' },
    });
    expect(summary).toContain('已支出：（未确认）');
  });
});

const candidate = (label: string, rowKey: number, price: number, weight: number): ContinueCandidate => ({
  rowKey,
  label,
  cells: [
    { column: '方案', text: label },
    { column: '价格', text: `${price} 元`, numeric: price, unit: '元' },
    { column: '重量', text: `${weight} kg`, numeric: weight, unit: 'kg' },
  ],
});

function table(overrides: Partial<ContinueTableSnapshot> = {}): ContinueTableSnapshot {
  return {
    title: '候选方案',
    selectable: true,
    filter: 'A/C',
    sort: { label: '价格', dir: 'asc' },
    totalRows: 4,
    visibleRows: 2,
    selected: candidate('C', 2, 5200, 1.3),
    alternative: candidate('A', 0, 4800, 1.4),
    selectionHidden: false,
    selectionMissing: false,
    compareHidden: false,
    compareMissing: false,
    errors: [],
    ...overrides,
  };
}

describe('issue #5 · 摘要携带筛选/选中项与快照', () => {
  it('包含表格筛选、排序、显示行数与两个候选的主要差异', () => {
    const summary = buildContinueSummary({
      title: DOC.title,
      state: DOC.state,
      derived: DOC.derived,
      stateValues: DOM_STATE,
      tables: [table()],
    });
    expect(summary).toContain('表格「候选方案」：筛选「A/C」；按“价格”升序；显示 2 / 4 行。');
    expect(summary).toContain('- 已选：C — 价格 5200 元；重量 1.3 kg');
    expect(summary).toContain('- 对比：A — 价格 4800 元；重量 1.4 kg');
    expect(summary).toContain('主要差异：价格相差 400 元；重量相差 0.1 kg。');
  });

  it('未选择、被筛选隐藏与行已不存在都有确定文案', () => {
    const unselected = buildContinueSummary({
      tables: [table({ selected: null, alternative: null })],
    });
    expect(unselected).toContain('- 未选择候选项（2 个可选）');

    const hidden = buildContinueSummary({
      tables: [table({ selected: null, alternative: null, selectionHidden: true })],
    });
    expect(hidden).toContain('- 已选候选项被当前筛选隐藏。');

    const missing = buildContinueSummary({
      tables: [table({ selected: null, alternative: null, selectionMissing: true })],
    });
    expect(missing).toContain('- 已选候选项已不存在。');

    const empty = buildContinueSummary({
      tables: [table({ selected: null, alternative: null, visibleRows: 0, totalRows: 0 })],
    });
    expect(empty).toContain('- 没有候选项。');
  });

  it('未提交草稿与计算失败如实标注，不混入已生效结果', () => {
    const summary = buildContinueSummary({
      drafts: [{ label: '预算', raw: '6500', invalid: true }],
      tables: [
        table({
          errors: ['第 1 行显示条件无法计算：状态值缺失', '单元格表达式失败'],
        }),
      ],
    });
    expect(summary).toContain('- 预算：输入框中未提交「6500」，格式无效，尚未生效。');
    expect(summary).toContain('- 无法计算：第 1 行显示条件无法计算：状态值缺失；单元格表达式失败。');
  });

  it('缺失或无法计算的字段不参与比较，也不能被说成「相同」', () => {
    const selectedMissingPrice: ContinueCandidate = {
      rowKey: 2,
      label: 'C',
      cells: [
        { column: '方案', text: 'C' },
        { column: '价格', text: '—', missing: true },
        { column: '重量', text: '1.3 kg', numeric: 1.3, unit: 'kg' },
      ],
    };
    const alternativeMissingPrice: ContinueCandidate = {
      rowKey: 0,
      label: 'A',
      cells: [
        { column: '方案', text: 'A' },
        { column: '价格', text: '—', missing: true },
        { column: '重量', text: '1.4 kg', numeric: 1.4, unit: 'kg' },
      ],
    };
    const partial = buildContinueSummary({
      tables: [table({ selected: selectedMissingPrice, alternative: alternativeMissingPrice })],
    });
    expect(partial).toContain('主要差异：重量相差 0.1 kg');
    expect(partial).toContain('价格 缺失或无法计算，未参与比较');
    expect(partial).not.toContain('两项的数值与主要字段相同');

    const bothMissing = buildContinueSummary({
      tables: [
        table({
          selected: {
            ...selectedMissingPrice,
            cells: [
              { column: '方案', text: 'C' },
              { column: '价格', text: '—', missing: true },
              { column: '重量', text: '—', missing: true },
            ],
          },
          alternative: {
            ...alternativeMissingPrice,
            cells: [
              { column: '方案', text: 'A' },
              { column: '价格', text: '—', missing: true },
              { column: '重量', text: '—', missing: true },
            ],
          },
        }),
      ],
    });
    expect(bothMissing).toContain('主要差异：资料不足，无法可靠比较');
    expect(bothMissing).not.toContain('两项的数值与主要字段相同');
  });

  it('指定的对比项被隐藏或已不存在时如实说明', () => {
    const hidden = buildContinueSummary({
      tables: [table({ alternative: null, compareHidden: true })],
    });
    expect(hidden).toContain('- 指定的对比候选项被当前筛选隐藏。');

    const missing = buildContinueSummary({
      tables: [table({ alternative: null, compareMissing: true })],
    });
    expect(missing).toContain('- 指定的对比候选项已不存在。');
  });

  it('讨论意图的请求句替代默认结尾，不追加通用句', () => {
    const summary = buildContinueSummary({ request: '请比较以上两个候选方案的差异与取舍。' });
    expect(summary).toContain('请比较以上两个候选方案的差异与取舍。');
    expect(summary).not.toContain('请基于以上当前条件与结果继续讨论');
  });

  it('摘要总长有上限，超出时优先保留筛选、选中项与结尾请求', () => {
    const state: StateVariable[] = Array.from({ length: 30 }, (_, index) => ({
      id: `p${index}`,
      label: `第 ${index + 1} 项参数名称用于把摘要撑到超过上限的很长很长的补充说明文字`,
      kind: 'number',
      initial: 0,
      min: 0,
      max: 100,
      step: 1,
    }));
    const stateValues = Object.fromEntries(state.map((variable, index) => [variable.id, index]));
    const summary = buildContinueSummary({
      title: '长摘要',
      state,
      stateValues,
      tables: [
        table({
          filter: '在售',
          selected: candidate('C', 2, 5200, 1.3),
          alternative: candidate('A', 0, 4800, 1.4),
        }),
      ],
      request: '请比较以上两个候选方案的差异与取舍。',
    });
    expect(summary.length).toBeLessThanOrEqual(MAX_CONTINUE_SUMMARY_LENGTH);
    expect(summary).toContain('表格「候选方案」：筛选「在售」');
    expect(summary).toContain('- 已选：C — 价格 5200 元；重量 1.3 kg');
    expect(summary).toContain('请比较以上两个候选方案的差异与取舍。');
    expect(summary).toContain('部分参数与结果已省略');
  });

  it('最多展开 4 张表格，其余不挤占摘要', () => {
    const tables = [1, 2, 3, 4, 5].map((index) => table({ title: `表 ${index}` }));
    const summary = buildContinueSummary({ tables });
    expect(summary).toContain('表 4');
    expect(summary).not.toContain('表 5');
  });
});
