import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  FormWidget,
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
import { FormView } from '../../src/render/inline/views/FormView';
import type { FollowupEnvironmentState, FollowupEnvironmentStore } from '../../src/render/inline/feedback';
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

  it('mountInlineWidget: 在 Shadow DOM 中挂载，不渲染源码切换按钮且支持卸载', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountInlineWidget(host, {
      widget: {
        w: 'note',
        text: '测试 Shadow DOM 挂载',
      },
      rawJson: '{"w": "note", "text": "测试 Shadow DOM 挂载"}',
    });

    expect(host.shadowRoot).not.toBeNull();
    const shadow = host.shadowRoot!;
    expect(shadow.querySelector('.genui-inline-root')).not.toBeNull();
    expect(shadow.textContent).toContain('测试 Shadow DOM 挂载');

    // 不再渲染源码切换入口
    expect(shadow.querySelector('.inline-raw-btn')).toBeNull();
    expect(shadow.textContent).not.toContain('源码');
    expect(shadow.textContent).not.toContain('收起源码');

    mounted.unmount();
    expect(shadow.querySelector('.genui-inline-root')).toBeNull();
    host.remove();
  });

  it('enhanceDocument: 自动识别 w1 块并挂载为内联组件，原始代码块保持隐藏', () => {
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
    expect(host.shadowRoot?.querySelector('.inline-raw-btn')).toBeNull();
    expect(host.shadowRoot?.textContent).not.toContain('源码');
    expect(host.shadowRoot?.textContent).toContain('测试内联问答');
    expect(block.style.display).toBe('none');
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

  it('CompareView: 无推荐项的纯概念对比不显示「采用此方案」按钮，selectable:false 可强制关闭', () => {
    const info: CompareWidget = {
      w: 'compare',
      title: 'GeForce、GTX、RTX 的关系定位',
      items: [
        { name: 'GeForce', pros: ['NVIDIA 消费级显卡品牌'] },
        { name: 'GTX', pros: ['传统光栅化渲染'] },
        { name: 'RTX', pros: ['实时光追与 DLSS'] },
      ],
    };
    const first = render(<CompareView widget={info} onContinue={vi.fn()} />);
    expect(first.container.querySelectorAll('.inline-compare-select-btn')).toHaveLength(0);
    expect(first.container.querySelectorAll('.inline-compare-actions')).toHaveLength(0);
    first.unmount();

    const forcedOff: CompareWidget = { ...info, highlight: 'RTX', selectable: false };
    const second = render(<CompareView widget={forcedOff} onContinue={vi.fn()} />);
    expect(second.container.querySelectorAll('.inline-compare-select-btn')).toHaveLength(0);
    second.unmount();

    const recommended: CompareWidget = { ...info, highlight: 'RTX' };
    const third = render(<CompareView widget={recommended} onContinue={vi.fn()} />);
    expect(third.container.querySelectorAll('.inline-compare-select-btn')).toHaveLength(3);
    third.unmount();
  });

  it('CompareView: 点击采用方案写入选型模板，且反馈只出现在所选方案', () => {
    const compare: CompareWidget = {
      w: 'compare',
      selectable: true,
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

  it('CompareView: 推荐胶囊放在列头内且无优缺点时不渲染空列表', () => {
    const compare: CompareWidget = {
      w: 'compare',
      highlight: '方案 B',
      items: [
        { name: '方案 A', pros: ['轻量'] },
        { name: '方案 B' },
      ],
    };

    const { container } = render(<CompareView widget={compare} />);
    const cols = container.querySelectorAll('.inline-compare-col');
    expect(cols).toHaveLength(2);
    expect(cols[0].querySelector('.inline-compare-list')).not.toBeNull();
    expect(cols[1].querySelector('.inline-compare-list')).toBeNull();
    const head = cols[1].querySelector('.inline-compare-col-head');
    expect(head?.querySelector('.inline-compare-name')?.textContent).toBe('方案 B');
    expect(head?.querySelector('.inline-compare-pill')?.textContent).toBe('推荐');
  });

  it('inline.css: 使用统一的尺寸变量收口，无源码按钮样式', () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../src/render/inline/inline.css'),
      'utf8',
    );

    expect(css).not.toContain('.inline-raw-btn');
    expect(css).toContain('--inline-radius-outer: 12px');
    expect(css).toContain('--inline-radius-inner: 8px');
    expect(css).toContain('--inline-pad-outer: 14px');
    expect(css).toContain('--inline-pad-inner: 12px');
    expect(css).toContain('--inline-gap: 10px');
    expect(css).toContain('.genui-inline-root[data-site-theme="dark"]');
    expect(css).toContain('.inline-form-body');
    expect(css).toContain('.inline-primary-btn');
    expect(css).toContain('--inline-primary-bg');
    expect(css).toContain('--inline-primary-ink');
  });

  it('FormView: 渲染澄清表单、默认选中、提交进入锁定态保留已提交值，并支持修改后重新提交 (R-F6)', async () => {
    const form: FormWidget = {
      w: 'form',
      title: '你想要哪一种窗外视角？',
      fields: [
        {
          id: 'view',
          type: 'radio',
          label: '窗外视角',
          options: [
            { label: '高层公寓落地窗', value: '高层公寓落地窗' },
            { label: '卧室窗外雨景', value: '卧室窗外雨景' },
          ],
          default: '高层公寓落地窗',
        },
        {
          id: 'style',
          type: 'radio',
          label: '画面风格',
          layout: 'inline',
          options: [
            { label: '写实摄影', value: '写实摄影' },
            { label: '动漫插画', value: '动漫插画' },
          ],
          default: '写实摄影',
        },
        {
          id: 'extra',
          type: 'text',
          label: '补充要求（选填）',
          optional: true,
        },
      ],
      submit: {
        label: '查找这种风格的更多动态壁纸',
        prompt: '主题：{view}；风格：{style}。{extra?补充：{extra}。}请展示预览。',
      },
    };

    const onRequestSend = vi.fn(async () => ({ status: 'sent' as const }));

    const { container } = render(
      <FormView widget={form} onRequestSend={onRequestSend} requireTrustedClick={false} />,
    );

    // 切换为「卧室窗外雨景」与「动漫插画」，填写补充文本
    fireEvent.click(screen.getByRole('radio', { name: '卧室窗外雨景' }));
    fireEvent.click(screen.getByRole('radio', { name: '动漫插画' }));
    fireEvent.change(screen.getByLabelText('补充要求（选填）'), {
      target: { value: '优先免费MP4' },
    });

    const submitBtn = screen.getByRole('button', { name: '查找这种风格的更多动态壁纸 →' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onRequestSend).toHaveBeenCalledTimes(1);
    });
    expect(onRequestSend).toHaveBeenCalledWith(
      '主题：卧室窗外雨景；风格：动漫插画。补充：优先免费MP4。请展示预览。',
      { isTrusted: false },
    );

    // R-F6: 锁定「已提交」态且保留用户提交的值（不重置回默认值）
    await waitFor(() => {
      expect(container.querySelector('.inline-form-body')?.getAttribute('data-form-locked')).toBe(
        'true',
      );
    });
    expect(screen.getByRole('radio', { name: '卧室窗外雨景' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: '动漫插画' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect((screen.getByLabelText('补充要求（选填）') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText('✓ 已提交')).toBeTruthy();

    // 点击「修改后重新提交」解锁，且保留先前值
    fireEvent.click(screen.getByRole('button', { name: '修改后重新提交' }));
    expect(container.querySelector('.inline-form-body')?.getAttribute('data-form-locked')).toBe(
      'false',
    );
    expect(screen.getByRole('radio', { name: '卧室窗外雨景' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('FormView: 必填项未完成时禁用主按钮，默认拦截非信任点击 (G1/R-F3)', () => {
    const form: FormWidget = {
      w: 'form',
      title: '筛选偏好',
      fields: [
        {
          id: 'tags',
          type: 'checkbox',
          label: '关注维度',
          options: [
            { label: '价格', value: 'price' },
            { label: '交通', value: 'transit' },
          ],
        },
      ],
      submit: { label: '查找场馆', prompt: '维度：{tags}' },
    };

    const onRequestSend = vi.fn(async () => ({ status: 'sent' as const }));
    render(<FormView widget={form} onRequestSend={onRequestSend} />);

    const btn = screen.getByRole('button', { name: '查找场馆 →' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/请先完成必填项/)).toBeTruthy();

    // 勾选一项后按钮启用
    fireEvent.click(screen.getByRole('checkbox', { name: '交通' }));
    expect(btn.disabled).toBe(false);

    // 默认 requireTrustedClick=true 时，jsdom 合成点击（isTrusted=false）不会触发发送
    fireEvent.click(btn);
    expect(onRequestSend).not.toHaveBeenCalled();
  });

  it('FormView: 响应环境状态变化（生成中禁用 / 有草稿切回带入输入框）', () => {
    let snapshot: FollowupEnvironmentState = {
      generationActive: false,
      hasDraft: false,
      followupMode: 'send',
    };
    const listeners = new Set<() => void>();
    const env: FollowupEnvironmentStore = {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const emit = (next: Partial<FollowupEnvironmentState>) => {
      snapshot = { ...snapshot, ...next };
      for (const listener of listeners) listener();
    };

    const form: FormWidget = {
      w: 'form',
      title: '偏好',
      fields: [{ id: 'a', type: 'radio', label: 'A', options: [{ label: '1', value: '1' }], default: '1' }],
      submit: { label: '继续', prompt: '选 {a}' },
    };

    const { container } = render(<FormView widget={form} followupEnv={env} />);
    const view = within(container);
    const btn = () => view.getByRole('button', { name: /继续|等待当前回答结束/ }) as HTMLButtonElement;
    expect(btn().textContent).toBe('继续 →');
    expect(btn().disabled).toBe(false);

    act(() => {
      emit({ generationActive: true });
    });
    expect(btn().textContent).toBe('等待当前回答结束');
    expect(btn().disabled).toBe(true);

    act(() => {
      emit({ generationActive: false, hasDraft: true });
    });
    expect(btn().textContent).toBe('继续（带入输入框）');
    expect(btn().disabled).toBe(false);
    expect(view.getByText(/检测到输入框已有草稿/)).toBeTruthy();
  });

  it('QuizView (grade:model / P0-c): 无预选、未作答禁用主按钮、模板含答案与可选理由', async () => {
    const quiz: QuizWidget = {
      w: 'quiz',
      grade: 'model',
      question: '第一轮理解检测',
      options: [],
      questions: [
        {
          id: 'q1',
          question: '子空间必须包含哪个向量？',
          options: [
            { label: '零向量', value: 'A' },
            { label: '单位向量', value: 'B' },
          ],
        },
        {
          id: 'q2',
          question: 'y=2x 是否对标量乘法封闭？',
          options: [
            { label: '封闭', value: 'A' },
            { label: '不封闭', value: 'B' },
          ],
        },
      ],
      reason: true,
      reasonLabel: '简要解释题目 2 的理由（选填）',
    };

    const onRequestSend = vi.fn(async () => ({ status: 'sent' as const }));
    const { container } = render(
      <QuizView widget={quiz} onRequestSend={onRequestSend} requireTrustedClick={false} />,
    );
    const view = within(container);

    // 题目均无预选
    const radios = view.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    for (const radio of radios) {
      expect(radio.getAttribute('aria-checked')).toBe('false');
    }

    // 未作答时主按钮禁用
    const submitBtn = view.getByRole('button', { name: '提交答案并批改 →' }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    // 只答第 1 题仍禁用
    fireEvent.click(view.getByRole('radio', { name: '零向量' }));
    expect(submitBtn.disabled).toBe(true);

    // 答完第 2 题后启用，填写可选理由
    fireEvent.click(view.getByRole('radio', { name: '封闭' }));
    expect(submitBtn.disabled).toBe(false);

    fireEvent.change(view.getByLabelText('简要解释题目 2 的理由（选填）'), {
      target: { value: 'c*(x,2x) = (cx, 2cx) 仍在直线上' },
    });

    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(onRequestSend).toHaveBeenCalledTimes(1);
    });
    const sentPrompt = (onRequestSend.mock.calls[0] as unknown as [string])[0];
    expect(sentPrompt).toContain('A（零向量）');
    expect(sentPrompt).toContain('A（封闭）');
    expect(sentPrompt).toContain('c*(x,2x) = (cx, 2cx) 仍在直线上');
  });

  it('ChecklistView / CompareView (P0-e): 接入 onRequestSend 与环境护栏 G1/G2/G3/G7', async () => {
    let snapshot: FollowupEnvironmentState = {
      generationActive: false,
      hasDraft: false,
      followupMode: 'send',
    };
    const listeners = new Set<() => void>();
    const envStore: FollowupEnvironmentStore = {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const updateEnv = (patch: Partial<FollowupEnvironmentState>) => {
      snapshot = { ...snapshot, ...patch };
      for (const listener of listeners) listener();
    };

    const checklist: ChecklistWidget = {
      w: 'checklist',
      items: [
        { text: '写单测', checked: true },
        { text: '更新文档' },
      ],
    };
    const onSendChecklist = vi.fn(async () => ({ status: 'sent' as const }));

    // 1) ChecklistView 默认 requireTrustedClick=true 拦截非信任点击 (G1)
    const guarded = render(
      <ChecklistView
        widget={checklist}
        onRequestSend={onSendChecklist}
        followupEnv={envStore}
      />,
    );
    const guardedBtn = guarded.container.querySelector<HTMLButtonElement>('.inline-feedback-btn')!;
    expect(guardedBtn.textContent).toBe('📋 按未完成任务规划下一步 →');
    fireEvent.click(guardedBtn);
    expect(onSendChecklist).not.toHaveBeenCalled();
    guarded.unmount();

    // 2) ChecklistView 关闭信任检测后支持直接发送、G2 禁用、G3 草稿切换文案
    const checkRender = render(
      <ChecklistView
        widget={checklist}
        onRequestSend={onSendChecklist}
        followupEnv={envStore}
        requireTrustedClick={false}
      />,
    );
    const checkBtn = () =>
      checkRender.container.querySelector<HTMLButtonElement>('.inline-feedback-btn')!;
    fireEvent.click(checkBtn());
    await waitFor(() => expect(onSendChecklist).toHaveBeenCalledTimes(1));
    expect(onSendChecklist).toHaveBeenCalledWith(
      expect.stringContaining('【任务跟进】\n已完成（1/2）：1. 写单测\n待完成（1/2）：1. 更新文档'),
      { isTrusted: false },
    );
    expect(within(checkRender.container).getByText('✓ 已发送')).toBeTruthy();

    act(() => updateEnv({ generationActive: true }));
    expect(checkBtn().disabled).toBe(true);
    expect(checkBtn().textContent).toBe('等待当前回答结束');

    act(() => updateEnv({ generationActive: false, hasDraft: true }));
    expect(checkBtn().disabled).toBe(false);
    expect(checkBtn().textContent).toBe('📋 按未完成任务规划下一步（带入输入框）');
    checkRender.unmount();

    // 3) CompareView 接入直接发送与环境联动
    act(() => updateEnv({ generationActive: false, hasDraft: false, followupMode: 'send' }));
    const compare: CompareWidget = {
      w: 'compare',
      selectable: true,
      items: [{ name: '方案 A' }, { name: '方案 B' }],
    };
    const onSendCompare = vi.fn(async () => ({ status: 'sent' as const }));
    const cmpRender = render(
      <CompareView
        widget={compare}
        onRequestSend={onSendCompare}
        followupEnv={envStore}
        requireTrustedClick={false}
      />,
    );
    const cmpButtons = () =>
      cmpRender.container.querySelectorAll<HTMLButtonElement>('.inline-compare-select-btn');
    expect(cmpButtons()[0].textContent).toBe('👉 采用此方案继续细化 →');
    fireEvent.click(cmpButtons()[1]);
    await waitFor(() => expect(onSendCompare).toHaveBeenCalledTimes(1));
    expect(onSendCompare).toHaveBeenCalledWith(
      expect.stringContaining('我决定采用【方案 B】'),
      { isTrusted: false },
    );
    expect(within(cmpRender.container).getByText('✓ 已发送')).toBeTruthy();

    act(() => updateEnv({ generationActive: true }));
    expect(cmpButtons()[0].disabled).toBe(true);
    expect(cmpButtons()[1].disabled).toBe(true);
    expect(cmpButtons()[0].textContent).toBe('等待当前回答结束');

    act(() => updateEnv({ generationActive: false, followupMode: 'fill' }));
    expect(cmpButtons()[0].disabled).toBe(false);
    expect(cmpButtons()[0].textContent).toBe('👉 采用此方案继续细化（带入输入框）');
  });

  it('enhanceDocument (P0-e): 清单与对比组件回流透传到 onRequestSend', async () => {
    const doc = document.implementation.createHTMLDocument('p0e');
    doc.body.innerHTML = `
      <div class="ds-assistant-message-main-content">
        <div class="md-code-block" id="blk-compare">
          <div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div>
          <pre><span>{"w": "compare", "selectable": true, "items": [{"name": "Vite"}, {"name": "Rollup"}]}</span></pre>
        </div>
      </div>
    `;
    const onRequestSend = vi.fn(async () => ({ status: 'sent' as const }));
    const res = enhanceDocument(doc, { onRequestSend, requireTrustedClick: false });
    expect(res.mounted).toBe(1);

    const shadow = doc.querySelector<HTMLElement>('.genui-card-host')!.shadowRoot!;
    const btn = shadow.querySelector<HTMLButtonElement>('.inline-compare-select-btn')!;
    expect(btn.textContent).toBe('👉 采用此方案继续细化 →');
    btn.click();

    await waitFor(() => expect(onRequestSend).toHaveBeenCalledTimes(1));
    expect(onRequestSend).toHaveBeenCalledWith(
      expect.stringContaining('我决定采用【Vite】'),
      { isTrusted: false },
    );
  });
});
