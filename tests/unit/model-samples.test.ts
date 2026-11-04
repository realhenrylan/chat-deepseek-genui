import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { GenuiV5Document } from '../../src/protocol/types';
import { parseGenui } from '../../src/protocol/validate';
import {
  createInitialState,
  evaluateComposite,
  lookupModel,
  modelTable,
} from '../../src/runtime/evaluate';

function loadSample(name: string) {
  const text = readFileSync(`docs/phase9-samples/${name}.md`, 'utf8');
  const match = text.match(/```genui\s*([\s\S]*?)```/);
  expect(match).not.toBeNull();
  const json = match![1].trim();
  const parsed = parseGenui(json);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`${parsed.code}: ${parsed.detail}`);
  return { text, json, document: parsed.document as GenuiV5Document };
}

describe('阶段 9 最终版本模型样本', () => {
  it('预算样本可由当前协议解析，数值、表格与模型快照一致', () => {
    const { json, document } = loadSample('v5-final-budget');
    const evaluation = evaluateComposite(document, createInitialState(document));
    const model = lookupModel(evaluation, 'monthly');
    expect(model?.ok).toBe(true);
    expect(model?.scalars).toMatchObject({
      income: 12000,
      expenses: 8600,
      balance: 3400,
      usage: 71.7,
      overspend: 0,
      itemCount: 4,
    });
    expect(modelTable(model!, 'summary')?.rows).toEqual([
      { item: '收入', amount: 12000, share: null },
      { item: '支出', amount: 8600, share: 71.7 },
      { item: '余额', amount: 3400, share: null },
    ]);
    expect(modelTable(model!, 'items')?.rows).toHaveLength(4);
    expect(json.length).toBeLessThan(5000);
  });

  it('偏好样本可由当前协议解析，并保留缺失资料语义', () => {
    const { json, document } = loadSample('v5-final-preference');
    const evaluation = evaluateComposite(document, createInitialState(document));
    expect(evaluation.models.size).toBeGreaterThan(0);
    const ranked = [...evaluation.models.values()].filter((model) => model.kind === 'preference');
    expect(ranked.length).toBeGreaterThan(0);
    const primary = ranked[0];
    expect(primary.ok).toBe(true);
    expect(primary.scalars).toMatchObject({
      candidateCount: 4,
      eligibleCount: 4,
      rankedCount: 4,
      topScore: 60.29,
      weightTotal: 100,
      dimensionCount: 3,
    });
    const ranking = modelTable(primary, 'ranking');
    expect(ranking?.rows).toEqual([
      { rank: 1, candidate: 'D 款', score: 60.29, missing: 1 },
      { rank: 2, candidate: 'C 款', score: 60, missing: 0 },
      { rank: 3, candidate: 'A 款', score: 51, missing: 0 },
      { rank: 4, candidate: 'B 款', score: 40, missing: 0 },
    ]);
    expect(json.length).toBeLessThan(10000);
  });
});
