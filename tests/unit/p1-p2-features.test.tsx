import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGenui } from '../../src/protocol/validate';
import { normalizeWidget } from '../../src/protocol/widget/normalize';
import type {
  CardWidget,
  CopyWidget,
  FlowWidget,
  ResultWidget,
  SliderWidget,
} from '../../src/protocol/widget/types';
import { InlineWidgetRoot } from '../../src/render/inline/InlineWidgetRoot';
import { getOrCreateInlineBus } from '../../src/render/inline/store';
import {
  interpolateFormula,
  KATEX_SHADOW_CSS,
  MathFormula,
  MathText,
  parseMathSegments,
  stripKatexFontFaces,
} from '../../src/render/math';
import { mountCard, type MountedCard } from '../../src/render/mount';

const flushUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('P1-b: 本地 KaTeX 公式渲染与安全边界', () => {
  it('KATEX_SHADOW_CSS 与 stripKatexFontFaces 剥离 @font-face 与相对字体 URL，仅保留本地排版样式', () => {
    const rawKatexCss = readFileSync(
      resolve(process.cwd(), 'node_modules/katex/dist/katex.min.css'),
      'utf8',
    );
    const stripped = stripKatexFontFaces(rawKatexCss);
    expect(stripped).toContain('.katex');
    expect(stripped).not.toMatch(/@font-face/i);
    expect(stripped).not.toMatch(/url\s*\(\s*['"]?fonts\//i);
    expect(stripped).not.toMatch(/https?:\/\//i);
    expect(KATEX_SHADOW_CSS).toContain('.genui-math-display');
    expect(KATEX_SHADOW_CSS).not.toMatch(/@font-face/i);
    expect(KATEX_SHADOW_CSS).not.toMatch(/https?:\/\//i);
  });

  it('parseMathSegments 正确识别 $...$ / $$...$$ / \\(...\\) / \\[...\\]，且不误伤货币写法', () => {
    expect(parseMathSegments('普通文本无公式')).toEqual([{ kind: 'text', value: '普通文本无公式' }]);
    expect(parseMathSegments('价格 $100 到 $200，区间 $50-$100')).toEqual([
      { kind: 'text', value: '价格 $100 到 $200，区间 $50-$100' },
    ]);
    expect(parseMathSegments('转义 \\$100 与公式 $y = 2x$')).toEqual([
      { kind: 'text', value: '转义 $100 与公式 ' },
      { kind: 'inline', tex: 'y = 2x' },
    ]);
    expect(parseMathSegments('满足 $0 \\in W$ 且 $$y = ax^2 + bx + c$$')).toEqual([
      { kind: 'text', value: '满足 ' },
      { kind: 'inline', tex: '0 \\in W' },
      { kind: 'text', value: ' 且 ' },
      { kind: 'display', tex: 'y = ax^2 + bx + c' },
    ]);
    expect(parseMathSegments('行内 \\(u + v \\in W\\) 与块级 \\[\\mathbb{R}^2\\]')).toEqual([
      { kind: 'text', value: '行内 ' },
      { kind: 'inline', tex: 'u + v \\in W' },
      { kind: 'text', value: ' 与块级 ' },
      { kind: 'display', tex: '\\mathbb{R}^2' },
    ]);
  });

  it('interpolateFormula 单遍替换变量且保留 LaTeX 花括号，不做二次展开', () => {
    expect(interpolateFormula('y = {a}x^2 + \\frac{1}{2}', { a: 2 })).toBe(
      'y = 2x^2 + \\frac{1}{2}',
    );
    expect(interpolateFormula('f(x) = {a} + {b}', { a: '{b}', b: 9 })).toBe('f(x) = {b} + 9');
  });

  it('MathFormula 渲染本地 KaTeX DOM，禁用 \\href 等不可信指令，错误语法不崩溃', () => {
    const view = render(
      <div>
        <MathFormula tex="y = ax^2" displayMode />
        <MathFormula tex="\href{javascript:alert(1)}{click}" />
        <MathFormula tex="\notARealCommand{1}" />
      </div>,
    );
    expect(view.container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    expect(view.container.querySelector('a, [href]')).toBeNull();
    const htmlViews = Array.from(view.container.querySelectorAll('.katex-html'))
      .map((node) => node.innerHTML)
      .join('');
    expect(htmlViews).not.toContain('javascript:');
  });

  it('MathText 在纯文本场景零额外包装，含公式时混排纯文本与 KaTeX', () => {
    const plain = render(<p><MathText text="预算 5000 元" /></p>);
    expect(plain.container.querySelector('.katex')).toBeNull();
    expect(plain.container.textContent).toBe('预算 5000 元');

    const mixed = render(<p><MathText text="向量 $v \in \mathbb{R}^2$ 满足 $y=2x$" /></p>);
    expect(mixed.container.querySelectorAll('.katex').length).toBe(2);
  });
});

describe('P1-a: w:"copy"、滑块语义刻度、「本地计算」徽标、card 行式布局与联动公式', () => {
  it('w:"copy" (S10) 校验、渲染引用框并支持一键复制反馈', async () => {
    expect(normalizeWidget({ w: 'copy', title: '缺正文' }).ok).toBe(false);

    const parsed = normalizeWidget({
      w: 'copy',
      title: '打电话时直接这样问',
      text: '你好，请问今天下午练习场需要提前预约吗？租杆怎么收费？',
      label: '复制询问话术',
      note: '可直接电话或微信发送',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const view = render(<InlineWidgetRoot widget={parsed.widget as CopyWidget} />);
    expect(view.container.querySelector('.inline-copy-quote')?.textContent).toContain(
      '租杆怎么收费',
    );
    const btn = view.container.querySelector<HTMLButtonElement>('.inline-copy-btn')!;
    expect(btn.textContent).toBe('复制询问话术');

    fireEvent.click(btn);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      '你好，请问今天下午练习场需要提前预约吗？租杆怎么收费？',
    );
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain('已复制');
  });

  it('w:"slider" + w:"result" (S4) 展示「本地计算」徽标、语义刻度、动态状态解释、重置与实时公式改写', () => {
    const sliderRes = normalizeWidget({
      w: 'slider',
      id: 'a',
      label: '二次项系数 a',
      min: -2,
      max: 2,
      step: 1,
      value: 1,
      minLabel: '-2（向下开口）',
      maxLabel: '+2（向上开口）',
      hints: [
        { max: -0.1, text: 'a 为负，抛物线向下开口。不会重新请求模型。' },
        { min: 0, max: 0, text: 'a = 0，退化为直线。' },
        { min: 0.1, text: 'a 为正，抛物线向上开口。不会重新请求模型。' },
      ],
    });
    const resultRes = normalizeWidget({
      w: 'result',
      label: '当前二次函数',
      formula: 'y = {a}x^2',
      caption: '示例曲线由当前滑块参数本地计算',
    });
    expect(sliderRes.ok && resultRes.ok).toBe(true);
    if (!sliderRes.ok || !resultRes.ok) return;

    const bus = getOrCreateInlineBus();
    const view = render(
      <div>
        <InlineWidgetRoot widget={sliderRes.widget as SliderWidget} bus={bus} />
        <InlineWidgetRoot widget={resultRes.widget as ResultWidget} bus={bus} />
      </div>,
    );

    expect(view.container.querySelector('.inline-local-badge')?.textContent).toBe('本地计算');
    const rangeLabels = view.container.querySelector('.inline-slider-range-labels')?.textContent;
    expect(rangeLabels).toContain('-2（向下开口）');
    expect(rangeLabels).toContain('+2（向上开口）');
    expect(view.container.querySelector('.inline-slider-hint')?.textContent).toContain(
      '抛物线向上开口',
    );
    expect(view.container.querySelector('[data-genui-math]')?.getAttribute('data-genui-math')).toBe(
      'y = 1x^2',
    );
    expect(view.container.querySelector('.inline-result-formula .katex')).not.toBeNull();

    const resetBtn = view.container.querySelector<HTMLButtonElement>('.inline-slider-reset')!;
    expect(resetBtn.disabled).toBe(true);

    const range = view.container.querySelector<HTMLInputElement>('input[type="range"]')!;
    fireEvent.change(range, { target: { value: '-2' } });
    expect(view.container.querySelector('.inline-slider-hint')?.textContent).toContain(
      '抛物线向下开口',
    );
    expect(view.container.querySelector('[data-genui-math]')?.getAttribute('data-genui-math')).toBe(
      'y = -2x^2',
    );
    expect(resetBtn.disabled).toBe(false);

    fireEvent.click(resetBtn);
    expect(range.value).toBe('1');
    expect(view.container.querySelector('[data-genui-math]')?.getAttribute('data-genui-math')).toBe(
      'y = 1x^2',
    );
  });

  it('w:"card" (S2) 支持分隔线行式布局、图标、公式与底部图注', () => {
    const parsed = normalizeWidget({
      w: 'card',
      title: '判断 Subspace 的三个条件',
      items: [
        { icon: '✓', title: '包含零向量（Zero Vector）', math: '0 \\in W' },
        { icon: '+', title: '对加法封闭（Closed under Addition）', math: 'u, v \\in W \\Rightarrow u + v \\in W' },
        { icon: '*', title: '对数乘封闭（Closed under Scalar Multiplication）', math: 'c \\in \\mathbb{R}, u \\in W \\Rightarrow cu \\in W' },
      ],
      caption: '三个条件同时成立才构成子空间 $W \\subseteq \\mathbb{R}^2$。',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const view = render(<InlineWidgetRoot widget={parsed.widget as CardWidget} />);
    const rows = view.container.querySelectorAll('.inline-card-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('.inline-card-row-icon')?.textContent).toBe('✓');
    expect(rows[0].querySelector('.inline-card-row-title')?.textContent).toContain('包含零向量');
    expect(view.container.querySelectorAll('.inline-card-row-math .katex')).toHaveLength(3);
    expect(view.container.querySelector('.inline-widget-caption .katex')).not.toBeNull();
  });
});

describe('P2: w:"flow" 流程图/架构图 与 图表 vectors/annotations/formula', () => {
  let mounted: MountedCard | null = null;

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    document.body.innerHTML = '';
  });

  it('w:"flow" (S3 / S9) 渲染步骤节点、重点底色、带标签箭头、双分栏与 2×2 能力格', () => {
    expect(normalizeWidget({ w: 'flow', steps: [] }).ok).toBe(false);

    const parsed = normalizeWidget({
      w: 'flow',
      title: '整体工作流程与架构',
      steps: [
        { icon: '1', title: '用户输入问题', desc: '通过浏览器发起对话' },
        {
          icon: '2',
          title: '模型返回结构化界面',
          desc: '生成受控声明式 JSON',
          highlight: true,
          arrowLabel: '已授权的远程连接',
          arrowDirection: 'both',
        },
        { icon: '3', title: '扩展本地渲染', desc: '纯受控 React 组件，不执行脚本' },
      ],
      branches: [
        { title: '本地交互', badge: '不请求模型', desc: '拖动滑块即时计算', direction: 'down', tone: 'info' },
        { title: '模型交互', badge: '回流下一轮', desc: '点击主按钮发送选择', direction: 'both', tone: 'accent' },
      ],
      capabilities: [
        { icon: '📊', title: '图表联动' },
        { icon: '🧮', title: '公式排版' },
        { icon: '📋', title: '表单回流' },
        { icon: '🔒', title: '安全沙箱' },
      ],
      caption: '交互分为本地与模型两层。',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const view = render(<InlineWidgetRoot widget={parsed.widget as FlowWidget} />);
    expect(view.container.querySelectorAll('.inline-flow-step')).toHaveLength(3);
    expect(view.container.querySelector('.inline-flow-step.tone-accent')?.textContent).toContain(
      '模型返回结构化界面',
    );
    expect(view.container.querySelector('.inline-flow-arrow-label')?.textContent).toBe(
      '已授权的远程连接',
    );
    expect(view.container.querySelectorAll('.inline-flow-branch')).toHaveLength(2);
    expect(view.container.querySelectorAll('.inline-flow-cap')).toHaveLength(4);
    expect(view.container.querySelector('.inline-widget-caption')?.textContent).toContain(
      '本地与模型两层',
    );
  });

  it('v5 卡片支持「本地计算」徽标、滑块语义刻度、动态 formula 元素与折线图 vectors/annotations/cornerLabel/caption (S1 + S4)', async () => {
    const raw = JSON.stringify({
      type: 'genui',
      version: 5,
      title: '向量子空间与二次函数演示',
      state: [
        {
          id: 'a',
          label: '系数 a',
          kind: 'number',
          initial: 1,
          min: -2,
          max: 2,
          step: 1,
          minLabel: '-2（向下开口）',
          maxLabel: '+2（向上开口）',
        },
      ],
      derived: [],
      models: [],
      elements: [
        {
          kind: 'formula',
          label: '当前表达式',
          template: 'y = {a}x^2',
          caption: '拖动滑块时本地实时更新',
        },
        { kind: 'slider', bind: 'a' },
        {
          kind: 'chart',
          chartType: 'line',
          title: '子空间图解',
          cornerLabel: 'R²',
          caption: '直线 $y = 2x$ 上所有向量构成子空间，不只包含蓝色向量 $\\vec{v}$。',
          series: [
            {
              label: 'y = 2x',
              points: [
                { x: -2, y: -4 },
                { x: 2, y: 4 },
              ],
            },
          ],
          vectors: [
            { from: [0, 0], to: [1, 2], label: 'v', color: '#4d6bfe' },
          ],
          annotations: [
            { x: 0, y: 0, text: 'O(0,0)', point: true },
            { x: 1.5, y: 3, text: 'y = 2x', align: 'left' },
          ],
        },
      ],
    });

    const parsed = parseGenui(raw);
    expect(parsed.ok, parsed.ok ? '' : parsed.detail).toBe(true);
    if (!parsed.ok) return;

    const host = document.createElement('div');
    document.body.append(host);
    mounted = mountCard(host, { document: parsed.document, rawJson: raw });
    const shadow = host.shadowRoot!;

    expect(shadow.querySelector('.genui-local-badge')?.textContent).toBe('本地计算');
    expect(shadow.querySelector('.genui-slider-ticks')?.textContent).toContain('-2（向下开口）');
    expect(shadow.querySelector('.genui-slider-ticks')?.textContent).toContain('+2（向上开口）');
    expect(shadow.querySelector('.genui-formula [data-genui-math]')?.getAttribute('data-genui-math')).toBe(
      'y = 1x^2',
    );
    expect(shadow.querySelector('.genui-formula .katex')).not.toBeNull();

    // 拖动滑块后卡片内 KaTeX 公式实时改写
    const slider = shadow.querySelector<HTMLInputElement>('input[type="range"]')!;
    fireEvent.change(slider, { target: { value: '-2' } });
    await flushUi();
    expect(shadow.querySelector('.genui-formula [data-genui-math]')?.getAttribute('data-genui-math')).toBe(
      'y = -2x^2',
    );

    // 数学图解：向量箭头、标注点/文本、角标 R² 与含公式图注
    expect(shadow.querySelectorAll('.genui-chart-vector')).toHaveLength(1);
    expect(shadow.querySelector('.genui-chart-vector polygon')).not.toBeNull();
    expect(shadow.querySelector('.genui-chart-vector-label')?.textContent).toBe('v');
    expect(shadow.querySelectorAll('.genui-chart-annotation')).toHaveLength(2);
    expect(shadow.querySelectorAll('.genui-chart-annotation-point')).toHaveLength(1);
    expect(shadow.querySelector('.genui-chart-corner-label')?.textContent).toBe('R²');
    expect(shadow.querySelector('.genui-chart-caption .katex')).not.toBeNull();
  });

  it('v4/v5 折线图允许仅含 vectors（series 为空），但拒绝 series/vectors/annotations 全空', () => {
    const vectorOnly = parseGenui(
      JSON.stringify({
        type: 'genui',
        version: 5,
        state: [],
        derived: [],
        models: [],
        elements: [
          {
            kind: 'chart',
            chartType: 'line',
            title: '纯向量图解',
            series: [],
            vectors: [{ to: [2, 3], label: 'u' }],
          },
        ],
      }),
    );
    expect(vectorOnly.ok).toBe(true);

    const allEmpty = parseGenui(
      JSON.stringify({
        type: 'genui',
        version: 5,
        state: [],
        derived: [],
        models: [],
        elements: [
          {
            kind: 'chart',
            chartType: 'line',
            title: '空折线图',
            series: [],
          },
        ],
      }),
    );
    expect(allEmpty.ok).toBe(false);
  });
});
