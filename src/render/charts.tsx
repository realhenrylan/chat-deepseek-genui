import type { ChartElement, ChartItem, ChartSeries } from '../protocol/types';
import { lookupExpression, type CompositeEvaluation } from '../runtime/evaluate';
import { formatNumber } from './format';

/**
 * 图表视图（v3）：柱状、折线、饼图。
 *
 * 只消费运行时预先求值的结果（lookupExpression），渲染阶段不做计算；
 * 图形同时提供「查看数据」表格，保证数值不依赖颜色或视觉位置可读。
 * SVG 仅使用本地形状与颜色，不含远程资源或脚本。
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

interface EvaluatedItem {
  label: string;
  value?: number;
  error?: string;
  color: string;
}

type ItemChart = Extract<ChartElement, { items: ChartItem[] }>;
type LineChartElement = Extract<ChartElement, { chartType: 'line' }>;

function evaluateItems(element: ItemChart, evaluation: CompositeEvaluation): EvaluatedItem[] {
  return element.items.map((item, index) => {
    const result = lookupExpression(evaluation, item.value);
    return result.ok
      ? { label: item.label, value: result.value, color: seriesColor(undefined, index) }
      : { label: item.label, error: result.error, color: seriesColor(undefined, index) };
  });
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

function BarChart({ element, evaluation }: {
  element: ItemChart;
  evaluation: CompositeEvaluation;
}) {
  const items = evaluateItems(element, evaluation);
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

function evaluateSeries(series: ChartSeries[], evaluation: CompositeEvaluation): {
  series: Array<{ label: string; color: string; points: XYPoint[]; error?: string }>;
  warnings: string[];
} {
  const warnings: string[] = [];
  return {
    series: series.map((item, index) => {
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
        color: seriesColor(item.color, index),
        points: error ? [] : points.sort((left, right) => left.x - right.x),
        ...(error ? { error } : {}),
      };
    }),
    warnings,
  };
}

function LineChart({ element, evaluation }: {
  element: LineChartElement;
  evaluation: CompositeEvaluation;
}) {
  const evaluated = evaluateSeries(element.series, evaluation);
  const points = evaluated.series.flatMap((item) => item.points);
  const width = 360;
  const height = 190;
  const plot = { left: 48, right: 12, top: 14, bottom: 44 };
  const innerWidth = width - plot.left - plot.right;
  const innerHeight = height - plot.top - plot.bottom;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
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

  return (
    <div className="genui-chart-body">
      <WarningList messages={evaluated.warnings} />
      {points.length === 0 ? (
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
          <line className="genui-chart-axis" x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.top + innerHeight} />
          <line className="genui-chart-axis" x1={plot.left} x2={width - plot.right} y1={plot.top + innerHeight} y2={plot.top + innerHeight} />
          <text className="genui-chart-axis-label" x={plot.left} y={plot.top + innerHeight + 14}>{formatNumber(xMin)}</text>
          <text className="genui-chart-axis-label" x={width - plot.right} y={plot.top + innerHeight + 14} textAnchor="end">{formatNumber(xMax)}</text>
          {element.xLabel ? (
            <text className="genui-chart-axis-title" x={plot.left + innerWidth / 2} y={height - 8} textAnchor="middle">{element.xLabel}</text>
          ) : null}
          {evaluated.series.map((item) => item.points.length > 0 ? (
            <g key={item.label}>
              <polyline
                className="genui-line-path"
                points={item.points.map((point) => `${scaleX(point.x)},${scaleY(point.y)}`).join(' ')}
                fill="none"
                stroke={item.color}
              />
              {item.points.map((point) => (
                <circle key={point.x} cx={scaleX(point.x)} cy={scaleY(point.y)} r={2.5} fill={item.color} />
              ))}
            </g>
          ) : null)}
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
              const point = item.points.find((candidate) => candidate.x === x);
              return point ? formatNumber(point.y) : '—';
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

function PieChart({ element, evaluation }: {
  element: ItemChart;
  evaluation: CompositeEvaluation;
}) {
  const items = evaluateItems(element, evaluation);
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

function isItemChart(element: ChartElement): element is ItemChart {
  return element.chartType === 'bar' || element.chartType === 'pie';
}

export function ChartElementView({ element, evaluation }: {
  element: ChartElement;
  evaluation: CompositeEvaluation;
}) {
  return (
    <figure className="genui-chart">
      {element.title ? <figcaption className="genui-chart-title">{element.title}</figcaption> : null}
      {isItemChart(element) ? (
        element.chartType === 'bar' ? (
          <BarChart element={element} evaluation={evaluation} />
        ) : (
          <PieChart element={element} evaluation={evaluation} />
        )
      ) : (
        <LineChart element={element} evaluation={evaluation} />
      )}
    </figure>
  );
}

