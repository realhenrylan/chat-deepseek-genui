import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeEvalSummary,
  evaluateMarkdownResponse,
  runEvaluationSuite,
  type PromptDef,
} from '../../eval/score.ts';

describe('Eval Scoring Suite', () => {
  it('评测集包含 38 题且新增 5 道 clarify 与 5 道 grade 题', () => {
    const raw = readFileSync(resolve('eval/prompts.json'), 'utf8');
    const dataset = JSON.parse(raw) as { prompts: PromptDef[] };

    expect(dataset.prompts.length).toBe(38);
    expect(new Set(dataset.prompts.map((p) => p.id)).size).toBe(38);

    const clarify = dataset.prompts.filter((p) => p.category === 'clarify');
    const grade = dataset.prompts.filter((p) => p.category === 'grade');
    expect(clarify.map((p) => p.id)).toEqual(['C01', 'C02', 'C03', 'C04', 'C05']);
    expect(grade.map((p) => p.id)).toEqual(['Q01', 'Q02', 'Q03', 'Q04', 'Q05']);
    for (const p of [...clarify, ...grade]) {
      expect(p.expectGenui).toBe(true);
      expect(p.expectedIntent).toContain('form');
    }
  });

  it('正确评估正向和负向样本', () => {
    const promptDef = {
      id: 'T01',
      category: 'learning',
      title: '测试',
      prompt: '测试',
      expectGenui: true,
      expectedIntent: ['slider'],
    };

    const goodMarkdown = `
这是一段讲解。

\`\`\`genui
{
  "type": "genui",
  "version": 5,
  "state": [],
  "derived": [],
  "models": [],
  "elements": [{ "kind": "text", "value": "hello" }]
}
\`\`\`

这是后面的总结文字。
    `;

    const res = evaluateMarkdownResponse(goodMarkdown, promptDef);
    expect(res.pass).toBe(true);
    expect(res.blocks.length).toBe(1);
    expect(res.blocks[0].parsedOk).toBe(true);
    expect(res.blocks[0].isInterleaved).toBe(true);
    expect(res.formFalsePositive).toBe(false);
  });

  it('准确统计 P0-d 四项 form 指标与模板自洽细分缺陷', () => {
    const clarifyPrompt: PromptDef = {
      id: 'C01',
      category: 'clarify',
      title: '周末游',
      prompt: '周末去哪玩',
      expectGenui: true,
      expectedIntent: ['form'],
    };
    const gradePrompt: PromptDef = {
      id: 'Q01',
      category: 'grade',
      title: 'HTTP 测验',
      prompt: '出题批改',
      expectGenui: true,
      expectedIntent: ['form'],
    };
    const nonFormPrompt: PromptDef = {
      id: 'W01',
      category: 'what-if',
      title: '参数测算',
      prompt: '买车还是租车',
      expectGenui: true,
      expectedIntent: ['slider'],
    };

    const wrapForm = (form: Record<string, unknown>) =>
      `先给结论。\n\n\`\`\`genui\n${JSON.stringify(form)}\n\`\`\``;

    const clarifyOk = evaluateMarkdownResponse(
      wrapForm({
        w: 'form',
        title: '你想从哪个城市出发？',
        fields: [
          { id: 'city', type: 'radio', label: '出发地', options: ['上海', '杭州'], default: '上海' },
          { id: 'days', type: 'radio', label: '天数', options: ['2天', '3天'], default: '2天' },
          { id: 'note', type: 'text', label: '补充', optional: true },
        ],
        submit: {
          label: '生成周末路线',
          prompt: '我想从{city}出发在长三角玩{days}。{note?偏好：{note}。}请给出每日行程与交通建议。',
        },
      }),
      clarifyPrompt,
    );
    expect(clarifyOk.pass).toBe(true);
    expect(clarifyOk.hasForm).toBe(true);
    expect(clarifyOk.blocks[0].formCheck?.templateSelfConsistent).toBe(true);

    // 占位符未知 + 缺必填字段 + 第一人称失败 + 含 JSON `{` + 超 200 字
    const badPromptText = `用户选择了{"city":"{unknown}"}` + '补充说明'.repeat(50);
    const clarifyBadTemplate = evaluateMarkdownResponse(
      wrapForm({
        w: 'form',
        title: '选条件',
        fields: [
          { id: 'city', type: 'radio', label: '城市', options: ['上海', '杭州'], default: '上海' },
        ],
        submit: { label: '继续', prompt: badPromptText },
      }),
      clarifyPrompt,
    );
    const badCheck = clarifyBadTemplate.blocks[0].formCheck;
    expect(badCheck?.placeholdersOk).toBe(false);
    expect(badCheck?.requiredFieldsReferenced).toBe(false);
    expect(badCheck?.noJsonOrCode).toBe(false);
    expect(badCheck?.firstPersonOk).toBe(false);
    expect(badCheck?.withinLengthLimit).toBe(false);
    expect(badCheck?.templateSelfConsistent).toBe(false);

    // 测验题无 preselect vs 误加 default
    const gradeClean = evaluateMarkdownResponse(
      wrapForm({
        w: 'form',
        title: '请作答',
        fields: [
          { id: 'q1', type: 'radio', label: '第 1 题', options: ['POST 幂等', 'PUT 幂等'] },
        ],
        submit: { label: '提交给我批改', prompt: '第 1 题我选 {q1}，请帮我批改并点评理由。' },
      }),
      gradePrompt,
    );
    expect(gradeClean.blocks[0].formCheck?.noPreselect).toBe(true);
    expect(gradeClean.blocks[0].formCheck?.templateSelfConsistent).toBe(true);

    const gradePreselected = evaluateMarkdownResponse(
      wrapForm({
        w: 'form',
        title: '请作答',
        fields: [
          {
            id: 'q1',
            type: 'radio',
            label: '第 1 题',
            options: ['GET 可缓存', 'POST 必幂等'],
            default: 'GET 可缓存',
          },
        ],
        submit: { label: '提交批改', prompt: '我选了 {q1}，请你帮我批改。' },
      }),
      gradePrompt,
    );
    expect(gradePreselected.blocks[0].formCheck?.noPreselect).toBe(false);

    // 非 form 题误触发 form
    const falsePositive = evaluateMarkdownResponse(
      wrapForm({
        w: 'form',
        title: '先选参数',
        fields: [{ id: 'km', type: 'radio', label: '里程', options: ['1万', '2万'], default: '1万' }],
        submit: { label: '开始对比', prompt: '我每年开 {km}，帮我算买车还是租车。' },
      }),
      nonFormPrompt,
    );
    expect(falsePositive.formFalsePositive).toBe(true);

    // 澄清题未出 form（输出了 card）
    const clarifyMissed = evaluateMarkdownResponse(
      `\`\`\`genui\n{"w":"card","title":"推荐概念"}\n\`\`\``,
      clarifyPrompt,
    );
    expect(clarifyMissed.hasForm).toBe(false);
    expect(clarifyMissed.pass).toBe(false);

    const summary = computeEvalSummary(
      [clarifyOk, clarifyBadTemplate, clarifyMissed, gradeClean, gradePreselected, falsePositive],
      'synthetic',
      38,
    );
    expect(summary.formGenerationRate).toEqual({ count: 4, total: 5, rate: 4 / 5 });
    expect(summary.templateSelfConsistencyRate).toEqual({ count: 4, total: 5, rate: 4 / 5 });
    expect(summary.quizNoPreselectRate).toEqual({ count: 1, total: 2, rate: 0.5 });
    expect(summary.formFalsePositiveRate).toEqual({ count: 1, total: 1, rate: 1 });
  });

  it('只提取 genui 围栏块，不被 typescript / bash 等普通代码块错位干扰', () => {
    const plainCodePrompt: PromptDef = {
      id: 'P03',
      category: 'plain',
      title: 'TS 防抖',
      prompt: '写个 debounce',
      expectGenui: false,
      expectedIntent: [],
    };
    const codeMarkdown = [
      '实现如下：',
      '```typescript',
      'export const x = 1;',
      '```',
      '## 核心设计要点',
      '```typescript',
      'export const y = 2;',
      '```',
    ].join('\n');
    const plainRes = evaluateMarkdownResponse(codeMarkdown, plainCodePrompt);
    expect(plainRes.hasGenui).toBe(false);
    expect(plainRes.blocks).toEqual([]);
    expect(plainRes.pass).toBe(true);

    const guidePrompt: PromptDef = {
      id: 'G01',
      category: 'guide',
      title: '环境配置',
      prompt: '配置环境',
      expectGenui: true,
      expectedIntent: ['checklist'],
    };
    const mixedMarkdown = [
      '步骤 1：',
      '```bash',
      'npm -v',
      '```',
      '说明正文。',
      '```genui',
      '{"w":"checklist","title":"检查","items":[{"text":"安装 Node"}]}',
      '```',
    ].join('\n');
    const mixedRes = evaluateMarkdownResponse(mixedMarkdown, guidePrompt);
    expect(mixedRes.blocks.length).toBe(1);
    expect(mixedRes.blocks[0].parsedOk).toBe(true);
    expect(mixedRes.blocks[0].kind).toBe('checklist');
    expect(mixedRes.pass).toBe(true);
  });

  it('能正常加载并执行评测套件入口', () => {
    expect(() => runEvaluationSuite('eval/runs/baseline')).not.toThrow();
  });
});
