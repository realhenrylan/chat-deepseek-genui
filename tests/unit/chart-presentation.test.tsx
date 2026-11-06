import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChartElementView, type AnyChartElement } from '../../src/render/charts';
import { evaluateComposite } from '../../src/runtime/evaluate';
import type { GenuiV3Document, GenuiV3Element } from '../../src/protocol/types';

const C = (value: number) => ({ op: 'const' as const, value });
const stateValue = { op: 'state' as const, id: 'amount' };
function chartView(element: GenuiV3Element, amount = 10) {
  const document: GenuiV3Document = {
    type: 'genui', version: 3,
    state: [{ id: 'amount', label: '金额', kind: 'number', initial: 10, min: 0, max: 100, step: 1 }],
    derived: [], elements: [element],
  };
  return <ChartElementView element={element as AnyChartElement} evaluation={evaluateComposite(document, { amount })} />;
}

describe('图表外观和数据快照', () => {
  it('柱图随同一快照更新图形与数值，并说明负值', () => {
    const chart: GenuiV3Element = { kind: 'chart', chartType: 'bar', items: [
      { label: '动态', value: stateValue }, { label: '负数', value: C(-20) },
    ] };
    const { container, rerender } = render(chartView(chart));
    expect(container.querySelector<HTMLElement>('.genui-bar-fill')?.style.width).toBe('50%');
    expect(within(container.querySelector('.genui-chart-data') as HTMLElement).getByText('10')).toBeTruthy();
    expect(container.textContent).toContain('柱长表示绝对值');
    rerender(chartView(chart, 20));
    expect(container.querySelector<HTMLElement>('.genui-bar-fill')?.style.width).toBe('100%');
    expect(within(container.querySelector('.genui-chart-data') as HTMLElement).getAllByText('20').length).toBeGreaterThan(0);
  });

  it('饼图保留零值、负值和错误提示，数据表显示未计入', () => {
    const chart: GenuiV3Element = { kind: 'chart', chartType: 'pie', items: [
      { label: '正数', value: C(10) }, { label: '零', value: C(0) }, { label: '负数', value: C(-2) },
      { label: '错误', value: { op: 'divide', left: C(1), right: C(0) } },
    ] };
    const { container } = render(chartView(chart));
    expect(container.textContent).toContain('非正值不计入饼图');
    expect(container.textContent).toContain('错误');
    expect(container.querySelectorAll('.genui-pie-chart circle')).toHaveLength(1);
    expect(container.querySelectorAll('.genui-chart-data tbody tr')).toHaveLength(4);
    expect(container.querySelectorAll('.genui-chart-data tbody tr')[1].textContent).toContain('—');
  });

  it('全零饼图有明确反馈且保留原始数据', () => {
    const chart: GenuiV3Element = { kind: 'chart', chartType: 'pie', items: [{ label: '零', value: C(0) }] };
    const { container } = render(chartView(chart));
    expect(container.textContent).toContain('数值需大于 0');
    expect(container.querySelector('.genui-chart-data tbody')?.textContent).toContain('0');
  });
});
