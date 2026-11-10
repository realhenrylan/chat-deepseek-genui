import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type {
  CardWidget,
  ChecklistWidget,
  CompareWidget,
  NoteWidget,
  QuizWidget,
  ResultWidget,
  SliderWidget,
  TimelineWidget,
  SpoilerWidget,
  PollWidget,
} from '../../src/protocol/widget/types';
import { QuizView } from '../../src/render/inline/views/QuizView';
import { CardView } from '../../src/render/inline/views/CardView';
import { CompareView } from '../../src/render/inline/views/CompareView';
import { ChecklistView } from '../../src/render/inline/views/ChecklistView';
import { SliderView } from '../../src/render/inline/views/SliderView';
import { ResultView } from '../../src/render/inline/views/ResultView';
import { NoteView } from '../../src/render/inline/views/NoteView';
import { TimelineView } from '../../src/render/inline/views/TimelineView';
import { SpoilerView } from '../../src/render/inline/views/SpoilerView';
import { PollView } from '../../src/render/inline/views/PollView';
import { mountInlineWidget } from '../../src/render/inline/mount';
import { enhanceDocument } from '../../src/content/enhance';

describe('内联小组件渲染与微交互 (w1 / M3 & M4)', () => {
  it('QuizView: 正确渲染题目与选项，点击答题展示反馈与解析，支持重新作答', () => {
    const quiz: QuizWidget = {
      w: 'quiz',
      question: '光合作用的主要场所是？',
      options: [
        { label: '线粒体', value: 'A' },
        { label: '叶绿体', value: 'B' },
        { label: '核糖体', value: 'C' },
      ],
      answer: 'B',
      explain: '植物细胞中的叶绿体含有叶绿素，是进行光合作用的主要细胞器。',
    };

    render(<QuizView widget={quiz} />);
    expect(screen.getByText('光合作用的主要场所是？')).toBeTruthy();
    expect(screen.getByText('叶绿体')).toBeTruthy();
    // 答题前不展示解析与重新作答
    expect(screen.queryByText(/植物细胞中的叶绿体/)).toBeNull();
    expect(screen.queryByText('重新作答')).toBeNull();

    // 点击错误选项 A
    const optionA = screen.getByText('线粒体').closest('button')!;
    fireEvent.click(optionA);

    // 选项 A 标记为错误，选项 B 标记为正确答案
    expect(optionA.className).toContain('incorrect');
    expect(screen.getByText('✕ 你的选择')).toBeTruthy();
    expect(screen.getByText('正确答案')).toBeTruthy();
    expect(screen.getByText(/植物细胞中的叶绿体/)).toBeTruthy();

    // 点击重新作答
    const retryBtn = screen.getByText('重新作答');
    fireEvent.click(retryBtn);
    expect(screen.queryByText('✕ 你的选择')).toBeNull();
    expect(screen.queryByText(/植物细胞中的叶绿体/)).toBeNull();

    // 重新作答点击正确选项 B
    const optionB = screen.getByText('叶绿体').closest('button')!;
    fireEvent.click(optionB);
    expect(optionB.className).toContain('correct');
    expect(screen.getByText('✓ 正确')).toBeTruthy();
  });

  it('ChecklistView: 渲染清单项目并支持交互勾选，动态统计完成进度', () => {
    const checklist: ChecklistWidget = {
      w: 'checklist',
      title: '上线准备清单',
      items: [
        { text: '完成单元测试', checked: true },
        { text: '代码审查通过', note: '至少 2 位负责人确认' },
        { text: '部署到生产环境' },
      ],
    };

    render(<ChecklistView widget={checklist} />);
    expect(screen.getByText('上线准备清单')).toBeTruthy();
    expect(screen.getByText('1 / 3 已完成')).toBeTruthy();
    expect(screen.getByText('至少 2 位负责人确认')).toBeTruthy();

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);

    // 勾选第二项
    fireEvent.click(checkboxes[1]);
    expect(checkboxes[1].checked).toBe(true);
    expect(screen.getByText('2 / 3 已完成')).toBeTruthy();
  });

  it('SliderView: 实时拖拽调节数值并更新展示', () => {
    const slider: SliderWidget = {
      w: 'slider',
      label: '预期年化收益率',
      min: 1,
      max: 15,
      step: 0.5,
      value: 5.5,
      unit: '%',
    };

    render(<SliderView widget={slider} />);
    expect(screen.getByText('预期年化收益率')).toBeTruthy();
    expect(screen.getByText('5.5')).toBeTruthy();
    expect(screen.getByText('%')).toBeTruthy();

    const input = screen.getByRole('slider') as HTMLInputElement;
    expect(input.value).toBe('5.5');

    fireEvent.change(input, { target: { value: '8.5' } });
    expect(screen.getByText('8.5')).toBeTruthy();
  });

  it('CompareView: 对比项渲染、高亮推荐项、优缺点与自定义字段', () => {
    const compare: CompareWidget = {
      w: 'compare',
      title: '框架对比',
      highlight: 'Vue 3',
      items: [
        {
          name: 'React 19',
          pros: ['生态极为庞大', '并发模式'],
          cons: ['心智模型较陡'],
          fields: { 体积: '42KB' },
        },
        {
          name: 'Vue 3',
          pros: ['上手极快', '响应式性能优异'],
          fields: { 体积: '33KB' },
        },
      ],
    };

    render(<CompareView widget={compare} />);
    expect(screen.getByText('框架对比')).toBeTruthy();
    expect(screen.getByText('React 19')).toBeTruthy();
    expect(screen.getByText('Vue 3')).toBeTruthy();
    expect(screen.getByText('推荐')).toBeTruthy();
    expect(screen.getByText('生态极为庞大')).toBeTruthy();
    expect(screen.getByText('心智模型较陡')).toBeTruthy();
    expect(screen.getByText('33KB')).toBeTruthy();
  });

  it('CardView, ResultView, NoteView 纯粹视图渲染', () => {
    const card: CardWidget = {
      w: 'card',
      title: 'HTTP 3.0',
      subtitle: '基于 QUIC 协议',
      tags: ['网络', '协议'],
      points: ['基于 UDP 实现可靠传输', '避免队头阻塞'],
    };
    const { unmount: unmountCard } = render(<CardView widget={card} />);
    expect(screen.getByText('HTTP 3.0')).toBeTruthy();
    expect(screen.getByText('基于 QUIC 协议')).toBeTruthy();
    expect(screen.getByText('网络')).toBeTruthy();
    expect(screen.getByText('基于 UDP 实现可靠传输')).toBeTruthy();
    unmountCard();

    const result: ResultWidget = {
      w: 'result',
      label: '总成本节约',
      value: 12800,
      unit: '元/年',
      emphasis: 'primary',
    };
    const { unmount: unmountResult } = render(<ResultView widget={result} />);
    expect(screen.getByText('总成本节约')).toBeTruthy();
    expect(screen.getByText('12800')).toBeTruthy();
    expect(screen.getByText('元/年')).toBeTruthy();
    unmountResult();

    const note: NoteWidget = {
      w: 'note',
      text: '注意：此项设置会在重启后失效。',
      tone: 'warn',
    };
    render(<NoteView widget={note} />);
    expect(screen.getByText('注意：此项设置会在重启后失效。')).toBeTruthy();
    expect(screen.getByText('⚠')).toBeTruthy();
  });

  it('mountInlineWidget: 在 Shadow DOM 中挂载，并支持源码切换与卸载', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onToggleRaw = vi.fn();
    const mounted = mountInlineWidget(host, {
      widget: {
        w: 'note',
        text: '测试 Shadow DOM 挂载',
      },
      rawJson: '{"w": "note", "text": "测试 Shadow DOM 挂载"}',
      onToggleRaw,
    });

    expect(host.shadowRoot).not.toBeNull();
    const shadow = host.shadowRoot!;
    expect(shadow.querySelector('.genui-inline-root')).not.toBeNull();
    expect(shadow.textContent).toContain('测试 Shadow DOM 挂载');

    // 切换源码
    const rawBtn = shadow.querySelector<HTMLButtonElement>('.inline-raw-btn');
    expect(rawBtn).not.toBeNull();
    rawBtn?.click();
    expect(onToggleRaw).toHaveBeenCalledWith(true);

    mounted.unmount();
    expect(shadow.querySelector('.genui-inline-root')).toBeNull();
    host.remove();
  });

  it('enhanceDocument: 自动识别 w1 块并挂载为内联组件', () => {
    const doc = document.implementation.createHTMLDocument('test');
    doc.body.innerHTML = `
      <div class="ds-assistant-message-main-content">
        <p>这是回答正文中的引导文字。</p>
        <div class="md-code-block" id="block-1">
          <div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>
          <pre><span>{"w": "quiz", "question": "测试内联问答", "options": [{"label": "A选项", "value": "A"}]}</span></pre>
        </div>
        <p>这是回答正文中的总结文字。</p>
      </div>
    `;

    const res = enhanceDocument(doc);
    expect(res.mounted).toBe(1);
    expect(res.failed).toBe(0);

    const block = doc.querySelector<HTMLElement>('#block-1')!;
    expect(block.getAttribute('data-genui-state')).toBe('mounted');
    expect(block.style.display).toBe('none');

    const host = doc.querySelector<HTMLElement>('.genui-card-host')!;
    expect(host).not.toBeNull();
    expect(host.shadowRoot?.querySelector('.genui-inline-root')).not.toBeNull();
    expect(host.shadowRoot?.textContent).toContain('测试内联问答');
  });

  it('跨组件状态共享 (M6): 同一消息内的 Slider 与 Result 自动通过总线联动更新', () => {
    document.body.innerHTML = `
      <div class="ds-assistant-message-main-content">
        <p>设定您的预期利率：</p>
        <div class="md-code-block" id="block-slider">
          <div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>
          <pre><span>{"w": "slider", "id": "rate", "label": "利率", "min": 1, "max": 10, "value": 3, "unit": "%"}</span></pre>
        </div>
        <p>对应计算的年化指标如下：</p>
        <div class="md-code-block" id="block-result">
          <div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>
          <pre><span>{"w": "result", "label": "当前年化", "bind": "rate", "value": 3, "unit": "%"}</span></pre>
        </div>
      </div>
    `;

    const res = enhanceDocument(document);
    expect(res.mounted).toBe(2);

    const hosts = document.querySelectorAll<HTMLElement>('.genui-card-host');
    expect(hosts).toHaveLength(2);

    const sliderHost = hosts[0];
    const resultHost = hosts[1];

    // 初始状态下 ResultView 显示 3
    expect(resultHost.shadowRoot?.textContent).toContain('3');

    // 拖动 SliderView 滑块至 7
    const rangeInput = sliderHost.shadowRoot!.querySelector<HTMLInputElement>('input[type="range"]');
    expect(rangeInput).not.toBeNull();
    fireEvent.change(rangeInput!, { target: { value: '7' } });

    // ResultView 自动被 bus 驱动更新为 7
    expect(resultHost.shadowRoot?.textContent).toContain('7');
  });
});

describe('作答一键回流与三种新内联组件', () => {
  it('ChecklistView: 勾选后把未完成任务写成回流模板并显示带入状态', () => {
    const checklist: ChecklistWidget = {
      w: 'checklist',
      title: '上线准备清单',
      items: [
        { text: '完成单元测试', checked: true },
        { text: '代码审查通过' },
        { text: '部署到生产环境' },
      ],
    };
    const onContinue = vi.fn(() => 'filled' as const);

    render(<ChecklistView widget={checklist} onContinue={onContinue} />);
    // 初始仅 1/3 完成，回流栏已经出现。
    const feedbackButton = screen.getByText('📋 将未完成任务带入下一步规划');
    expect(feedbackButton).toBeTruthy();
    expect(screen.queryByText('✓ 已带入输入框')).toBeNull();

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(feedbackButton);

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith(
      [
        '【任务跟进】',
        '已完成（2/3）：1. 完成单元测试、2. 代码审查通过',
        '待完成（1/3）：1. 部署到生产环境',
        '请帮我针对以上未完成的步骤，制定详细的执行步骤与注意事项。',
      ].join('\n'),
    );
    expect(screen.getByText('✓ 已带入输入框')).toBeTruthy();

    // 再次勾选会清空旧的状态文字。
    fireEvent.click(screen.getAllByRole('checkbox')[2]);
    expect(screen.queryByText('✓ 已带入输入框')).toBeNull();
    expect(screen.getByText('📋 将已完成清单带入下一步规划')).toBeTruthy();
  });

  it('ChecklistView: 全部完成时改用下一阶段规划模板，并反馈输入框缺失', () => {
    const checklist: ChecklistWidget = {
      w: 'checklist',
      items: [
        { text: '写方案', checked: true },
        { text: '评审', checked: true },
      ],
    };
    const onContinue = vi.fn(() => 'no-input' as const);

    const { container } = render(<ChecklistView widget={checklist} onContinue={onContinue} />);
    const feedbackButton = container.querySelector<HTMLButtonElement>('.inline-feedback-btn')!;
    expect(feedbackButton.textContent).toBe('📋 将已完成清单带入下一步规划');
    fireEvent.click(feedbackButton);

    expect(onContinue).toHaveBeenCalledWith(
      [
        '【任务跟进】',
        '已完成（2/2）：1. 写方案、2. 评审',
        '以上任务已全部完成，请帮我规划下一阶段的推进重点与验收事项。',
      ].join('\n'),
    );
    expect(screen.getByText('未找到聊天输入框')).toBeTruthy();
  });

  it('CompareView: 点击采用方案写入选型模板，且反馈只出现在所选方案', () => {
    const compare: CompareWidget = {
      w: 'compare',
      items: [
        { name: '方案 A' },
        { name: '方案 B' },
      ],
    };
    const onContinue = vi.fn(() => 'appended' as const);

    render(<CompareView widget={compare} onContinue={onContinue} />);
    const buttons = screen.getAllByText('👉 采用此方案继续细化');
    expect(buttons).toHaveLength(2);
    expect(screen.queryByText('✓ 已带入输入框')).toBeNull();

    fireEvent.click(buttons[1]);

    expect(onContinue).toHaveBeenCalledWith(
      [
        '【方案选型确认】',
        '在对比方案中，我决定采用【方案 B】。请帮我细化该方案的落地架构图与第一阶段实施计划。',
      ].join('\n'),
    );
    expect(screen.getAllByText('✓ 已带入输入框')).toHaveLength(1);
    expect(buttons[1].className).toContain('selected');
    expect(buttons[0].className).not.toContain('selected');
  });

  it('TimelineView: 渲染时间、标题、描述与高亮节点', () => {
    const timeline: TimelineWidget = {
      w: 'timeline',
      title: '故障时间线',
      items: [
        { time: '09:02', title: '监控告警', desc: '错误率突增', highlight: true },
        { time: '09:15', title: '定位到连接池' },
      ],
    };

    const { container } = render(<TimelineView widget={timeline} />);
    expect(screen.getByText('故障时间线')).toBeTruthy();
    expect(screen.getByText('09:02')).toBeTruthy();
    expect(screen.getByText('定位到连接池')).toBeTruthy();

    const items = container.querySelectorAll('.inline-timeline-item');
    expect(items).toHaveLength(2);
    expect(items[0].className).toContain('highlighted');
    expect(items[1].className).not.toContain('highlighted');
    expect(items[0].querySelector('.inline-timeline-desc')?.textContent).toBe('错误率突增');
  });

  it('SpoilerView: 默认收起，展开与收起切换内容与 aria 状态', () => {
    const spoiler: SpoilerWidget = {
      w: 'spoiler',
      summary: '为什么这里用二分？',
      hint: '先看单调性',
      content: '因为区间单调，可以二分。',
    };

    render(<SpoilerView widget={spoiler} />);
    expect(screen.getByText('为什么这里用二分？')).toBeTruthy();
    expect(screen.getByText('先看单调性')).toBeTruthy();
    expect(screen.queryByText('因为区间单调，可以二分。')).toBeNull();

    const toggle = screen.getByRole('button', { name: '展开思考与解析' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);

    expect(screen.getByText('因为区间单调，可以二分。')).toBeTruthy();
    const collapse = screen.getByRole('button', { name: '收起思考与解析' });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(collapse);
    expect(screen.queryByText('因为区间单调，可以二分。')).toBeNull();
  });

  it('PollView: 投票后展示百分比与选中标记，重新投票可复位', () => {
    const poll: PollWidget = {
      w: 'poll',
      question: '你更倾向哪种方案？',
      options: [
        { id: 'a', label: '方案 A', ratio: 60 },
        { id: 'b', label: '方案 B', ratio: 40 },
      ],
    };

    const { container } = render(<PollView widget={poll} />);
    const options = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.inline-poll-option'));
    expect(screen.getByText('你更倾向哪种方案？')).toBeTruthy();
    expect(container.querySelector('.inline-poll-bar')).toBeNull();
    expect(container.querySelector('.inline-poll-reset')).toBeNull();

    fireEvent.click(options()[0]);

    expect(options()[0].textContent).toContain('60%');
    expect(options()[1].textContent).toContain('40%');
    expect(options()[0].textContent).toContain('✓ 方案 A');
    expect(options()[0].classList.contains('selected')).toBe(true);

    fireEvent.click(container.querySelector<HTMLButtonElement>('.inline-poll-reset')!);
    expect(container.querySelector('.inline-poll-bar')).toBeNull();
    expect(container.querySelector('.inline-poll-reset')).toBeNull();
    expect(options()[0].textContent).toBe('方案 A');
  });

  it('enhanceDocument: 内联组件回流接线到 onContinue', () => {
    const doc = document.implementation.createHTMLDocument('test');
    doc.body.innerHTML = `
      <div class="ds-assistant-message-main-content">
        <div class="md-code-block" id="block-checklist">
          <div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>
          <pre><span>{"w": "checklist", "items": ["完成单元测试", "部署到生产环境"]}</span></pre>
        </div>
      </div>
    `;
    const onContinue = vi.fn<(summary: string) => 'filled'>(() => 'filled');

    const res = enhanceDocument(doc, { onContinue });
    expect(res.mounted).toBe(1);

    const host = doc.querySelector<HTMLElement>('.genui-card-host')!;
    const shadow = host.shadowRoot!;
    expect(shadow.textContent).toContain('完成单元测试');

    // 该文档由 createHTMLDocument 创建，没有 defaultView，fireEvent 无法定位 window；
    // 原生 click() 直接在该文档内派发事件，React 的合成事件仍会冒泡到 root 容器。
    shadow.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    const feedbackButton = shadow.querySelector<HTMLButtonElement>('.inline-feedback-btn')!;
    expect(feedbackButton.textContent).toContain('将未完成任务带入下一步规划');
    feedbackButton.click();

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue.mock.calls[0][0]).toContain('【任务跟进】');
    expect(onContinue.mock.calls[0][0]).toContain('待完成（1/2）：1. 部署到生产环境');
  });
});
