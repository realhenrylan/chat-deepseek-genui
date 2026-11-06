import { describe, expect, it } from 'vitest';
import { parseGenui } from '../../src/protocol/validate.ts';
import type { SliderWidget, QuizWidget, CompareWidget, ChecklistWidget } from '../../src/protocol/widget/types.ts';

describe('w1 内联组件协议与宽容解析套件 (M2)', () => {
  it('正确分流并解析标准 slider 组件', () => {
    const raw = JSON.stringify({
      w: 'slider',
      id: 'rate',
      label: '年化利率',
      min: 0,
      max: 10,
      step: 0.5,
      value: 3.5,
      unit: '%',
    });

    const res = parseGenui(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.widget).toBeDefined();
      expect(res.document).toBeDefined(); // 具有自动向后兼容封装
      const slider = res.widget as SliderWidget;
      expect(slider.w).toBe('slider');
      expect(slider.label).toBe('年化利率');
      expect(slider.value).toBe(3.5);
      expect(slider.step).toBe(0.5);
      expect(slider.unit).toBe('%');
    }
  });

  it('slider 宽容层：字符串数值自动转型、步长自动吸附与未知字段容忍', () => {
    const raw = JSON.stringify({
      w: 'slider',
      id: 'loanTerm',
      min: '10',
      max: '30',
      step: '5',
      value: '22', // 22 不符合步长 5，应自动吸附到 20
      unknownProperty: 'ignored',
    });

    const res = parseGenui(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const slider = res.widget as SliderWidget;
      expect(slider.min).toBe(10);
      expect(slider.max).toBe(30);
      expect(slider.step).toBe(5);
      expect(slider.value).toBe(20);
    }
  });

  it('正确解析 result 组件', () => {
    const raw = JSON.stringify({
      w: 'result',
      label: '月供金额',
      value: 4892.5,
      unit: '元',
      emphasis: 'primary',
    });

    const res = parseGenui(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.widget?.w).toBe('result');
      expect(res.widget?.['value']).toBe(4892.5);
      expect(res.widget?.['emphasis']).toBe('primary');
    }
  });

  it('正确解析 note 组件', () => {
    const raw = JSON.stringify({
      w: 'note',
      text: '时间是复利里最关键的变量。',
      tone: 'warn',
    });

    const res = parseGenui(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.widget?.w).toBe('note');
      expect(res.widget?.['text']).toBe('时间是复利里最关键的变量。');
      expect(res.widget?.['tone']).toBe('warn');
    }
  });

  it('正确解析 quiz 选择题组件（支持纯字符串数组选项宽容）', () => {
    const raw = JSON.stringify({
      w: 'quiz',
      id: 'q1',
      question: '72法则中，年利率为 6% 时本金翻倍约需要多少年？',
      options: ['6 年', '12 年', '18 年', '24 年'],
      answer: 'B',
      explain: '72 / 6 = 12 年。',
    });

    const res = parseGenui(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const quiz = res.widget as QuizWidget;
      expect(quiz.w).toBe('quiz');
      expect(quiz.question).toContain('72法则');
      expect(quiz.options.length).toBe(4);
      expect(quiz.options[1]).toEqual({ label: '12 年', value: 'B' });
      expect(quiz.answer).toBe('B');
      expect(quiz.explain).toBe('72 / 6 = 12 年。');
    }
  });

  it('正确解析 card 概念信息卡组件', () => {
    const raw = JSON.stringify({
      w: 'card',
      title: '复利效应 (Compound Interest)',
      subtitle: '爱因斯坦称为世界第八大奇迹',
      points: [
        '利滚利：产生的利息在下一期自动转化为本金继续产生利息',
        '指数增长：前期变化平缓，后期曲线加速陡峭',
      ],
      tags: ['财富增长', '长期思维'],
    });

    const res = parseGenui(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.widget?.w).toBe('card');
      expect(res.widget?.['title']).toBe('复利效应 (Compound Interest)');
      expect(res.widget?.['points']).toHaveLength(2);
      expect(res.widget?.['tags']).toEqual(['财富增长', '长期思维']);
    }
  });

  it('正确解析 compare 对比卡组件', () => {
    const raw = JSON.stringify({
      w: 'compare',
      title: '房贷还款方式对比',
      highlight: '等额本金',
      items: [
        {
          name: '等额本息',
          pros: ['每月还款金额完全固定', '前期还款压力较小'],
          cons: ['总支付利息明显更多'],
          fields: { '前期月供': '5200元', '总利息': '87万元' },
        },
        {
          name: '等额本金',
          pros: ['总利息支出最少', '本金递减更快'],
          cons: ['前期月供较高'],
          fields: { '前期月供': '6800元', '总利息': '69万元' },
        },
      ],
    });

    const res = parseGenui(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const compare = res.widget as CompareWidget;
      expect(compare.w).toBe('compare');
      expect(compare.items).toHaveLength(2);
      expect(compare.items[0].name).toBe('等额本息');
      expect(compare.highlight).toBe('等额本金');
    }
  });

  it('正确解析 checklist 清单与步骤组件', () => {
    const raw = JSON.stringify({
      w: 'checklist',
      title: '前端环境初始化四步',
      items: [
        '安装 Node.js LTS 版本并配置镜像',
        { text: '安装 Git 并设置全局用户名与邮箱', note: 'git config --global user.name ...' },
        '安装 VS Code 并安装 ESLint 插件',
      ],
    });

    const res = parseGenui(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const checklist = res.widget as ChecklistWidget;
      expect(checklist.w).toBe('checklist');
      expect(checklist.items).toHaveLength(3);
      expect(checklist.items[0].text).toBe('安装 Node.js LTS 版本并配置镜像');
      expect(checklist.items[1].note).toContain('git config');
    }
  });

  it('未知组件拒绝并给出明确失败原因', () => {
    const raw = JSON.stringify({
      w: 'unknown-widget-type',
      foo: 'bar',
    });

    const res = parseGenui(raw);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('schema-violation');
      expect(res.detail).toContain('未知的内联组件类型');
    }
  });
});
