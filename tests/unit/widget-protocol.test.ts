import { describe, expect, it } from 'vitest';
import { parseGenui } from '../../src/protocol/validate.ts';
import type {
  SliderWidget,
  QuizWidget,
  CompareWidget,
  ChecklistWidget,
  TimelineWidget,
  SpoilerWidget,
  PollWidget,
} from '../../src/protocol/widget/types.ts';

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

describe('timeline 时间线组件', () => {
  it('解析标准结构并保留节点描述与高亮', () => {
    const raw = JSON.stringify({
      w: 'timeline',
      title: '一次线上故障的时间线',
      items: [
        { time: '09:02', title: '监控告警', desc: '错误率突增', highlight: true },
        { time: '09:15', title: '定位到连接池', desc: '连接数耗尽' },
      ],
    });

    const res = parseGenui(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const timeline = res.widget as TimelineWidget;
      expect(timeline.w).toBe('timeline');
      expect(timeline.title).toBe('一次线上故障的时间线');
      expect(timeline.items).toHaveLength(2);
      expect(timeline.items[0]).toEqual({
        time: '09:02',
        title: '监控告警',
        desc: '错误率突增',
        highlight: true,
      });
      expect(timeline.items[1].highlight).toBeUndefined();
    }
  });

  it('缺 time 自动推导 Step 序号，字符串节点直接作为标题', () => {
    const raw = JSON.stringify({
      w: 'timeline',
      items: [
        '需求评审',
        { title: '方案设计', description: '输出架构图' },
        { step: '', name: '上线验收' },
      ],
    });

    const res = parseGenui(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const timeline = res.widget as TimelineWidget;
      expect(timeline.items[0]).toEqual({ time: 'Step 1', title: '需求评审' });
      expect(timeline.items[1]).toMatchObject({
        time: 'Step 2',
        title: '方案设计',
        desc: '输出架构图',
      });
      expect(timeline.items[2]).toMatchObject({ time: 'Step 3', title: '上线验收' });
    }
  });

  it('空数组按 schema-violation 拒绝', () => {
    const res = parseGenui(JSON.stringify({ w: 'timeline', items: [] }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('schema-violation');
      expect(res.detail).toContain('至少需要 1 个节点');
    }
  });
});

describe('spoiler 折叠思考块组件', () => {
  it('解析标准结构', () => {
    const raw = JSON.stringify({
      w: 'spoiler',
      summary: '为什么这里要用二分？',
      hint: '先看单调性',
      content: '因为答案区间单调，二分可以把复杂度降到 O(log n)。',
    });

    const res = parseGenui(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const spoiler = res.widget as SpoilerWidget;
      expect(spoiler.w).toBe('spoiler');
      expect(spoiler.summary).toBe('为什么这里要用二分？');
      expect(spoiler.hint).toBe('先看单调性');
      expect(spoiler.content).toContain('O(log n)');
    }
  });

  it('只有 text 时作为 content，且 summary 使用默认文案', () => {
    const res = parseGenui(JSON.stringify({ w: 'spoiler', text: '推导细节' }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      const spoiler = res.widget as SpoilerWidget;
      expect(spoiler.content).toBe('推导细节');
      expect(spoiler.summary).toBe('点击查看推导细节');
      expect(spoiler.hint).toBeUndefined();
    }
  });

  it('缺少内容按 schema-violation 拒绝', () => {
    const res = parseGenui(JSON.stringify({ w: 'spoiler', summary: '只有标题' }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('schema-violation');
      expect(res.detail).toContain('缺少 content');
    }
  });
});

describe('poll 倾向投票组件', () => {
  it('解析标准结构并保留百分比', () => {
    const raw = JSON.stringify({
      w: 'poll',
      question: '你更倾向哪种方案？',
      options: [
        { id: 'a', label: '方案 A', ratio: 60 },
        { id: 'b', label: '方案 B', ratio: 40 },
      ],
    });

    const res = parseGenui(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const poll = res.widget as PollWidget;
      expect(poll.w).toBe('poll');
      expect(poll.question).toBe('你更倾向哪种方案？');
      expect(poll.options).toEqual([
        { id: 'a', label: '方案 A', ratio: 60 },
        { id: 'b', label: '方案 B', ratio: 40 },
      ]);
    }
  });

  it('缺 ratio 时自动均分且总和恰为 100', () => {
    const res = parseGenui(JSON.stringify({
      w: 'poll',
      question: '三选一',
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
    }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      const poll = res.widget as PollWidget;
      expect(poll.options.map((opt) => opt.id)).toEqual(['opt_1', 'opt_2', 'opt_3']);
      expect(poll.options.map((opt) => opt.ratio)).toEqual([34, 33, 33]);
      expect(poll.options.reduce((acc, opt) => acc + opt.ratio, 0)).toBe(100);
    }
  });

  it('纯字符串选项宽容为 id/label 并均分百分比', () => {
    const res = parseGenui(JSON.stringify({
      w: 'poll',
      question: '二选一',
      options: ['保持现状', '立即重构'],
    }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      const poll = res.widget as PollWidget;
      expect(poll.options).toEqual([
        { id: 'opt_1', label: '保持现状', ratio: 50 },
        { id: 'opt_2', label: '立即重构', ratio: 50 },
      ]);
    }
  });

  it('缺少问题或选项按 schema-violation 拒绝', () => {
    const noQuestion = parseGenui(JSON.stringify({ w: 'poll', options: ['A'] }));
    expect(noQuestion.ok).toBe(false);
    if (!noQuestion.ok) expect(noQuestion.detail).toContain('缺少 question');

    const noOptions = parseGenui(JSON.stringify({ w: 'poll', question: '选？', options: [] }));
    expect(noOptions.ok).toBe(false);
    if (!noOptions.ok) expect(noOptions.detail).toContain('至少需要 1 个选项');
  });
});
