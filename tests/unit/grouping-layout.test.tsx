import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenuiV3Document, GenuiV5Document } from '../../src/protocol/types';
import { parseGenui } from '../../src/protocol/validate';
import { mountCard, type MountedCard } from '../../src/render/mount';

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../src/render/card.css'),
  'utf8',
);

let mounted: MountedCard | null = null;

function mount(
  doc: GenuiV3Document | GenuiV5Document,
  options: { onToggleRaw?: (showRaw: boolean) => void } = {},
): HTMLElement {
  const host = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(host);
  mounted = mountCard(host, {
    document: doc,
    rawJson: JSON.stringify(doc),
    onToggleRaw: options.onToggleRaw,
  });
  return host;
}

function shadow(host: HTMLElement): ShadowRoot {
  const root = host.shadowRoot;
  expect(root).not.toBeNull();
  return root!;
}

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  globalThis.document.body.replaceChildren();
});

describe('Issue #13 分组与布局（CSS 规则静态检查）', () => {
  it('建立局部容器查询，默认单列并在 38rem/58rem 断点自适应', () => {
    expect(css).toContain('.genui-columns-container');
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('@container (min-width: 38rem)');
    expect(css).toContain('@container (min-width: 58rem)');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    // 移除视口媒体查询
    expect(css).not.toContain('@media (max-width: 560px)');
  });

  it('section 移除四周封闭盒子描边，改为标题与留白分组及轻量顶部分隔', () => {
    // 移除四周 10px 盒子与封闭边框
    expect(css).not.toMatch(/\.genui-section\s*\{[^}]*border:\s*1px\s+solid[^}]*border-radius:\s*10px/);
    expect(css).not.toMatch(/\.genui-section\s*\{[^}]*padding:\s*10px\s+12px/);
    // 具备顶部分隔与留白规则
    expect(css).toContain('.genui-section:not(:first-child)');
    expect(css).toContain('border-top: 1px solid var(--genui-color-border-subtle)');
    // 嵌套首项紧凑对齐
    expect(css).toContain('.genui-column > .genui-section:first-child');
    expect(css).toContain('.genui-section-body > .genui-section:first-child');
  });

  it('各大布局与控件容器均声明 min-width: 0 防止水平溢出', () => {
    const containers = [
      '.genui-card',
      '.genui-card-body',
      '.genui-section',
      '.genui-section-body',
      '.genui-columns-container',
      '.genui-columns',
      '.genui-column',
      '.genui-control',
      '.genui-slider-row',
    ];
    for (const cls of containers) {
      const escaped = cls.replace('.', '\\.');
      const regex = new RegExp(`${escaped}[^{]*\\{[^}]*min-width:\\s*0;`, 'm');
      expect(regex.test(css), `容器 ${cls} 必须声明 min-width: 0`).toBe(true);
    }
  });
});

describe('Issue #13 DOM 结构、阅读顺序与可访问性', () => {
  it('正确渲染 .genui-columns-container > .genui-columns[data-columns] 并保持标题层级', () => {
    const doc: GenuiV3Document = {
      type: 'genui',
      version: 3,
      title: '主卡片标题',
      state: [
        { id: 's1', label: '参数 1', kind: 'number', initial: 10, min: 0, max: 100, step: 1 },
        { id: 's2', label: '参数 2', kind: 'number', initial: 20, min: 0, max: 100, step: 1 },
      ],
      derived: [],
      elements: [
        {
          kind: 'section',
          title: '一级分组',
          children: [
            {
              kind: 'columns',
              columns: [
                [
                  {
                    kind: 'section',
                    title: '嵌套分组 A',
                    children: [{ kind: 'slider', bind: 's1' }],
                  },
                ],
                [
                  {
                    kind: 'section',
                    title: '嵌套分组 B',
                    children: [{ kind: 'slider', bind: 's2' }],
                  },
                ],
              ],
            },
          ],
        },
      ],
    };

    const host = mount(doc);
    const root = shadow(host);

    // 标题层级验证
    const cardTitle = root.querySelector('h3.genui-card-title');
    expect(cardTitle).not.toBeNull();
    expect(cardTitle?.textContent).toBe('主卡片标题');

    const sectionTitles = Array.from(root.querySelectorAll('h4.genui-section-title')).map(
      (el) => el.textContent,
    );
    expect(sectionTitles).toEqual(['一级分组', '嵌套分组 A', '嵌套分组 B']);

    // 容器查询与多列包装
    const container = root.querySelector('.genui-columns-container');
    expect(container).not.toBeNull();
    const columns = container?.querySelector('.genui-columns');
    expect(columns?.getAttribute('data-columns')).toBe('2');

    const columnEls = root.querySelectorAll('.genui-column');
    expect(columnEls).toHaveLength(2);
  });

  it('DOM 阅读顺序与键盘 Tab 顺序与协议声明严格一致', () => {
    const doc: GenuiV3Document = {
      type: 'genui',
      version: 3,
      title: '焦点顺序测试',
      state: [
        { id: 'left1', label: '左一', kind: 'number', initial: 1, min: 0, max: 10, step: 1 },
        { id: 'left2', label: '左二', kind: 'number', initial: 2, min: 0, max: 10, step: 1 },
        { id: 'right1', label: '右一', kind: 'number', initial: 3, min: 0, max: 10, step: 1 },
      ],
      derived: [],
      elements: [
        {
          kind: 'columns',
          columns: [
            [
              { kind: 'slider', bind: 'left1' },
              { kind: 'number-input', bind: 'left2' },
            ],
            [
              { kind: 'slider', bind: 'right1' },
            ],
          ],
        },
      ],
    };

    const host = mount(doc);
    const root = shadow(host);

    // 查找全部输入控件
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input'));
    expect(inputs).toHaveLength(3);
    // DOM 顺序必须为：左列输入1 -> 左列输入2 -> 右列输入1
    expect(inputs[0].getAttribute('type')).toBe('range');
    expect(inputs[1].getAttribute('type')).toBe('number');
    expect(inputs[2].getAttribute('type')).toBe('range');

    const labels = Array.from(root.querySelectorAll('.genui-control-label')).map(
      (el) => el.textContent?.trim(),
    );
    expect(labels).toEqual(['左一', '左二', '右一']);
  });
});

describe('Issue #13 宽窄切换状态保持与不卸载验证', () => {
  it('容器尺寸切换时，纯 CSS 响应，DOM 节点未被替换，状态、草稿、表格排序/筛选与折叠状态完整保留', async () => {
    const doc: GenuiV3Document = {
      type: 'genui',
      version: 3,
      title: '响应式状态保持',
      state: [
        { id: 'num', label: '数字输入', kind: 'number', initial: 10, min: 0, max: 100, step: 1, unit: '元' },
        { id: 'sliderVal', label: '滑块输入', kind: 'number', initial: 50, min: 0, max: 100, step: 5 },
      ],
      derived: [],
      elements: [
        {
          kind: 'columns',
          columns: [
            [
              { kind: 'slider', bind: 'sliderVal' },
              { kind: 'number-input', bind: 'num' },
            ],
            [
              {
                kind: 'table',
                title: '候选列表',
                sortable: true,
                columns: [
                  { key: 'name', label: '名称' },
                  { key: 'score', label: '评分', numeric: true },
                ],
                rows: [
                  { cells: { name: 'Alpha', score: 88 } },
                  { cells: { name: 'Beta', score: 95 } },
                  { cells: { name: 'Gamma', score: 72 } },
                ],
              },
            ],
          ],
        },
        {
          kind: 'chart',
          chartType: 'bar',
          title: '柱状图',
          items: [
            { label: 'A', value: { op: 'state', id: 'sliderVal' } },
            { label: 'B', value: { op: 'const', value: 40 } },
          ],
        },
      ],
    };

    const host = mount(doc);
    const root = shadow(host);

    // 1. 获取初始 DOM 节点引用
    const sliderInput = root.querySelector<HTMLInputElement>('input[type="range"]');
    const numberInput = root.querySelector<HTMLInputElement>('input.genui-number-input');
    const tableEl = root.querySelector<HTMLTableElement>('table.genui-table');
    const chartDetails = root.querySelector<HTMLDetailsElement>('details.genui-chart-data');
    const tableFilter = root.querySelector<HTMLInputElement>('.genui-table-filter input');
    const sortBtn = root.querySelector<HTMLButtonElement>('.genui-table-sort');

    expect(sliderInput).not.toBeNull();
    expect(numberInput).not.toBeNull();
    expect(tableEl).not.toBeNull();
    expect(chartDetails).not.toBeNull();
    expect(tableFilter).not.toBeNull();
    expect(sortBtn).not.toBeNull();

    // 2. 修改各组件状态
    // 修改滑块
    fireEvent.change(sliderInput!, { target: { value: '75' } });
    await flushUi();
    expect(sliderInput?.value).toBe('75');

    // 修改 number-input：输入超界草稿 "150"（上限 100）
    fireEvent.change(numberInput!, { target: { value: '150' } });
    await flushUi();
    expect(numberInput?.value).toBe('150');
    expect(root.querySelector('.genui-input-error')).not.toBeNull();
    expect(root.querySelector('.genui-input-error')?.textContent).toContain('请输入 0–100 之间的值');

    // 表格筛选过滤为 "Beta"
    fireEvent.change(tableFilter!, { target: { value: 'Beta' } });
    await flushUi();
    expect(root.querySelectorAll('.genui-table tbody tr')).toHaveLength(1);
    expect(root.querySelector('.genui-table tbody')?.textContent).toContain('Beta');

    // 点击表格排序
    fireEvent.click(sortBtn!);
    await flushUi();

    // 展开图表详情
    if (chartDetails) {
      chartDetails.open = true;
    }
    expect(chartDetails?.open).toBe(true);

    // 3. 模拟连续调整容器宽度：800px -> 360px -> 560px -> 960px
    const widths = ['800px', '360px', '560px', '960px'];
    for (const w of widths) {
      host.style.width = w;
      globalThis.dispatchEvent(new Event('resize'));
      await flushUi();

      // 4. 断言 DOM 节点引用保持不变（React 树未被重新构建或替换）
      expect(root.querySelector('input[type="range"]')).toBe(sliderInput);
      expect(root.querySelector('input.genui-number-input')).toBe(numberInput);
      expect(root.querySelector('table.genui-table')).toBe(tableEl);
      expect(root.querySelector('details.genui-chart-data')).toBe(chartDetails);

      // 断言各状态值与草稿、筛选、排序、详情展开保持
      expect(sliderInput?.value).toBe('75');
      expect(numberInput?.value).toBe('150');
      expect(root.querySelector('.genui-input-error')?.textContent).toContain('请输入 0–100 之间的值');
      expect(tableFilter?.value).toBe('Beta');
      expect(root.querySelectorAll('.genui-table tbody tr')).toHaveLength(1);
      expect(chartDetails?.open).toBe(true);
    }
  });
});

describe('Issue #13 兼容性回归与 emphasis 收集', () => {
  it('RESPONSIVE_LAYOUT_RAW 解析与渲染验证', () => {
    const raw = `{
  "type": "genui",
  "version": 5,
  "title": "自适应与防溢出测试",
  "state": [
    {
      "id": "longField",
      "label": "超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签超长中文标签",
      "kind": "number",
      "initial": 1000000000000,
      "min": 0,
      "max": 1000000000000,
      "step": 1000000,
      "unit": "千瓦时·每周期人次测试单位二十字"
    },
    { "id": "paramA", "label": "参数 A", "kind": "number", "initial": 10, "min": 0, "max": 100, "step": 1 },
    { "id": "paramB", "label": "参数 B", "kind": "number", "initial": 20, "min": 0, "max": 100, "step": 1 },
    { "id": "inputNum", "label": "数字输入", "kind": "number", "initial": 50, "min": 0, "max": 100, "step": 1 },
    { "id": "col3_1", "label": "三列 1", "kind": "number", "initial": 1, "min": 0, "max": 10, "step": 1 },
    { "id": "col3_2", "label": "三列 2", "kind": "number", "initial": 2, "min": 0, "max": 10, "step": 1 },
    { "id": "col3_3", "label": "三列 3", "kind": "number", "initial": 3, "min": 0, "max": 10, "step": 1 }
  ],
  "derived": [],
  "models": [
    {
      "kind": "budget",
      "id": "monthly",
      "label": "月度收支",
      "unit": "元",
      "precision": 0,
      "income": { "op": "const", "value": 10000 },
      "expenses": [{ "label": "固定支出", "amount": { "op": "const", "value": 4000 } }]
    }
  ],
  "elements": [
    {
      "kind": "section",
      "title": "两列与嵌套两列",
      "children": [
        {
          "kind": "columns",
          "columns": [
            [
              {
                "kind": "columns",
                "columns": [
                  [{ "kind": "slider", "bind": "paramA" }],
                  [{ "kind": "slider", "bind": "paramB" }]
                ]
              },
              { "kind": "number-input", "bind": "inputNum" }
            ],
            [
              {
                "kind": "value",
                "label": "主要结果",
                "source": { "kind": "model", "model": "monthly", "key": "balance" },
                "unit": "元",
                "emphasis": "primary"
              }
            ]
          ]
        }
      ]
    },
    {
      "kind": "section",
      "title": "三列布局",
      "children": [
        {
          "kind": "columns",
          "columns": [
            [{ "kind": "slider", "bind": "col3_1" }],
            [{ "kind": "slider", "bind": "col3_2" }],
            [{ "kind": "slider", "bind": "col3_3" }]
          ]
        }
      ]
    },
    {
      "kind": "section",
      "title": "超长内容与宽表",
      "children": [
        { "kind": "slider", "bind": "longField" },
        {
          "kind": "table",
          "title": "方案对比表",
          "sortable": true,
          "columns": [
            { "key": "name", "label": "方案名称" },
            { "key": "cost", "label": "预计成本", "numeric": true },
            { "key": "score", "label": "综合评分", "numeric": true }
          ],
          "rows": [
            { "cells": { "name": "方案 A", "cost": 1200, "score": 85 } },
            { "cells": { "name": "方案 B", "cost": 800, "score": 92 } },
            { "cells": { "name": "方案 C", "cost": 1500, "score": 78 } },
            { "cells": { "name": "方案 D", "cost": 950, "score": 88 } }
          ]
        },
        {
          "kind": "chart",
          "chartType": "bar",
          "title": "收支对比",
          "legend": true,
          "source": { "model": "monthly" }
        },
        {
          "kind": "explain",
          "model": "monthly",
          "title": "计算依据与诊断"
        }
      ]
    }
  ]
}`;
    const parsed = parseGenui(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const host = mount(parsed.document as GenuiV5Document);
      const root = shadow(host);
      const slider = root.querySelector('input[type="range"][max="1000000000000"]');
      expect(slider).not.toBeNull();
      }
  });

  it('嵌套布局下前两个显式 primary 正确突出显示，后序 primary 保持普通', () => {
    const doc: GenuiV3Document = {
      type: 'genui',
      version: 3,
      title: '主结果强调回归',
      state: [
        { id: 'v1', label: '结果1', kind: 'number', initial: 100, min: 0, max: 500, step: 1 },
        { id: 'v2', label: '结果2', kind: 'number', initial: 200, min: 0, max: 500, step: 1 },
        { id: 'v3', label: '结果3', kind: 'number', initial: 300, min: 0, max: 500, step: 1 },
      ],
      derived: [],
      elements: [
        {
          kind: 'columns',
          columns: [
            [
              {
                kind: 'value',
                label: '主结果一',
                source: { kind: 'state', id: 'v1' },
                emphasis: 'primary',
              },
            ],
            [
              {
                kind: 'value',
                label: '主结果二',
                source: { kind: 'state', id: 'v2' },
                emphasis: 'primary',
              },
            ],
          ],
        },
        {
          kind: 'value',
          label: '超出上限的主结果三',
          source: { kind: 'state', id: 'v3' },
          emphasis: 'primary',
        },
      ],
    };

    const host = mount(doc);
    const root = shadow(host);

    const values = root.querySelectorAll('.genui-value');
    expect(values).toHaveLength(3);

    // 前两个获得 primary，第三个为普通
    expect(values[0].classList.contains('genui-value-primary')).toBe(true);
    expect(values[1].classList.contains('genui-value-primary')).toBe(true);
    expect(values[2].classList.contains('genui-value-primary')).toBe(false);
  });

  it('原始 JSON 切换与展开/收起均正常运作', async () => {
    const onToggleRaw = vi.fn();
    const doc: GenuiV3Document = {
      type: 'genui',
      version: 3,
      title: '切换功能回归',
      state: [],
      derived: [],
      elements: [{ kind: 'text', value: '可见正文' }],
    };

    const host = mount(doc, { onToggleRaw });
    const root = shadow(host);

    // 原始 JSON 切换
    const toggleBtn = root.querySelector<HTMLButtonElement>('.genui-card-toggle');
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn?.textContent).toBe('查看原始 JSON');

    fireEvent.click(toggleBtn!);
    await flushUi();

    expect(onToggleRaw).toHaveBeenCalledWith(true);
    expect(toggleBtn?.textContent).toBe('收起原始 JSON');

    fireEvent.click(toggleBtn!);
    await flushUi();
    expect(onToggleRaw).toHaveBeenCalledWith(false);
    expect(toggleBtn?.textContent).toBe('查看原始 JSON');

    // 展开/收起
    const expandBtn = root.querySelector<HTMLButtonElement>('.genui-card-expand');
    expect(expandBtn).not.toBeNull();
    expect(expandBtn?.textContent).toBe('收起界面');
    expect(root.querySelector('.genui-card-body')?.hasAttribute('hidden')).toBe(false);

    fireEvent.click(expandBtn!);
    await flushUi();
    expect(root.querySelector('.genui-card-body')?.hasAttribute('hidden')).toBe(true);
    expect(expandBtn?.textContent).toBe('展开查看');

    fireEvent.click(expandBtn!);
    await flushUi();
    expect(root.querySelector('.genui-card-body')?.hasAttribute('hidden')).toBe(false);
    expect(expandBtn?.textContent).toBe('收起界面');
  });

  it('v5 场景示例文档（包含 preference-v5）挂载并渲染 columns-container', () => {
    const raw = readFileSync(resolve(process.cwd(), 'docs/examples/preference-v5.json'), 'utf8');
    const parsed = parseGenui(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const host = mount(parsed.document as GenuiV5Document);
    const root = shadow(host);

    const containers = root.querySelectorAll('.genui-columns-container');
    expect(containers.length).toBeGreaterThanOrEqual(2);

    const cols3 = root.querySelector('.genui-columns[data-columns="3"]');
    expect(cols3).not.toBeNull();
  });
});
