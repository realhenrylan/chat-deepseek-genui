import type {
  ChartElement,
  ChartElementV4,
  ChartFunctionSeries,
  ChartItem,
  ChartSeries,
  GenuiBasis,
  GenuiSource,
  ModelChartElement,
} from '../protocol/types';
import {
  basisKeyForChartItem,
  basisKeyForChartSeries,
  basisKeyForElement,
} from '../protocol/provenance';
import {
  lookupExpression,
  lookupFunctionSeries,
  lookupModel,
  type CompositeEvaluation,
} from '../runtime/evaluate';
import { formatNumber } from './format';
import { BasisBadge } from './provenance';

/**
 * 图表视图（v3/v4/v5）：柱状、折线、饼图。
 *
 * 只消费运行时预先求值的结果（lookupExpression / lookupFunctionSeries /
 * 模型快照），渲染阶段不做计算；图形同时提供「查看数据」表格，保证数值
 * 不依赖颜色或视觉位置可读。v4 折线新增函数曲线系列：曲线由采样点
 * Hermite 平滑连接，不绘制样本点圆标（离散系列保持原样）。v5 柱状/饼图
 * 可直接读取语义模型生成的 chartItems。
 */

const PALETTE = [
  '#3988ff',
  '#2f9e6e',
  '#d97706',
  '#c2413a',
  '#7c5cff',
  '#0f8a8a',
  '#b45309',
  '#8b5cf6',
] as const;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function seriesColor(color: string | undefined, index: number): string {
  return color && HEX_COLOR.test(color) ? color : PALETTE[index % PALETTE.length]!;
}

export type AnyChartElement = ChartElement | ChartElementV4 | ModelChartElement;

interface EvaluatedItem {
  label: string;
  value?: number;
  error?: string;
  color: string;
}

type ItemChart = Extract<ChartElement | ChartElementV4, { items: ChartItem[] }>;
type LineChartElement = Extract<ChartElement | ChartElementV4, { chartType: 'line' }>;
type LineSeries = ChartSeries | ChartFunctionSeries;

function evaluateItems(element: ItemChart, evaluation: CompositeEvaluation): EvaluatedItem[] {
  return element.items.map((item, index) => {
    const result = lookupExpression(evaluation, item.value);
    return result.ok
      ? { label: item.label, value: result.value, color: seriesColor(undefined, index) }
      : { label: item.label, error: result.error, color: seriesColor(undefined, index) };
  });
}

function evaluateModelItems(
  element: ModelChartElement,
  evaluation: CompositeEvaluation,
): EvaluatedItem[] {
  const model = lookupModel(evaluation, element.source.model);
  if (!model) {
    return [{ label: '数据', error: '模型未求值', color: seriesColor(undefined, 0) }];
  }
  if (!model.ok) {
    return [{ label: '数据', error: model.error ?? '模型计算失败', color: seriesColor(undefined, 0) }];
  }
  return model.chartItems.map((item, index) => ({
    label: item.label,
    value: item.value,
    color: seriesColor(undefined, index),
  }));
}

function isModelChart(element: AnyChartElement): element is ModelChartElement {
  return 'source' in element;
}

function WarningList({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <p className="genui-chart-warning" role="status">
      {messages.length === 1 ? messages[0] : `${messages.length} 项数据无法计算：${messages.join('；')}`}
    </p>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: Array<Array<string>> }) {
  return (
    <details className="genui-chart-data">
      <summary>查看数据</summary>
      <table>
        <thead>
          <tr>{head.map((label) => <th key={label} scope="col">{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function BarChart({ element, items }: {
  element: { title?: string; legend?: boolean };
  items: EvaluatedItem[];
}) {
  const values = items.flatMap((item) => (item.value === undefined ? [] : [Math.abs(item.value)]));
  const max = values.length > 0 ? Math.max(...values) : 0;
  const warnings = items
    .filter((item) => item.error !== undefined)
    .map((item) => `${item.label}：${item.error}`);

  return (
    <div className="genui-chart-body">
      <WarningList messages={warnings} />
      <div className="genui-bar-chart" role="list" aria-label={element.title ? `${element.title}（柱状图）` : '柱状图'}>
        {items.map((item) => {
          const width = item.value !== undefined && max > 0 ? (Math.abs(item.value) / max) * 100 : 0;
          return (
            <div className="genui-bar-row" role="listitem" key={item.label}>
              <span className="genui-bar-label">{item.label}</span>
              <span className="genui-bar-track">
                <span
                  className={`genui-bar-fill${item.value !== undefined && item.value < 0 ? ' genui-bar-negative' : ''}`}
                  style={{ width: `${width}%`, background: item.color }}
                />
              </span>
              <span className="genui-bar-value">
                {item.value !== undefined ? formatNumber(item.value) : '—'}
              </span>
            </div>
          );
        })}
      </div>
      {element.legend ? (
        <ul className="genui-legend" aria-label="图例">
          {items.map((item) => (
            <li key={item.label}>
              <span className="genui-legend-swatch" style={{ background: item.color }} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
      <DataTable
        head={['名称', '数值']}
        rows={items.map((item) => [item.label, item.value !== undefined ? formatNumber(item.value) : '—'])}
      />
    </div>
  );
}

interface XYPoint {
  x: number;
  y: number;
}

interface CubicSegment {
  start: XYPoint;
  control1: XYPoint;
  control2: XYPoint;
  end: XYPoint;
}

interface RenderedDiscreteSeries {
  label: string;
  color: string;
  kind: 'discrete';
  smooth: boolean;
  points: XYPoint[];
  error?: string;
}

interface RenderedFunctionSeries {
  label: string;
  color: string;
  kind: 'function';
  /** 连续非空采样段；null 样本导致断开。 */
  runs: XYPoint[][];
  error?: string;
}

type RenderedSeries = RenderedDiscreteSeries | RenderedFunctionSeries;

function evaluateSeries(series: LineSeries[], evaluation: CompositeEvaluation): {
  series: RenderedSeries[];
  warnings: string[];
} {
  const warnings: string[] = [];
  return {
    series: series.map((item, index): RenderedSeries => {
      const color = seriesColor(item.color, index);
      if ('function' in item) {
        const result = lookupFunctionSeries(evaluation, item.function);
        if (!result.ok) {
          const error = `${item.label}：${result.error}`;
          warnings.push(error);
          return { label: item.label, color, kind: 'function', runs: [], error };
        }
        // 把采样结果切成非空连续段；null 样本(求值失败)渲染为折线断裂。
        const runs: XYPoint[][] = [];
        let current: XYPoint[] | null = null;
        result.xs.forEach((x, sampleIndex) => {
          const y = result.ys[sampleIndex];
          if (typeof y !== 'number') {
            current = null;
            return;
          }
          const point = { x, y };
          if (current) {
            current.push(point);
          } else {
            current = [point];
            runs.push(current);
          }
        });
        if (result.dropped > 0) {
          warnings.push(
            `${item.label}：${result.dropped === 1 ? '1 个采样点' : `${result.dropped} 个采样点`}无法计算`,
          );
        }
        if (!result.zeroFound) {
          // zero 特征扩展后仍未覆盖零点（无实根或相切零点），以提示代替沉默。
          warnings.push(`${item.label}：未找到零点（已尝试扩展视口）`);
        }
        return { label: item.label, color, kind: 'function', runs };
      }
      const points: XYPoint[] = [];
      let error: string | undefined;
      for (const point of item.points) {
        const result = lookupExpression(evaluation, point.y);
        if (result.ok) {
          points.push({ x: point.x, y: result.value });
        } else {
          error = `${item.label}（x=${formatNumber(point.x)}）：${result.error}`;
          break;
        }
      }
      if (error) warnings.push(error);
      return {
        label: item.label,
        color,
        kind: 'discrete',
        smooth: item.smooth === true,
        points: error ? [] : points.sort((left, right) => left.x - right.x),
        ...(error ? { error } : {}),
      };
    }),
    warnings,
  };
}

/**
 * 用 cubic Hermite 插值连接连续函数的采样点。
 * 内点导数按相邻区间加权估算；端点用三点公式。二次函数的导数因此可被精确恢复，
 * SVG 三次曲线会精确通过每个采样点，也能保持顶点处的平滑度。
 */
function createSmoothSegments(points: XYPoint[]): CubicSegment[] | null {
  if (points.length < 2) return [];

  const widths = points.slice(1).map((point, index) => point.x - points[index]!.x);
  const slopes = points.slice(1).map((point, index) => (point.y - points[index]!.y) / widths[index]!);
  const tangents = new Array<number>(points.length);

  if (points.length === 2) {
    tangents[0] = slopes[0]!;
    tangents[1] = slopes[0]!;
  } else {
    const firstWidth = widths[0]!;
    const nextWidth = widths[1]!;
    tangents[0] = slopes[0]! - firstWidth * (slopes[1]! - slopes[0]!) / (firstWidth + nextWidth);

    const lastWidth = widths[widths.length - 1]!;
    const previousWidth = widths[widths.length - 2]!;
    tangents[points.length - 1] = slopes[slopes.length - 1]!
      + lastWidth * (slopes[slopes.length - 1]! - slopes[slopes.length - 2]!)
        / (lastWidth + previousWidth);

    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = widths[index - 1]!;
      const next = widths[index]!;
      tangents[index] = (slopes[index - 1]! * next + slopes[index]! * previous) / (previous + next);
    }
  }

  const segments = points.slice(1).map((end, index): CubicSegment => {
    const start = points[index]!;
    const width = widths[index]!;
    return {
      start,
      control1: { x: start.x + width / 3, y: start.y + width * tangents[index]! / 3 },
      control2: { x: end.x - width / 3, y: end.y - width * tangents[index + 1]! / 3 },
      end,
    };
  });

  return segments.every((segment) =>
    [segment.control1.x, segment.control1.y, segment.control2.x, segment.control2.y].every(Number.isFinite),
  ) ? segments : null;
}

function createSmoothPath(
  segments: CubicSegment[],
  scaleX: (value: number) => number,
  scaleY: (value: number) => number,
): string {
  const first = segments[0]?.start;
  if (!first) return '';
  const start = `M ${scaleX(first.x)} ${scaleY(first.y)}`;
  return `${start} ${segments.map((segment) =>
    `C ${scaleX(segment.control1.x)} ${scaleY(segment.control1.y)} ${scaleX(segment.control2.x)} ${scaleY(segment.control2.y)} ${scaleX(segment.end.x)} ${scaleY(segment.end.y)}`,
  ).join(' ')}`;
}

function LineChart({ element, evaluation }: {
  element: LineChartElement;
  evaluation: CompositeEvaluation;
}) {
  const evaluated = evaluateSeries(element.series, evaluation);
  const smoothSegments = evaluated.series.map((item) =>
    item.kind === 'discrete' && item.smooth ? createSmoothSegments(item.points) : null,
  );
  // 函数曲线系列按非空连续段分别做 Hermite 平滑（无样本点圆标）。
  const functionRunSegments = evaluated.series.map((item) =>
    item.kind === 'function' ? item.runs.map((run) => createSmoothSegments(run)) : null,
  );
  const width = 360;
  const height = 190;
  const plot = { left: 48, right: 12, top: 14, bottom: 44 };
  const innerWidth = width - plot.left - plot.right;
  const innerHeight = height - plot.top - plot.bottom;

  const points = evaluated.series.flatMap((item) =>
    item.kind === 'discrete' ? item.points : item.runs.flat(),
  );
  const controlYs = evaluated.series.flatMap((item, index) => {
    if (item.kind === 'function') {
      return (functionRunSegments[index] ?? [])
        .flatMap((segments) => segments ?? [])
        .flatMap((segment) => [segment.control1.y, segment.control2.y]);
    }
    return (smoothSegments[index] ?? [])
      .flatMap((segment: CubicSegment) => [segment.control1.y, segment.control2.y]);
  });
  const xs = points.map((point) => point.x);
  const ys = [
    ...points.map((point) => point.y),
    ...controlYs,
  ];
  let xMin = xs.length > 0 ? Math.min(...xs) : 0;
  let xMax = xs.length > 0 ? Math.max(...xs) : 1;
  let yMin = ys.length > 0 ? Math.min(...ys) : 0;
  let yMax = ys.length > 0 ? Math.max(...ys) : 1;
  if (xMin === xMax) {
    xMin -= 1;
    xMax += 1;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad;
  yMax += yPad;

  const scaleX = (x: number) => plot.left + ((x - xMin) / (xMax - xMin)) * innerWidth;
  const scaleY = (y: number) => plot.top + innerHeight - ((y - yMin) / (yMax - yMin)) * innerHeight;
  const ticks = [0, 0.5, 1].map((fraction) => ({
    y: scaleY(yMin + (yMax - yMin) * fraction),
    label: formatNumber(yMin + (yMax - yMin) * fraction),
  }));

  // 零点位于视口内时坐标轴画在数据坐标 x=0 / y=0；否则退回绘图区边缘。
  const xAxisY = yMin <= 0 && yMax >= 0 ? scaleY(0) : plot.top + innerHeight;
  const yAxisX = xMin <= 0 && xMax >= 0 ? scaleX(0) : plot.left;
  const drawable = evaluated.series.some((item) =>
    item.kind === 'discrete'
      ? item.points.length > 0
      : item.runs.some((run) => run.length > 0),
  );

  const renderDiscrete = (item: RenderedDiscreteSeries, index: number) => (item.points.length > 0 ? (
    <g key={item.label}>
      {smoothSegments[index] ? (
        <path
          className="genui-line-path"
          d={createSmoothPath(smoothSegments[index]!, scaleX, scaleY)}
          fill="none"
          stroke={item.color}
        />
      ) : (
        <polyline
          className="genui-line-path"
          points={item.points.map((point) => `${scaleX(point.x)},${scaleY(point.y)}`).join(' ')}
          fill="none"
          stroke={item.color}
        />
      )}
      {smoothSegments[index] ? null : item.points.map((point) => (
        <circle key={point.x} cx={scaleX(point.x)} cy={scaleY(point.y)} r={2.5} fill={item.color} />
      ))}
    </g>
  ) : null);

  return (
    <div className="genui-chart-body">
      <WarningList messages={evaluated.warnings} />
      {!drawable ? (
        <p className="genui-chart-empty">暂无可绘制的数据。</p>
      ) : (
        <svg
          className="genui-line-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={element.title ? `${element.title}（折线图）` : '折线图'}
        >
          {ticks.map((tick) => (
            <g key={tick.label}>
              <line className="genui-chart-grid" x1={plot.left} x2={width - plot.right} y1={tick.y} y2={tick.y} />
              <text className="genui-chart-axis-label" x={plot.left - 6} y={tick.y + 3} textAnchor="end">{tick.label}</text>
            </g>
          ))}
          <line className="genui-chart-axis" x1={yAxisX} x2={yAxisX} y1={plot.top} y2={plot.top + innerHeight} />
          <line className="genui-chart-axis" x1={plot.left} x2={width - plot.right} y1={xAxisY} y2={xAxisY} />
          <text className="genui-chart-axis-label" x={plot.left} y={plot.top + innerHeight + 14}>{formatNumber(xMin)}</text>
          <text className="genui-chart-axis-label" x={width - plot.right} y={plot.top + innerHeight + 14} textAnchor="end">{formatNumber(xMax)}</text>
          {element.xLabel ? (
            <text className="genui-chart-axis-title" x={plot.left + innerWidth / 2} y={height - 8} textAnchor="middle">{element.xLabel}</text>
          ) : null}
          {evaluated.series.map((item, index) => {
            if (item.kind === 'function') {
              if (item.runs.length === 0) return null;
              const segments = functionRunSegments[index] ?? [];
              return (
                <g key={item.label}>
                  {item.runs.map((run, runIndex) => {
                    const smooth = segments[runIndex];
                    if (smooth && smooth.length > 0) {
                      return (
                        <path
                          key={runIndex}
                          className="genui-line-path"
                          d={createSmoothPath(smooth, scaleX, scaleY)}
                          fill="none"
                          stroke={item.color}
                        />
                      );
                    }
                    return (
                      <polyline
                        key={runIndex}
                        className="genui-line-path"
                        points={run.map((point) => `${scaleX(point.x)},${scaleY(point.y)}`).join(' ')}
                        fill="none"
                        stroke={item.color}
                      />
                    );
                  })}
                </g>
              );
            }
            return renderDiscrete(item, index);
          })}
        </svg>
      )}
      {element.yLabel ? <p className="genui-chart-axis-title">{element.yLabel}</p> : null}
      {element.legend !== false ? (
        <ul className="genui-legend" aria-label="图例">
          {evaluated.series.map((item) => (
            <li key={item.label}>
              <span className="genui-legend-swatch" style={{ background: item.color }} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
      <DataTable
        head={['x', ...evaluated.series.map((item) => item.label)]}
        rows={Array.from(new Set(points.map((point) => point.x)))
          .sort((left, right) => left - right)
          .map((x) => [
            formatNumber(x),
            ...evaluated.series.map((item) => {
              const sample = item.kind === 'discrete'
                ? item.points.find((candidate) => candidate.x === x)
                : item.runs.flat().find((candidate) => candidate.x === x);
              return sample ? formatNumber(sample.y) : '—';
            }),
          ])}
      />
    </div>
  );
}

function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

function arcPath(cx: number, cy: number, radius: number, start: number, end: number): string {
  const from = polar(cx, cy, radius, start);
  const to = polar(cx, cy, radius, end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${from.x} ${from.y} A ${radius} ${radius} 0 ${largeArc} 1 ${to.x} ${to.y} Z`;
}

function PieChart({ element, items }: {
  element: { title?: string };
  items: EvaluatedItem[];
}) {
  const warnings = items
    .filter((item) => item.error !== undefined)
    .map((item) => `${item.label}：${item.error}`);
  const positive = items.filter((item): item is EvaluatedItem & { value: number } =>
    item.value !== undefined && item.value > 0,
  );
  const ignored = items.filter((item) => item.value !== undefined && item.value <= 0);
  if (ignored.length > 0) warnings.push('非正值不计入饼图');
  const total = positive.reduce((sum, item) => sum + item.value, 0);
  const size = 180;
  const radius = 76;
  const center = size / 2;

  const slices = positive.reduce<Array<EvaluatedItem & { value: number; start: number; end: number; sweep: number }>>(
    (accumulator, item) => {
      const start = accumulator.length > 0 ? accumulator[accumulator.length - 1]!.end : -Math.PI / 2;
      const sweep = total > 0 ? (item.value / total) * Math.PI * 2 : 0;
      accumulator.push({ ...item, start, end: start + sweep, sweep });
      return accumulator;
    },
    [],
  );

  return (
    <div className="genui-chart-body">
      <WarningList messages={warnings} />
      {total <= 0 ? (
        <p className="genui-chart-empty">暂无可绘制的数据（数值需大于 0）。</p>
      ) : (
        <svg
          className="genui-pie-chart"
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={element.title ? `${element.title}（饼图）` : '饼图'}
        >
          {slices.map((slice) => (
            slice.sweep >= Math.PI * 2 - 1e-9 ? (
              <circle key={slice.label} cx={center} cy={center} r={radius} fill={slice.color} />
            ) : (
              <path
                key={slice.label}
                d={arcPath(center, center, radius, slice.start, slice.end)}
                fill={slice.color}
                stroke="Canvas"
                strokeWidth={1}
              />
            )
          ))}
        </svg>
      )}
      <ul className="genui-legend" aria-label="图例">
        {items.map((item) => {
          // 占比只对实际绘制的正值计算；被排除的零值/负值显示为未计入。
          const share = item.value !== undefined && item.value > 0 && total > 0 ? (item.value / total) * 100 : undefined;
          return (
            <li key={item.label}>
              <span className="genui-legend-swatch" style={{ background: item.color }} aria-hidden="true" />
              {item.label}
              {share !== undefined ? ` · ${formatNumber(Math.round(share * 10) / 10)}%` : ''}
            </li>
          );
        })}
      </ul>
      <DataTable
        head={['名称', '数值', '占比']}
        rows={items.map((item) => {
          const share = item.value !== undefined && item.value > 0 && total > 0 ? (item.value / total) * 100 : undefined;
          return [
            item.label,
            item.value !== undefined ? formatNumber(item.value) : '—',
            share !== undefined ? `${formatNumber(Math.round(share * 10) / 10)}%` : '—',
          ];
        })}
      />
    </div>
  );
}

function isItemChart(element: AnyChartElement): element is ItemChart {
  return element.chartType === 'bar' || element.chartType === 'pie';
}

export function ChartElementView({ element, evaluation, sources, basis, basisPath, today }: {
  element: AnyChartElement;
  evaluation: CompositeEvaluation;
  sources?: readonly GenuiSource[];
  basis?: Readonly<Record<string, GenuiBasis>>;
  basisPath?: string;
  today?: string;
}) {
  const model = isModelChart(element);
  const items = model
    ? evaluateModelItems(element, evaluation)
    : isItemChart(element)
      ? evaluateItems(element, evaluation)
      : null;
  const showBasis = basis !== undefined && basisPath !== undefined && today !== undefined;
  const elementBasis = showBasis ? basis[basisKeyForElement(basisPath)] : undefined;
  const itemBases = showBasis && items !== null && isItemChart(element)
    ? element.items.map((item, index) => ({ label: item.label, basis: basis[basisKeyForChartItem(basisPath, index)] }))
    : [];
  const seriesBases = showBasis && items === null
    ? (element as LineChartElement).series.map((series, index) => ({
        label: series.label,
        basis: basis[basisKeyForChartSeries(basisPath, index)],
      }))
    : [];

  return (
    <figure className="genui-chart">
      {element.title ? <figcaption className="genui-chart-title">{element.title}</figcaption> : null}
      {items !== null ? (
        element.chartType === 'bar' ? (
          <BarChart element={element} items={items} />
        ) : (
          <PieChart element={element} items={items} />
        )
      ) : (
        <LineChart element={element as LineChartElement} evaluation={evaluation} />
      )}
      {elementBasis === undefined && itemBases.length === 0 && seriesBases.length === 0 ? null : (
        <div className="genui-chart-basis">
          {elementBasis === undefined ? null : (
            <span className="genui-chart-basis-item">
              <span className="genui-chart-basis-label">图表整体</span>
              <BasisBadge basis={elementBasis} sources={sources} today={today} />
            </span>
          )}
          {itemBases.map(({ label, basis: itemBasis }) =>
            itemBasis === undefined ? null : (
              <span className="genui-chart-basis-item" key={`item-${label}`}>
                <span className="genui-chart-basis-label">{label}</span>
                <BasisBadge basis={itemBasis} sources={sources} today={today} />
              </span>
            ),
          )}
          {seriesBases.map(({ label, basis: seriesBasis }) =>
            seriesBasis === undefined ? null : (
              <span className="genui-chart-basis-item" key={`series-${label}`}>
                <span className="genui-chart-basis-label">{label}</span>
                <BasisBadge basis={seriesBasis} sources={sources} today={today} />
              </span>
            ),
          )}
        </div>
      )}
    </figure>
  );
}

