import { describe, expect, it } from 'vitest';
import type { GenuiDocument } from '../../src/protocol/types';
import { buildContinueSummary } from '../../src/render/summarize';

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
