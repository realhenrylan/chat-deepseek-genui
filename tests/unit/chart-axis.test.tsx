import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChartElementView, type AnyChartElement } from '../../src/render/charts';
import { evaluateComposite } from '../../src/runtime/evaluate';
import type {
  ChartFunctionSeries,
  FunctionExpression,
  GenuiV4Document,
  GenuiV4Element,
  NumericExpression,
} from '../../src/protocol/types';

/**
 * v4：折线图坐标轴与数据坐标一致。
 *
 * x=0 / y=0 落在视口内时坐标轴必须画在数据零点上（而不是绘图区边缘），
 * 零点不可见时才退回绘图区边缘。布局常量：width 360 / height 190，
 * plot = { left: 48, right: 12, top: 14, bottom: 44 } → 绘图区 x∈[48,348]，y∈[14,146]。
 */

const X: FunctionExpression = { op: 'x' };
const C = (value: number): NumericExpression => ({ op: 'const', value });
/** y = x + 2（平移示例曲线）。 */
const ADD_SHIFT: FunctionExpression = { op: 'add', left: X, right: C(2) };

function v4Document(chart: GenuiV4Element): GenuiV4Document {
  return {
    type: 'genui',
    version: 4,
    state: [{ id: 'shift', label: '平移', kind: 'number', initial: 0, min: -10, max: 10, step: 1 }],
    derived: [],
    elements: [chart],
  };
}

function functionSeries(
  expression: FunctionExpression,
  domain?: ChartFunctionSeries['function']['domain'],
): ChartFunctionSeries {
  return { label: '曲线', function: { expression, samples: 21, ...(domain ? { domain } : {}) } };
}

describe('genui-chart 坐标轴与数据坐标一致', () => {
  it('x=0/y=0 可见时坐标轴画在数据零点（v4 函数曲线）', () => {
    const chart = {
      kind: 'chart' as const,
      chartType: 'line' as const,
      series: [functionSeries(X)],
    } as unknown as GenuiV4Element;
    const document = v4Document(chart);
    const element = document.elements[0];
    const evaluation = evaluateComposite(document, { shift: 0 });

    const { container } = render(<ChartElementView element={element as AnyChartElement} evaluation={evaluation} />);
    const axes = container.querySelectorAll<SVGLineElement>('line.genui-chart-axis');
    expect(axes).toHaveLength(2);
    // 视口 [-10,10]×[-10,10]（含 8% 边距）：scaleX(0)=198、scaleY(0)=80，
    // 两根轴都必须落在绘图区内部且通过数据零点。
    const verticalX = Number(axes[0].getAttribute('x1'));
    const horizontalY = Number(axes[1].getAttribute('y1'));
    expect(verticalX).toBeGreaterThan(48);
    expect(verticalX).toBeLessThan(348);
    expect(horizontalY).toBeGreaterThan(14);
    expect(horizontalY).toBeLessThan(146);
    expect(verticalX).toBeCloseTo(198, 9);
    expect(horizontalY).toBeCloseTo(80, 9);
    // 竖轴是一条竖线、横轴是一条横线。
    expect(axes[0].getAttribute('x2')).toBe(axes[0].getAttribute('x1'));
    expect(axes[1].getAttribute('y2')).toBe(axes[1].getAttribute('y1'));
  });

  it('零点不可见时坐标轴退回绘图区边缘', () => {
    // y = x+2 ≥ 4，定义域 [2,6]：x=0 与 y=0 都在视口外。
    const chart = {
      kind: 'chart' as const,
      chartType: 'line' as const,
      series: [functionSeries(ADD_SHIFT, { start: C(2), end: C(6) })],
    } as unknown as GenuiV4Element;
    const document = v4Document(chart);
    const element = document.elements[0];
    const evaluation = evaluateComposite(document, { shift: 0 });

    const { container } = render(<ChartElementView element={element as AnyChartElement} evaluation={evaluation} />);
    const axes = container.querySelectorAll<SVGLineElement>('line.genui-chart-axis');
    expect(axes).toHaveLength(2);
    expect(Number(axes[0].getAttribute('x1'))).toBe(48);
    expect(Number(axes[0].getAttribute('x2'))).toBe(48);
    expect(Number(axes[1].getAttribute('y1'))).toBe(146);
    expect(Number(axes[1].getAttribute('y2'))).toBe(146);
  });
});
