import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGenui } from '../../src/protocol/validate';
import type { GenuiV3Document } from '../../src/protocol/types';

/**
 * 阶段 5：文档示例可用性回归。
 *
 * docs/examples 下的示例是提示词与产品验收的参照物。示例一旦失效，
 * 模型照抄会直接触发回退，因此每个 JSON 都必须通过完整协议校验。
 */

const EXAMPLES_DIR = join(process.cwd(), 'docs', 'examples');
const files = readdirSync(EXAMPLES_DIR).filter((name) => name.endsWith('.json'));

function load(name: string): GenuiV3Document {
  const result = parseGenui(readFileSync(join(EXAMPLES_DIR, name), 'utf8'));
  expect(result.ok, `${name} 应通过协议校验：${result.ok ? '' : `${result.code} ${result.detail}`}`).toBe(true);
  if (!result.ok) throw new Error(name);
  return result.document as GenuiV3Document;
}

describe('docs/examples 示例文档', () => {
  it('目录中至少包含三个 v3 场景示例', () => {
    expect(files).toEqual(expect.arrayContaining(['parabola-v3.json', 'shopping-comparison-v3.json', 'budget-v3.json']));
  });

  it.each(files)('%s 能通过完整协议校验', (name) => {
    const document = load(name);
    expect(document.type).toBe('genui');
    expect([1, 2, 3]).toContain(document.version);
  });

  it('抛物线示例覆盖折线与退化提示', () => {
    const document = load('parabola-v3.json');
    expect(document.version).toBe(3);
    const kinds = document.elements.map((element) => element.kind);
    expect(kinds).toContain('section');
    expect(JSON.stringify(document)).toContain('"chartType":"line"');
    expect(JSON.stringify(document)).toContain('一次函数');
  });

  it('选购比较示例覆盖预算排名、缺失数据与无候选状态', () => {
    const document = load('shopping-comparison-v3.json');
    const table = document.elements.find((element) => element.kind === 'table');
    expect(table?.kind).toBe('table');
    const serialized = JSON.stringify(document);
    expect(serialized).toContain('预算内');
    expect(serialized).toContain('资料不完整');
    expect(serialized).toContain('笔记本 D');
    expect(serialized).toContain('没有符合预算的候选');
    expect(document.elements.some((element) => element.kind === 'chart')).toBe(true);
  });

  it('预算示例覆盖柱状图、饼图、表格与超支提示', () => {
    const document = load('budget-v3.json');
    const charts = document.elements.filter((element) => element.kind === 'chart');
    expect(charts.map((chart) => (chart.kind === 'chart' ? chart.chartType : ''))).toEqual(
      expect.arrayContaining(['bar', 'pie']),
    );
    expect(document.elements.some((element) => element.kind === 'table')).toBe(true);
    expect(JSON.stringify(document)).toContain('预算超支');
  });
});
