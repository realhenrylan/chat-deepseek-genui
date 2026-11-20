import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendGenuiPrompt } from '../src/content/prompt.ts';
import type { EvalSuiteSummary, PromptDef } from './score.ts';

export type EvalPromptMode = 'auto' | 'tool';

export interface EvalRunOptions {
  outDir: string;
  mode: EvalPromptMode;
  model: string;
  baseUrl: string;
  categories?: string[];
  onlyIds?: string[];
  concurrency: number;
  skipExisting: boolean;
  timeoutMs: number;
  scoreAfter: boolean;
  help?: boolean;
}

export interface EvalRunDeps {
  rootDir?: string;
  env?: Record<string, string | undefined>;
  fetchFn?: typeof globalThis.fetch;
  scoreFn?: (runsDir: string) => EvalSuiteSummary | null;
  log?: (line: string) => void;
  retryDelayMs?: number;
}

export interface EvalRunReport {
  outDir: string;
  selectedCount: number;
  completedCount: number;
  skippedCount: number;
  errors: Array<{ id: string; message: string; fatal?: boolean }>;
  summary: EvalSuiteSummary | null;
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_OUT_DIR = 'eval/runs/v4.2';
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * 解析 `.env` / `.env.local` 文本，保留非空键值对。
 * 已存在于环境变量中的配置优先级更高，不会被覆盖。
 */
export function parseEnvFileContent(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const withoutExport = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;
    const eqIndex = withoutExport.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = withoutExport.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function loadLocalEnvFiles(
  rootDir = resolve('.'),
  targetEnv: Record<string, string | undefined> = process.env,
): void {
  const merged: Record<string, string> = {};
  for (const fileName of ['.env', '.env.local']) {
    const filePath = join(rootDir, fileName);
    if (!existsSync(filePath)) continue;
    Object.assign(merged, parseEnvFileContent(readFileSync(filePath, 'utf8')));
  }
  for (const [key, value] of Object.entries(merged)) {
    if (targetEnv[key] === undefined || targetEnv[key] === '') {
      targetEnv[key] = value;
    }
  }
}

export function normalizeCompletionsUrl(baseUrl: string): string {
  const trimmed = (baseUrl.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function splitCsvArg(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseRunArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): EvalRunOptions {
  let outDir = DEFAULT_OUT_DIR;
  let positionalOutSet = false;
  let mode: EvalPromptMode = 'auto';
  let model = env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
  const baseUrl = env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL;
  let categories: string[] | undefined;
  let onlyIds: string[] | undefined;
  let concurrency = DEFAULT_CONCURRENCY;
  let skipExisting = false;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let scoreAfter = true;
  let help = false;

  const takeValue = (idx: number, flag: string): string => {
    const val = argv[idx + 1];
    if (val === undefined || val.startsWith('--')) {
      throw new Error(`参数 ${flag} 缺少值`);
    }
    return val;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--out') {
      outDir = takeValue(i, arg);
      i += 1;
    } else if (arg === '--mode') {
      const val = takeValue(i, arg);
      if (val !== 'auto' && val !== 'tool') {
        throw new Error(`--mode 仅支持 auto 或 tool，收到: ${val}`);
      }
      mode = val;
      i += 1;
    } else if (arg === '--model') {
      model = takeValue(i, arg);
      i += 1;
    } else if (arg === '--category') {
      categories = splitCsvArg(takeValue(i, arg));
      i += 1;
    } else if (arg === '--only') {
      onlyIds = splitCsvArg(takeValue(i, arg));
      i += 1;
    } else if (arg === '--concurrency') {
      const parsed = Number(takeValue(i, arg));
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`--concurrency 必须是正整数`);
      }
      concurrency = Math.min(10, Math.floor(parsed));
      i += 1;
    } else if (arg === '--timeout-ms') {
      const parsed = Number(takeValue(i, arg));
      if (!Number.isFinite(parsed) || parsed < 1000) {
        throw new Error(`--timeout-ms 必须 >= 1000`);
      }
      timeoutMs = Math.floor(parsed);
      i += 1;
    } else if (arg === '--skip-existing') {
      skipExisting = true;
    } else if (arg === '--no-score') {
      scoreAfter = false;
    } else if (!arg.startsWith('-') && !positionalOutSet) {
      outDir = arg;
      positionalOutSet = true;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  return {
    outDir,
    mode,
    model,
    baseUrl,
    categories,
    onlyIds,
    concurrency,
    skipExisting,
    timeoutMs,
    scoreAfter,
    help,
  };
}

/** 按扩展真实发送链路（用户消息末尾追加增强协议）拼接请求文本。 */
export function buildEvalUserPrompt(rawPrompt: string, mode: EvalPromptMode): string {
  return appendGenuiPrompt(rawPrompt, mode).value;
}

class FatalApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isFatalAuthStatus(status: number): boolean {
  return status === 401 || status === 402 || status === 403;
}

function extractAssistantText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('响应 JSON 不是对象');
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('响应缺少 choices[0]');
  }
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) {
    throw new Error('响应缺少 choices[0].message');
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('响应 choices[0].message.content 为空');
  }
  return content;
}

async function fetchPromptReply(params: {
  url: string;
  apiKey: string;
  model: string;
  userContent: string;
  timeoutMs: number;
  retryDelayMs: number;
  fetchFn: typeof globalThis.fetch;
}): Promise<string> {
  const maxAttempts = 3;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await params.fetchFn(params.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          messages: [{ role: 'user', content: params.userContent }],
          stream: false,
        }),
        signal: AbortSignal.timeout(params.timeoutMs),
      });

      if (!response.ok) {
        const bodyPreview = (await response.text()).slice(0, 300);
        if (isFatalAuthStatus(response.status)) {
          throw new FatalApiError(
            response.status,
            `HTTP ${response.status}（鉴权或余额异常）: ${bodyPreview}`,
          );
        }
        const err = new Error(`HTTP ${response.status}: ${bodyPreview}`);
        if (attempt < maxAttempts && isRetryableStatus(response.status)) {
          lastError = err;
          if (params.retryDelayMs > 0) await sleep(params.retryDelayMs * attempt);
          continue;
        }
        throw err;
      }

      const json: unknown = await response.json();
      return extractAssistantText(json);
    } catch (error) {
      if (error instanceof FatalApiError) {
        throw error;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        lastError = err;
        if (params.retryDelayMs > 0) await sleep(params.retryDelayMs * attempt);
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('未知请求失败');
}

async function loadScoreRunner(): Promise<(runsDir: string) => EvalSuiteSummary | null> {
  const g = globalThis as unknown as { require?: unknown };
  if (typeof g.require === 'undefined') {
    g.require = createRequire(import.meta.url);
  }
  const scoreMod = await import('./score.ts');
  return scoreMod.runEvaluationSuite;
}

export function selectPrompts(prompts: PromptDef[], opts: EvalRunOptions): PromptDef[] {
  let selected = prompts;
  if (opts.categories && opts.categories.length > 0) {
    const catSet = new Set(opts.categories);
    selected = selected.filter((p) => catSet.has(p.category));
  }
  if (opts.onlyIds && opts.onlyIds.length > 0) {
    const idSet = new Set(opts.onlyIds);
    selected = selected.filter((p) => idSet.has(p.id));
  }
  return selected;
}

export async function executeEvalRun(
  opts: EvalRunOptions,
  deps: EvalRunDeps = {},
): Promise<EvalRunReport> {
  const rootDir = resolve(deps.rootDir ?? '.');
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const log = deps.log ?? console.log;

  loadLocalEnvFiles(rootDir, env);

  const apiKey = env.DEEPSEEK_API_KEY?.trim() ?? '';
  if (!apiKey) {
    throw new Error(
      '未检测到 DEEPSEEK_API_KEY。请在当前终端设置环境变量，或写入仓库根目录 `.env.local`（已被 gitignore）。',
    );
  }

  const promptsPath = join(rootDir, 'eval', 'prompts.json');
  const dataset = JSON.parse(readFileSync(promptsPath, 'utf8')) as { prompts: PromptDef[] };
  const selected = selectPrompts(dataset.prompts, opts);
  if (selected.length === 0) {
    throw new Error('筛选后没有可执行题目，请检查 --category / --only 参数');
  }

  const outAbsDir = resolve(rootDir, opts.outDir);
  mkdirSync(outAbsDir, { recursive: true });

  const completionsUrl = normalizeCompletionsUrl(opts.baseUrl);
  log(
    `开始评测 [${selected.length} 题] model=${opts.model} mode=${opts.mode} out=${opts.outDir} concurrency=${opts.concurrency}`,
  );

  let nextIdx = 0;
  let abortedFatal: FatalApiError | null = null;
  let completedCount = 0;
  let skippedCount = 0;
  const errors: Array<{ id: string; message: string; fatal?: boolean }> = [];

  const worker = async () => {
    while (true) {
      if (abortedFatal !== null) return;
      const current = nextIdx;
      if (current >= selected.length) return;
      nextIdx += 1;

      const promptDef = selected[current];
      const outFile = join(outAbsDir, `${promptDef.id}.md`);
      if (opts.skipExisting && existsSync(outFile)) {
        skippedCount += 1;
        log(`[${current + 1}/${selected.length}] ${promptDef.id} 跳过（已存在）`);
        continue;
      }

      const userContent = buildEvalUserPrompt(promptDef.prompt, opts.mode);
      try {
        const reply = await fetchPromptReply({
          url: completionsUrl,
          apiKey,
          model: opts.model,
          userContent,
          timeoutMs: opts.timeoutMs,
          retryDelayMs: deps.retryDelayMs ?? 1000,
          fetchFn,
        });
        writeFileSync(outFile, reply, 'utf8');
        completedCount += 1;
        log(`[${current + 1}/${selected.length}] ${promptDef.id} 完成 (${reply.length} chars)`);
      } catch (error) {
        const fatal = error instanceof FatalApiError;
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ id: promptDef.id, message, fatal });
        log(`[${current + 1}/${selected.length}] ${promptDef.id} 失败: ${message}`);
        if (fatal && abortedFatal === null) {
          abortedFatal = error;
          return;
        }
      }
    }
  };

  const workerCount = Math.min(opts.concurrency, selected.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const metaPath = join(outAbsDir, '_run-meta.json');
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        model: opts.model,
        mode: opts.mode,
        baseUrl: completionsUrl,
        selectedIds: selected.map((p) => p.id),
        completedCount,
        skippedCount,
        errors,
      },
      null,
      2,
    ),
    'utf8',
  );

  if (abortedFatal !== null) {
    throw abortedFatal;
  }

  let summary: EvalSuiteSummary | null = null;
  if (opts.scoreAfter) {
    const scoreFn = deps.scoreFn ?? (await loadScoreRunner());
    summary = scoreFn(opts.outDir);
  }

  return {
    outDir: opts.outDir,
    selectedCount: selected.length,
    completedCount,
    skippedCount,
    errors,
    summary,
  };
}

const HELP_TEXT = `用法:
  npm run eval:run -- [选项] [输出目录]

选项:
  --out <dir>            输出目录（默认 eval/runs/v4.2）
  --category <a,b>       按分类筛选（如 clarify,grade）
  --only <id1,id2>       仅运行指定题号（如 C01,Q01）
  --mode <auto|tool>     提示词模式（默认 auto，同网页默认增强模式）
  --model <name>         模型名称（默认读取 DEEPSEEK_MODEL 或 deepseek-chat）
  --concurrency <1-10>   并发数（默认 4）
  --timeout-ms <ms>      单题超时毫秒（默认 90000）
  --skip-existing        跳过输出目录中已生成的 <ID>.md
  --no-score             只采集响应，不在末尾执行 score 统计

环境变量（支持写入 .env.local）:
  DEEPSEEK_API_KEY       必填，DeepSeek API Key
  DEEPSEEK_BASE_URL      可选，默认 https://api.deepseek.com
  DEEPSEEK_MODEL         可选，默认 deepseek-chat`;

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const opts = parseRunArgs(argv);
  if (opts.help) {
    console.log(HELP_TEXT);
    return;
  }
  const report = await executeEvalRun(opts);
  if (report.errors.length > 0 && report.completedCount === 0 && report.skippedCount === 0) {
    process.exitCode = 1;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return (
    resolve(entry) === resolve(fileURLToPath(import.meta.url)) ||
    import.meta.url === pathToFileURL(entry).href
  );
}

if (isMainModule()) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
