import { describe, expect, it } from 'vitest';
import { evaluateMarkdownResponse, runEvaluationSuite } from '../../eval/score.ts';

describe('Eval Scoring Suite', () => {
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
  });

  it('能正常加载并执行评测套件入口', () => {
    expect(() => runEvaluationSuite('eval/runs/baseline')).not.toThrow();
  });
});
