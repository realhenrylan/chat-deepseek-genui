import { describe, it, expect } from 'vitest';
import { parseGenui } from '../../src/protocol/validate';
import { diagnoseParseFailure, buildRepairPrompt } from '../../src/protocol/diagnose';
import type { GenuiV5Document, TableElement } from '../../src/protocol/types';

const REAL_TURN_2_RAW = JSON.stringify({
  type: 'genui',
  version: 5,
  title: 'Gemini 3.8 Flash vs Gemini 4 Argon',
  state: [],
  derived: [],
  models: [],
  elements: [
    {
      kind: 'table',
      title: '核心规格与性能对比',
      sortable: true,
      initialSort: { key: 'dimension', dir: 'asc' },
      columns: [
        { key: 'dimension', label: '对比维度' },
        { key: 'flash', label: 'Gemini 3.8 Flash' },
        { key: 'argon', label: 'Gemini 4 Argon' },
        { key: 'note', label: '关键差异' },
      ],
      rows: [
        {
          cells: {
            dimension: '定位',
            flash: '生产默认主力（Flash 档）',
            argon: '旗舰模型（Frontier 档）',
            note: 'Argon 面向最难任务，Flash 面向规模部署',
          },
        },
        {
          cells: {
            dimension: '综合评分（LLM Stats Score）',
            flash: '49.0（#26）',
            argon: '55.1（#4）',
            note: 'Argon 领先，但在共享基准上是 7 胜 0 负的全面压制',
          },
        },
        {
          cells: {
            dimension: '编程（DeepSWE v1.1）',
            flash: '~71%–73.7%',
            argon: '77.9%',
            note: 'Argon 超过 Claude Opus 5.5（74.2%）',
          },
        },
        {
          cells: {
            dimension: '输入价格（每 1M tokens）',
            flash: '$0.75（推广价，2027-01-01 起 $1.50）',
            argon: '$2.00（推广价，2026-12-01 起 $4.00）',
            note: 'Flash 约便宜 2.7 倍',
          },
        },
        {
          cells: {
            dimension: '输出价格（每 1M tokens）',
            flash: '$3.75（推广价，之后 $7.50）',
            argon: '$10.00（推广价，之后 $20.00）',
            note: '同上，Flash 成本优势显著',
          },
        },
        {
          cells: {
            dimension: '每样本视觉评估成本',
            flash: '$0.0045',
            argon: '$0.0058',
            note: 'Flash 便宜约 22%',
          },
        },
        {
          cells: {
            dimension: '每样本视觉评估速度',
            flash: '12.8 秒',
            argon: '13.4 秒',
            note: 'Flash 略快',
          },
        },
        {
          cells: {
            dimension: '免费 API 层',
            flash: '有',
            argon: '无',
            note: 'Argon 不提供免费额度',
          },
        },
        {
          cells: {
            dimension: '上下文窗口',
            flash: '1.0M tokens',
            argon: '1.0M tokens',
            note: '持平',
          },
        },
        {
          cells: {
            dimension: '发布日期',
            flash: '2026 年 9 月',
            argon: '2026 年 9–10 月',
            note: 'Argon 更新，但代际差距仅约一个月',
          },
        },
      ],
    },
    {
      kind: 'note',
      text: '价格与评分为 2026 年 10 月下旬多个第三方追踪站点的快照；Google 已公布后续涨价计划，长期部署需按标准价重算。',
      tone: 'info',
    },
  ],
}, null, 2);

// Turn 1 had syntax error: missing opening quote on numbers like 49.0(#26)"
const REAL_TURN_1_RAW = REAL_TURN_2_RAW.replace('"49.0（#26）"', '49.0（#26）"');

describe('Real user conversation verification', () => {
  it('Turn 2 from shared chat parses successfully as a v5 document', () => {
    const result = parseGenui(REAL_TURN_2_RAW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const v5Doc = result.document as GenuiV5Document;
      expect(v5Doc.version).toBe(5);
      expect(v5Doc.title).toBe('Gemini 3.8 Flash vs Gemini 4 Argon');
      expect(v5Doc.models).toEqual([]);
      expect(v5Doc.elements.length).toBe(2);
      expect(v5Doc.elements[0].kind).toBe('table');
      const table = v5Doc.elements[0] as TableElement;
      expect(table.rows?.length).toBe(10);
    }
  });

  it('Turn 1 syntax error generates an untruncated repair prompt using protocol 1-5', () => {
    const result = parseGenui(REAL_TURN_1_RAW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid-json');
      const diag = diagnoseParseFailure(result, REAL_TURN_1_RAW);
      const prompt = buildRepairPrompt(diag, REAL_TURN_1_RAW);
      expect(prompt).toContain('使用协议 1–5 的合法字段');
      expect(prompt).not.toContain('使用协议 1–3 的合法字段');
      expect(prompt).not.toContain('（中间内容省略）');
      expect(prompt).not.toContain('（片段已截断');
      expect(prompt).toContain('发布日期');
    }
  });
});
