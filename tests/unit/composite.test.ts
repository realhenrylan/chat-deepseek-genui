import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type {
  Condition,
  GenuiV3Document,
  NumericExpression,
} from '../../src/protocol/types';
import { mountCard, type MountedCard } from '../../src/render/mount';

/**
 * 阶段 5：v3 组合卡片渲染与交互。
 *
 * 覆盖条件说明、图表（柱/折/饼 + 数据视图）、表格（排序/筛选/条件行/
 * 空状态/横向滚动）、两列布局、条件失败提示与重置。
 */

const C = (value: number): NumericExpression => ({ op: 'const', value });
const S = (id: string): NumericExpression => ({ op: 'state', id });
const GT = (left: NumericExpression, right: NumericExpression): Condition => ({
  op: 'num-gt',
  left,
  right,
});

const AMOUNT_STATE = {
  id: 'amount',
  label: '金额',
  kind: 'number' as const,
  initial: 10,
  min: 0,
  max: 100,
  step: 1,
  unit: '元',
};

function v3(elements: GenuiV3Document['elements'], overrides: Partial<GenuiV3Document> = {}): GenuiV3Document {
  return {
    type: 'genui',
    version: 3,
    title: '组合卡片',
    state: [AMOUNT_STATE],
    derived: [],
    elements,
    ...overrides,
  };
}

let mounted: MountedCard | null = null;

function mount(doc: GenuiV3Document): HTMLElement {
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

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  globalThis.document.body.replaceChildren();
});

describe('v3 组合卡片', () => {
  it('按条件显示/隐藏说明文字，并随状态更新', async () => {
    const host = mount(
      v3([
        { kind: 'slider', bind: 'amount' },
        { kind: 'note', text: '金额超过 15 元', visibleIf: GT(S('amount'), C(15)) },
        { kind: 'text', value: '基础说明' },
      ]),
    );
    const root = shadow(host);
    expect(root.querySelector('.genui-note')).toBeNull();
    expect(root.textContent).toContain('基础说明');

    fireEvent.change(root.querySelector('input[type="range"]')!, { target: { value: '20' } });
    await flushUi();

    const note = root.querySelector('.genui-note');
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain('金额超过 15 元');
  });

  it('条件无法计算时照常显示内容并给出显式提示', () => {
    const broken: Condition = { op: 'num-gt', left: S('missing'), right: C(0) };
    const host = mount(
      v3([
        { kind: 'text', value: '仍应显示的文字', visibleIf: broken },
        { kind: 'note', text: '仍应显示的说明', visibleIf: broken },
      ]),
    );
    const root = shadow(host);

    expect(root.textContent).toContain('仍应显示的文字');
    expect(root.textContent).toContain('仍应显示的说明');
    const alerts = root.querySelectorAll('.genui-condition-error');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]?.getAttribute('role')).toBe('status');
    expect(alerts[0]?.textContent).toContain('显示条件无法计算');
  });

  it('渲染柱状图、折线图、饼图，并各自提供查看数据入口', () => {
    const host = mount(
      v3([
        {
          kind: 'chart',
          chartType: 'bar',
          title: '支出柱状图',
          legend: true,
          items: [
            { label: '房租', value: C(30) },
            { label: '餐饮', value: C(10) },
          ],
        },
        {
          kind: 'chart',
          chartType: 'line',
          title: '趋势折线图',
          xLabel: '月份',
          yLabel: '金额',
          series: [
            {
              label: '实际',
              points: [
                { x: 1, y: C(10) },
                { x: 2, y: C(30) },
              ],
            },
          ],
        },
        {
          kind: 'chart',
          chartType: 'pie',
          title: '构成饼图',
          legend: true,
          items: [
            { label: '房租', value: C(30) },
            { label: '餐饮', value: C(10) },
          ],
        },
      ]),
    );
    const root = shadow(host);

    expect(root.querySelectorAll('figure.genui-chart')).toHaveLength(3);
    expect(root.querySelectorAll('.genui-bar-row')).toHaveLength(2);
    expect(root.querySelector('.genui-line-chart')?.getAttribute('role')).toBe('img');
    expect(root.querySelector('.genui-line-chart')?.getAttribute('aria-label')).toContain('折线图');
    expect(root.querySelector('.genui-pie-chart')?.getAttribute('role')).toBe('img');
    expect(root.querySelector('.genui-legend')?.textContent).toContain('房租');
    expect(root.textContent).toContain('查看数据');

    const details = root.querySelectorAll('details.genui-chart-data');
    expect(details).toHaveLength(3);
    expect(details[0]?.textContent).toContain('30');
  });

  it('表格支持初始排序、点击列头切换排序与筛选', async () => {
    const host = mount(
      v3([
        {
          kind: 'table',
          title: '预算明细',
          sortable: true,
          initialSort: { key: 'amount', dir: 'desc' },
          columns: [
            { key: 'name', label: '项目' },
            { key: 'amount', label: '金额', numeric: true, unit: '元' },
          ],
          rows: [
            { cells: { name: '房租', amount: C(30) } },
            { cells: { name: '餐饮', amount: C(10) } },
            { cells: { name: '娱乐', amount: C(20) } },
          ],
        },
      ]),
    );
    const root = shadow(host);
    const amounts = () => Array.from(root.querySelectorAll('tbody tr')).map((row) => row.textContent);

    expect(amounts()).toEqual(['房租30 元', '娱乐20 元', '餐饮10 元']);
    expect(root.querySelector('.genui-table-count')?.textContent).toBe('显示 3 / 3 行');

    const amountHeader = Array.from(root.querySelectorAll('th')).find((th) =>
      th.textContent?.includes('金额'),
    );
    expect(amountHeader?.getAttribute('aria-sort')).toBe('descending');

    fireEvent.click(amountHeader!.querySelector('button.genui-table-sort')!);
    await flushUi();
    expect(amounts()).toEqual(['餐饮10 元', '娱乐20 元', '房租30 元']);
    expect(amountHeader?.getAttribute('aria-sort')).toBe('ascending');

    const search = root.querySelector<HTMLInputElement>('.genui-table-filter input[type="search"]');
    expect(search).not.toBeNull();
    fireEvent.change(search!, { target: { value: '房租' } });
    await flushUi();
    expect(amounts()).toEqual(['房租30 元']);
    expect(root.querySelector('.genui-table-count')?.textContent).toBe('显示 1 / 3 行');

    fireEvent.change(search!, { target: { value: '不存在' } });
    await flushUi();
    expect(root.querySelector('.genui-table-empty')?.textContent).toBe('没有符合筛选条件的数据');
  });

  it('条件行按状态显示，宽表包在可聚焦的横向滚动容器中', async () => {
    const host = mount(
      v3(
        [
          {
            kind: 'select',
            bind: 'mode',
          },
          {
            kind: 'table',
            columns: [
              { key: 'name', label: '项目' },
              { key: 'amount', label: '金额', numeric: true },
            ],
            rows: [
              { cells: { name: '固定项', amount: C(10) } },
              { cells: { name: '可选项', amount: C(20) }, visibleIf: { op: 'state-eq', id: 'mode', value: 'full' } },
            ],
          },
        ],
        {
          state: [
            {
              id: 'mode',
              label: '模式',
              kind: 'select',
              initial: 'basic',
              options: [
                { label: '基础', value: 'basic' },
                { label: '完整', value: 'full' },
              ],
            },
          ],
        },
      ),
    );
    const root = shadow(host);
    const rows = () => root.querySelectorAll('tbody tr');
    expect(rows()).toHaveLength(1);

    fireEvent.change(root.querySelector('select.genui-select')!, { target: { value: 'full' } });
    await flushUi();
    expect(rows()).toHaveLength(2);

    const scroll = root.querySelector('.genui-table-scroll');
    expect(scroll?.getAttribute('role')).toBe('region');
    expect(scroll?.getAttribute('tabindex')).toBe('0');
    expect(scroll?.getAttribute('aria-label')).toContain('可横向滚动');
  });

  it('渲染两列布局与分区标题', () => {
    const host = mount(
      v3([
        {
          kind: 'section',
          title: '输入',
          children: [
            {
              kind: 'columns',
              columns: [
                [{ kind: 'text', value: '左列内容' }],
                [{ kind: 'text', value: '右列内容' }],
              ],
            },
          ],
        },
      ]),
    );
    const root = shadow(host);

    expect(root.querySelector('.genui-section-title')?.textContent).toBe('输入');
    const columns = root.querySelector('.genui-columns');
    expect(columns?.getAttribute('data-columns')).toBe('2');
    expect(root.querySelectorAll('.genui-column')).toHaveLength(2);
    expect(root.textContent).toContain('左列内容');
    expect(root.textContent).toContain('右列内容');
  });

  it('整张表格可由 visibleIf 条件显示或隐藏', async () => {
    const host = mount(
      v3([
        { kind: 'slider', bind: 'amount' },
        {
          kind: 'table',
          columns: [{ key: 'name', label: '项目' }],
          rows: [{ cells: { name: '条件表格内容' } }],
          visibleIf: GT(S('amount'), C(15)),
        },
      ]),
    );
    const root = shadow(host);
    expect(root.querySelector('.genui-table')).toBeNull();

    fireEvent.change(root.querySelector('input[type="range"]')!, { target: { value: '20' } });
    await flushUi();
    expect(root.querySelector('.genui-table')?.textContent).toContain('条件表格内容');
  });

  it('重置按钮把 v3 状态恢复为初始值', async () => {
    const host = mount(
      v3([
        { kind: 'slider', bind: 'amount' },
        { kind: 'note', text: '已超过 15', visibleIf: GT(S('amount'), C(15)) },
      ]),
    );
    const root = shadow(host);
    const slider = root.querySelector<HTMLInputElement>('input[type="range"]')!;

    fireEvent.change(slider, { target: { value: '20' } });
    await flushUi();
    expect(slider.value).toBe('20');
    expect(root.querySelector('.genui-note')).not.toBeNull();

    const reset = root.querySelector<HTMLButtonElement>('.genui-card-reset');
    expect(reset).not.toBeNull();
    fireEvent.click(reset!);
    await flushUi();

    expect(slider.value).toBe('10');
    expect(root.querySelector('.genui-note')).toBeNull();
  });
  it('列 key 为 constructor 且行缺少单元格时显示 — 且筛选不读取原型属性', async () => {
    const host = mount(
      v3([
        {
          kind: 'table',
          title: '缺失值',
          sortable: true,
          columns: [
            { key: 'name', label: '名称' },
            { key: 'constructor', label: '缺失值' },
          ],
          rows: [{ cells: { name: '甲' } }, { cells: { name: '乙' } }],
        },
      ]),
    );
    const root = shadow(host);
    const firstRowCells = () => root.querySelectorAll('tbody tr:first-child td');

    expect(firstRowCells()[1]?.textContent).toBe('—');

    const search = root.querySelector<HTMLInputElement>('.genui-table-filter input[type="search"]')!;
    fireEvent.change(search, { target: { value: '甲' } });
    await flushUi();

    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(root.querySelector('tbody tr')?.textContent).toContain('甲');
    expect(root.querySelector('.genui-table-count')?.textContent).toBe('显示 1 / 2 行');
  });

  it('重置清空表格筛选并恢复初始排序', async () => {
    const host = mount(
      v3([
        {
          kind: 'table',
          title: '预算明细',
          sortable: true,
          initialSort: { key: 'amount', dir: 'desc' },
          columns: [
            { key: 'name', label: '项目' },
            { key: 'amount', label: '金额', numeric: true, unit: '元' },
          ],
          rows: [
            { cells: { name: '房租', amount: C(30) } },
            { cells: { name: '餐饮', amount: C(10) } },
            { cells: { name: '娱乐', amount: C(20) } },
          ],
        },
      ]),
    );
    const root = shadow(host);
    const amounts = () => Array.from(root.querySelectorAll('tbody tr')).map((row) => row.textContent);

    const amountHeader = Array.from(root.querySelectorAll('th')).find((th) =>
      th.textContent?.includes('金额'),
    )!;
    fireEvent.click(amountHeader.querySelector('button.genui-table-sort')!);
    await flushUi();
    expect(amounts()).toEqual(['餐饮10 元', '娱乐20 元', '房租30 元']);

    const search = root.querySelector<HTMLInputElement>('.genui-table-filter input[type="search"]')!;
    fireEvent.change(search, { target: { value: '房租' } });
    await flushUi();
    expect(amounts()).toEqual(['房租30 元']);

    fireEvent.click(root.querySelector<HTMLButtonElement>('.genui-card-reset')!);
    await flushUi();

    const resetSearch = root.querySelector<HTMLInputElement>('.genui-table-filter input[type="search"]')!;
    expect(resetSearch.value).toBe('');
    expect(amounts()).toEqual(['房租30 元', '娱乐20 元', '餐饮10 元']);
    const resetHeader = Array.from(root.querySelectorAll('th')).find((th) =>
      th.textContent?.includes('金额'),
    );
    expect(resetHeader?.getAttribute('aria-sort')).toBe('descending');
  });

  it('饼图只对实际绘制的正值显示占比', () => {
    const host = mount(
      v3([
        {
          kind: 'chart',
          chartType: 'pie',
          title: '正负混合',
          items: [
            { label: '正值', value: C(100) },
            { label: '负值', value: C(-50) },
          ],
        },
      ]),
    );
    const root = shadow(host);

    expect(root.querySelector('.genui-legend')?.textContent).toContain('100%');
    expect(root.textContent).not.toContain('-50%');

    const dataRows = root.querySelectorAll('.genui-chart-data tbody tr');
    expect(dataRows[1]?.textContent).toContain('负值');
    expect(dataRows[1]?.textContent).toContain('—');
  });

});
