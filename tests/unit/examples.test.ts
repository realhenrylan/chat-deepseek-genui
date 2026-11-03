import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGenui } from '../../src/protocol/validate';
import type { GenuiDocument } from '../../src/protocol/types';

/**
 * 阶段 5：文档示例可用性回归。
 *
 * docs/examples 下的示例是提示词与产品验收的参照物。示例一旦失效，
 * 模型照抄会直接触发回退，因此每个 JSON 都必须通过完整协议校验。
 */

const EXAMPLES_DIR = join(process.cwd(), 'docs', 'examples');
const files = readdirSync(EXAMPLES_DIR).filter((name) => name.endsWith('.json'));

function load(name: string): GenuiDocument {
  const result = parseGenui(readFileSync(join(EXAMPLES_DIR, name), 'utf8'));
  expect(result.ok, `${name} 应通过协议校验：${result.ok ? '' : `${result.code} ${result.detail}`}`).toBe(true);
  if (!result.ok) throw new Error(name);
  return result.document;
}

describe('docs/examples 示例文档', () => {
  it('目录中至少包含三个 v3 场景示例、v4 函数曲线示例与 v5 语义模型示例', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'parabola-v3.json',
        'shopping-comparison-v3.json',
        'budget-v3.json',
        'parabola-v4.json',
        'budget-v5.json',
        'preference-v5.json',
        'cost-v5.json',
      ]),
    );
  });

  it.each(files)('%s 能通过完整协议校验', (name) => {
    const document = load(name);
    expect(document.type).toBe('genui');
    expect([1, 2, 3, 4, 5]).toContain(document.version);
  });

  it('抛物线示例覆盖折线与退化提示', () => {
    const document = load('parabola-v3.json');
    expect(document.version).toBe(3);
    const kinds = document.elements.map((element) => element.kind);
    expect(kinds).toContain('section');
    expect(JSON.stringify(document)).toContain('"chartType":"line"');
    expect(JSON.stringify(document)).toContain('一次函数');
  });

  it('抛物线 v4 示例使用函数曲线系列并声明零点覆盖', () => {
    const document = load('parabola-v4.json');
    expect(document.version).toBe(4);
    const serialized = JSON.stringify(document);
    expect(serialized).toContain('"chartType":"line"');
    expect(serialized).toContain('"function"');
    expect(serialized).toContain('"zero"');
    expect(serialized).toContain('"samples"');
    expect(serialized).toContain('"domain"');
    expect(document.elements.some((element) => element.kind === 'section')).toBe(true);
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

  it('预算 v5 示例用单一模型驱动数值、图表、表格与解释', () => {
    const document = load('budget-v5.json');
    if (document.version !== 5) throw new Error('应为 v5');
    expect(document.models).toHaveLength(1);
    expect(document.models[0]).toMatchObject({ kind: 'budget', id: 'monthly' });
    const serialized = JSON.stringify(document);
    expect(serialized).toContain('"kind":"model"');
    expect(serialized).toContain('"source":{"model":"monthly"');
    expect(serialized).toContain('"kind":"explain"');
  });

  it('偏好 v5 示例保留缺失资料并按模型输出排名', () => {
    const document = load('preference-v5.json');
    if (document.version !== 5) throw new Error('应为 v5');
    expect(document.models[0]).toMatchObject({ kind: 'preference', id: 'pick' });
    const serialized = JSON.stringify(document);
    expect(serialized).toContain('"price":null');
    expect(serialized).toContain('"weight":null');
    expect(serialized).toContain('"view":"ranking"');
    expect(serialized).toContain('"view":"breakdown"');
  });

  it('成本 v5 示例覆盖零周期与单次成本不可用提示', () => {
    const document = load('cost-v5.json');
    if (document.version !== 5) throw new Error('应为 v5');
    expect(document.models[0]).toMatchObject({ kind: 'cost', id: 'membership' });
    const serialized = JSON.stringify(document);
    expect(serialized).toContain('单次成本不可用');
    expect(serialized).toContain('"view":"plans"');
    expect(serialized).toContain('"key":"lowestUnitCost"');
  });
});
