import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseGenui } from '../src/protocol/validate.ts';

interface PromptDef {
  id: string;
  category: string;
  title: string;
  prompt: string;
  expectGenui: boolean;
  expectedIntent: string[];
}

interface EvalDataset {
  version: string;
  prompts: PromptDef[];
}

interface BlockEvalResult {
  index: number;
  rawText: string;
  parsedOk: boolean;
  errorCode?: string;
  errorDetail?: string;
  version?: number;
  kind?: string;
  isInterleaved: boolean;
}

interface RunEvalResult {
  promptId: string;
  category: string;
  expectGenui: boolean;
  hasGenui: boolean;
  blocks: BlockEvalResult[];
  pass: boolean;
}

export function evaluateMarkdownResponse(
  markdown: string,
  promptDef: PromptDef
): RunEvalResult {
  const codeBlockRegex = /```(?:genui)?(?:\r?\n)([\s\S]*?)```/g;
  const matches: { text: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;

  while ((m = codeBlockRegex.exec(markdown)) !== null) {
    const rawMatch = m[0];
    const jsonText = m[1].trim();
    matches.push({ text: jsonText, start: m.index, end: m.index + rawMatch.length });
  }

  const blocks: BlockEvalResult[] = matches.map((match, idx) => {
    const raw = match.text;
    const parsed = parseGenui(raw);
    const textAfter = markdown.slice(match.end).trim();
    // 如果代码块后面还有超过 2 个字的正文，视为穿插在内容中
    const isInterleaved = textAfter.length >= 2 && !textAfter.startsWith('```');

    return {
      index: idx,
      rawText: raw,
      parsedOk: parsed.ok,
      errorCode: parsed.ok ? undefined : parsed.code,
      errorDetail: parsed.ok ? undefined : (parsed as { detail?: string }).detail,
      version: parsed.ok ? parsed.document.version : undefined,
      kind: parsed.ok && parsed.widget ? parsed.widget.w : undefined,
      isInterleaved,
    };
  });

  const hasGenui = blocks.length > 0;
  const pass = !promptDef.expectGenui
    ? !hasGenui
    : hasGenui && blocks.every((b) => b.parsedOk);

  return {
    promptId: promptDef.id,
    category: promptDef.category,
    expectGenui: promptDef.expectGenui,
    hasGenui,
    blocks,
    pass,
  };
}

export function runEvaluationSuite(runsDir: string) {
  const root = resolve('.');
  const promptsPath = join(root, 'eval', 'prompts.json');
  if (!existsSync(promptsPath)) {
    throw new Error(`找不到评测集定义: ${promptsPath}`);
  }

  const dataset: EvalDataset = JSON.parse(readFileSync(promptsPath, 'utf8'));
  const promptMap = new Map<string, PromptDef>(dataset.prompts.map((p) => [p.id, p]));

  const targetDir = resolve(runsDir);
  if (!existsSync(targetDir)) {
    console.log(`运行样本目录尚未创建或为空: ${targetDir}`);
    console.log(`评测集已就绪，共有 ${dataset.prompts.length} 道标准化题目。`);
    return;
  }

  const files = readdirSync(targetDir).filter((f) => f.endsWith('.md'));
  const results: RunEvalResult[] = [];

  for (const file of files) {
    const id = file.replace(/\.md$/, '');
    const promptDef = promptMap.get(id);
    if (!promptDef) continue;

    const content = readFileSync(join(targetDir, file), 'utf8');
    const res = evaluateMarkdownResponse(content, promptDef);
    results.push(res);
  }

  console.log(`\n================== 评测结果汇总 [${runsDir}] ==================`);
  console.log(`已评估样本数: ${results.length} / ${dataset.prompts.length}`);

  const totalPass = results.filter((r) => r.pass).length;
  const passRate = results.length > 0 ? ((totalPass / results.length) * 100).toFixed(1) : '0';
  console.log(`总通过率 (Pass Rate): ${passRate}% (${totalPass}/${results.length})`);

  const genuiBlocks = results.flatMap((r) => r.blocks);
  const totalBlocks = genuiBlocks.length;
  const validBlocks = genuiBlocks.filter((b) => b.parsedOk).length;
  const blockSuccessRate = totalBlocks > 0 ? ((validBlocks / totalBlocks) * 100).toFixed(1) : '0';
  console.log(`代码块首轮解析成功率: ${blockSuccessRate}% (${validBlocks}/${totalBlocks})`);

  const interleavedBlocks = genuiBlocks.filter((b) => b.isInterleaved).length;
  const interleaveRate = totalBlocks > 0 ? ((interleavedBlocks / totalBlocks) * 100).toFixed(1) : '0';
  console.log(`内联穿插比例 (Interleave Rate): ${interleaveRate}% (${interleavedBlocks}/${totalBlocks})`);

  const plainPrompts = results.filter((r) => !r.expectGenui);
  const falsePositiveCount = plainPrompts.filter((r) => r.hasGenui).length;
  const falsePositiveRate = plainPrompts.length > 0 ? ((falsePositiveCount / plainPrompts.length) * 100).toFixed(1) : '0';
  console.log(`普通问答误触发率 (False Positive): ${falsePositiveRate}% (${falsePositiveCount}/${plainPrompts.length})`);
  console.log(`=================================================================\n`);
}

if (process.argv[1] && process.argv[1].endsWith('score.ts')) {
  const dir = process.argv[2] || 'eval/runs/baseline';
  runEvaluationSuite(dir);
}
