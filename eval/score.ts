import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseGenui } from '../src/protocol/validate.ts';
import {
  parseFormPromptTemplate,
  validateFormPromptTemplate,
  type TemplateToken,
} from '../src/protocol/widget/template.ts';
import type { FormWidget } from '../src/protocol/widget/types.ts';

export const MAX_FORM_EVAL_PROMPT_LENGTH = 200;

export interface PromptDef {
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

export interface FormCheckResult {
  placeholdersOk: boolean;
  requiredFieldsReferenced: boolean;
  noJsonOrCode: boolean;
  firstPersonOk: boolean;
  withinLengthLimit: boolean;
  templateSelfConsistent: boolean;
  noPreselect: boolean;
}

export interface BlockEvalResult {
  index: number;
  rawText: string;
  parsedOk: boolean;
  errorCode?: string;
  errorDetail?: string;
  version?: number;
  kind?: string;
  rawW?: string;
  isInterleaved: boolean;
  formCheck?: FormCheckResult;
}

export interface RunEvalResult {
  promptId: string;
  category: string;
  expectGenui: boolean;
  expectForm: boolean;
  hasGenui: boolean;
  hasForm: boolean;
  formCount: number;
  formFalsePositive: boolean;
  blocks: BlockEvalResult[];
  pass: boolean;
}

export interface MetricFraction {
  count: number;
  total: number;
  rate: number;
}

export interface EvalSuiteSummary {
  runsDir: string;
  evaluatedCount: number;
  datasetTotal: number;
  passRate: MetricFraction;
  blockSuccessRate: MetricFraction;
  interleaveRate: MetricFraction;
  falsePositiveRate: MetricFraction;
  formGenerationRate: MetricFraction;
  templateSelfConsistencyRate: MetricFraction;
  quizNoPreselectRate: MetricFraction;
  formFalsePositiveRate: MetricFraction;
}

function tryParseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function collectTextLiterals(tokens: TemplateToken[]): string[] {
  return tokens.flatMap((token) =>
    token.kind === 'text'
      ? [token.value]
      : token.kind === 'cond'
        ? collectTextLiterals(token.body)
        : [],
  );
}

function isFirstPersonTemplate(template: string): boolean {
  const hasFirstPerson = /(?:我|咱们|咱|\b(?:I|I'm|I'd|I've|my|we|our)\b)/i.test(template);
  const hasThirdPersonRef = /(?:该?用户(?:已)?选择|用户的选择是|答题者|请根据以上用户)/.test(template);
  return hasFirstPerson && !hasThirdPersonRef;
}

function evaluateFormBlock(rawObj: Record<string, unknown> | null, widget: FormWidget): FormCheckResult {
  const rawSubmit =
    rawObj && typeof rawObj.submit === 'object' && rawObj.submit !== null
      ? (rawObj.submit as Record<string, unknown>)
      : null;
  const rawPrompt = typeof rawSubmit?.prompt === 'string' ? rawSubmit.prompt : '';

  const declaredFieldIds = new Set(widget.fields.map((field) => field.id));
  const requiredFieldIds = widget.fields
    .filter((field) => !field.optional)
    .map((field) => field.id);

  const templateValidation = validateFormPromptTemplate(rawPrompt, declaredFieldIds);
  const parsedTemplate = parseFormPromptTemplate(rawPrompt);

  const placeholdersOk = templateValidation.valid;
  const requiredFieldsReferenced = requiredFieldIds.every((id) =>
    parsedTemplate.referencedIds.includes(id),
  );

  const textLiterals = collectTextLiterals(parsedTemplate.tokens);
  const noJsonOrCode =
    textLiterals.every((literal) => !literal.includes('{')) &&
    !/```/.test(rawPrompt) &&
    !/\{\s*"/.test(rawPrompt);

  const firstPersonOk = isFirstPersonTemplate(rawPrompt);
  const withinLengthLimit = rawPrompt.trim().length <= MAX_FORM_EVAL_PROMPT_LENGTH;

  const rawFields = rawObj && Array.isArray(rawObj.fields) ? rawObj.fields : [];
  const noPreselect = !rawFields.some((field) => {
    if (typeof field !== 'object' || field === null) return false;
    const def = (field as { default?: unknown }).default;
    return def !== undefined && def !== null;
  });

  return {
    placeholdersOk,
    requiredFieldsReferenced,
    noJsonOrCode,
    firstPersonOk,
    withinLengthLimit,
    templateSelfConsistent:
      placeholdersOk &&
      requiredFieldsReferenced &&
      noJsonOrCode &&
      firstPersonOk &&
      withinLengthLimit,
    noPreselect,
  };
}

function isFormExpected(promptDef: PromptDef): boolean {
  return (
    promptDef.category === 'clarify' ||
    promptDef.category === 'grade' ||
    promptDef.expectedIntent.includes('form')
  );
}

function makeFraction(count: number, total: number): MetricFraction {
  return {
    count,
    total,
    rate: total > 0 ? count / total : 0,
  };
}

function formatFraction(frac: MetricFraction): string {
  const pct = frac.total > 0 ? ((frac.count / frac.total) * 100).toFixed(1) : '0';
  return `${pct}% (${frac.count}/${frac.total})`;
}

function extractGenuiFencedBlocks(
  markdown: string,
): Array<{ text: string; start: number; end: number }> {
  const results: Array<{ text: string; start: number; end: number }> = [];
  let cursor = 0;
  let inFence = false;
  let fenceLen = 0;
  let fenceLang = '';
  let blockStart = 0;
  let bodyLines: string[] = [];

  while (cursor <= markdown.length) {
    const nlIndex = markdown.indexOf('\n', cursor);
    const lineEnd = nlIndex === -1 ? markdown.length : nlIndex;
    const rawLine = markdown.slice(cursor, lineEnd);
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const nextCursor = nlIndex === -1 ? markdown.length + 1 : nlIndex + 1;

    if (!inFence) {
      const openMatch = line.match(/^ {0,3}(`{3,})([^\r\n]*)$/);
      if (openMatch && !openMatch[2].includes('`')) {
        inFence = true;
        fenceLen = openMatch[1].length;
        fenceLang = openMatch[2].trim().toLowerCase();
        blockStart = cursor;
        bodyLines = [];
      }
    } else {
      const closeMatch = line.match(/^ {0,3}(`{3,})\s*$/);
      if (closeMatch && closeMatch[1].length >= fenceLen) {
        inFence = false;
        if (fenceLang === 'genui') {
          results.push({
            text: bodyLines.join('\n').trim(),
            start: blockStart,
            end: lineEnd,
          });
        }
      } else {
        bodyLines.push(line);
      }
    }
    cursor = nextCursor;
  }

  return results;
}

export function evaluateMarkdownResponse(
  markdown: string,
  promptDef: PromptDef
): RunEvalResult {
  const matches = extractGenuiFencedBlocks(markdown);

  const blocks: BlockEvalResult[] = matches.map((match, idx) => {
    const raw = match.text;
    const rawObj = tryParseJsonRecord(raw);
    const rawW = typeof rawObj?.w === 'string' ? rawObj.w : undefined;
    const parsed = parseGenui(raw);
    const textAfter = markdown.slice(match.end).trim();
    // 如果代码块后面还有超过 2 个字的正文，视为穿插在内容中
    const isInterleaved = textAfter.length >= 2 && !textAfter.startsWith('```');

    const formCheck =
      parsed.ok && parsed.widget?.w === 'form'
        ? evaluateFormBlock(rawObj, parsed.widget)
        : undefined;

    return {
      index: idx,
      rawText: raw,
      parsedOk: parsed.ok,
      errorCode: parsed.ok ? undefined : parsed.code,
      errorDetail: parsed.ok ? undefined : (parsed as { detail?: string }).detail,
      version: parsed.ok ? parsed.document.version : undefined,
      kind: parsed.ok && parsed.widget ? parsed.widget.w : undefined,
      rawW,
      isInterleaved,
      formCheck,
    };
  });

  const hasGenui = blocks.length > 0;
  const expectForm = isFormExpected(promptDef);
  const formCount = blocks.filter((b) => b.kind === 'form' || b.rawW === 'form').length;
  const hasForm = blocks.some((b) => b.parsedOk && b.kind === 'form');
  const formFalsePositive = !expectForm && formCount > 0;

  const pass = !promptDef.expectGenui
    ? !hasGenui
    : hasGenui &&
      blocks.every((b) => b.parsedOk) &&
      (!expectForm || (hasForm && formCount <= 1));

  return {
    promptId: promptDef.id,
    category: promptDef.category,
    expectGenui: promptDef.expectGenui,
    expectForm,
    hasGenui,
    hasForm,
    formCount,
    formFalsePositive,
    blocks,
    pass,
  };
}

export function computeEvalSummary(
  results: RunEvalResult[],
  runsDir: string,
  datasetTotal: number,
): EvalSuiteSummary {
  const totalPass = results.filter((r) => r.pass).length;
  const genuiBlocks = results.flatMap((r) => r.blocks);
  const validBlocks = genuiBlocks.filter((b) => b.parsedOk).length;
  const interleavedBlocks = genuiBlocks.filter((b) => b.isInterleaved).length;
  const plainPrompts = results.filter((r) => !r.expectGenui);
  const falsePositiveCount = plainPrompts.filter((r) => r.hasGenui).length;

  const formExpectedResults = results.filter((r) => r.expectForm);
  const formGeneratedCount = formExpectedResults.filter((r) => r.hasForm).length;

  const formChecks = genuiBlocks
    .map((b) => b.formCheck)
    .filter((check): check is FormCheckResult => check !== undefined);
  const selfConsistentCount = formChecks.filter((c) => c.templateSelfConsistent).length;

  const gradeFormBlocks = results
    .filter((r) => r.category === 'grade')
    .flatMap((r) => r.blocks)
    .map((b) => b.formCheck)
    .filter((check): check is FormCheckResult => check !== undefined);
  const noPreselectCount = gradeFormBlocks.filter((c) => c.noPreselect).length;

  const nonFormResults = results.filter((r) => !r.expectForm);
  const formFalsePositiveCount = nonFormResults.filter((r) => r.formFalsePositive).length;

  return {
    runsDir,
    evaluatedCount: results.length,
    datasetTotal,
    passRate: makeFraction(totalPass, results.length),
    blockSuccessRate: makeFraction(validBlocks, genuiBlocks.length),
    interleaveRate: makeFraction(interleavedBlocks, genuiBlocks.length),
    falsePositiveRate: makeFraction(falsePositiveCount, plainPrompts.length),
    formGenerationRate: makeFraction(formGeneratedCount, formExpectedResults.length),
    templateSelfConsistencyRate: makeFraction(selfConsistentCount, formChecks.length),
    quizNoPreselectRate: makeFraction(noPreselectCount, gradeFormBlocks.length),
    formFalsePositiveRate: makeFraction(formFalsePositiveCount, nonFormResults.length),
  };
}

export function runEvaluationSuite(runsDir: string): EvalSuiteSummary | null {
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
    return null;
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

  const summary = computeEvalSummary(results, runsDir, dataset.prompts.length);

  console.log(`\n================== 评测结果汇总 [${runsDir}] ==================`);
  console.log(`已评估样本数: ${summary.evaluatedCount} / ${summary.datasetTotal}`);
  console.log(`总通过率 (Pass Rate): ${formatFraction(summary.passRate)}`);
  console.log(`代码块首轮解析成功率: ${formatFraction(summary.blockSuccessRate)}`);
  console.log(`内联穿插比例 (Interleave Rate): ${formatFraction(summary.interleaveRate)}`);
  console.log(`普通问答误触发率 (False Positive): ${formatFraction(summary.falsePositiveRate)}`);
  console.log(`Form 生成率 (clarify+grade): ${formatFraction(summary.formGenerationRate)}`);
  console.log(`模板自洽率 (占位符/第一人称/<=200字): ${formatFraction(summary.templateSelfConsistencyRate)}`);
  console.log(`测验无预选率 (grade 无 default): ${formatFraction(summary.quizNoPreselectRate)}`);
  console.log(`Form 误报率 (非 form 题误出 form): ${formatFraction(summary.formFalsePositiveRate)}`);
  console.log(`=================================================================\n`);

  return summary;
}

if (process.argv[1] && process.argv[1].endsWith('score.ts')) {
  const dir = process.argv[2] || 'eval/runs/baseline';
  runEvaluationSuite(dir);
}
