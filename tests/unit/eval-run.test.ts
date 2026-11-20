import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENUI_PROMPT_TEXT, GENUI_TOOL_PROMPT_TEXT } from '../../src/content/prompt.ts';
import {
  buildEvalUserPrompt,
  executeEvalRun,
  loadLocalEnvFiles,
  normalizeCompletionsUrl,
  parseEnvFileContent,
  parseRunArgs,
} from '../../eval/run.ts';
import { runEvaluationSuite } from '../../eval/score.ts';

describe('Eval API Runner', () => {
  it('解析 .env / .env.local 文本且不覆盖已有环境变量', () => {
    const parsed = parseEnvFileContent(
      [
        '# comment',
        'DEEPSEEK_API_KEY="sk-test-123"',
        "export DEEPSEEK_BASE_URL='https://api.example.com/v1/'",
        'EMPTY_VAL=',
      ].join('\n'),
    );
    expect(parsed).toEqual({
      DEEPSEEK_API_KEY: 'sk-test-123',
      DEEPSEEK_BASE_URL: 'https://api.example.com/v1/',
      EMPTY_VAL: '',
    });

    const dir = mkdtempSync(join(tmpdir(), 'genui-eval-env-'));
    try {
      writeFileSync(join(dir, '.env'), 'DEEPSEEK_API_KEY=from-env\nDEEPSEEK_MODEL=deepseek-chat\n');
      writeFileSync(join(dir, '.env.local'), 'DEEPSEEK_API_KEY=from-local\n');

      const targetEnv: Record<string, string | undefined> = {
        DEEPSEEK_MODEL: 'already-set',
      };
      loadLocalEnvFiles(dir, targetEnv);
      expect(targetEnv.DEEPSEEK_API_KEY).toBe('from-local');
      expect(targetEnv.DEEPSEEK_MODEL).toBe('already-set');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('正确解析 CLI 参数与补全 URL，并用真实扩展链路拼接提示词', () => {
    expect(normalizeCompletionsUrl('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/chat/completions',
    );
    expect(normalizeCompletionsUrl('https://api.deepseek.com/v1/')).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    );
    expect(normalizeCompletionsUrl('https://proxy.example.com/v1/chat/completions')).toBe(
      'https://proxy.example.com/v1/chat/completions',
    );

    const opts = parseRunArgs(
      [
        '--out',
        'eval/runs/custom',
        '--category',
        'clarify,grade',
        '--only',
        'C01,Q01',
        '--mode',
        'tool',
        '--model',
        'deepseek-reasoner',
        '--concurrency',
        '6',
        '--skip-existing',
      ],
      {},
    );
    expect(opts).toMatchObject({
      outDir: 'eval/runs/custom',
      categories: ['clarify', 'grade'],
      onlyIds: ['C01', 'Q01'],
      mode: 'tool',
      model: 'deepseek-reasoner',
      concurrency: 6,
      skipExisting: true,
      scoreAfter: true,
    });

    const autoPrompt = buildEvalUserPrompt('测试一下', 'auto');
    expect(autoPrompt).toBe(`测试一下\n\n${GENUI_PROMPT_TEXT}`);

    const toolPrompt = buildEvalUserPrompt('测试一下', 'tool');
    expect(toolPrompt).toBe(`测试一下\n\n${GENUI_TOOL_PROMPT_TEXT}`);
  });

  it('缺少 API Key 时明确报错并提示使用 .env.local', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genui-eval-nokey-'));
    try {
      mkdirSync(join(dir, 'eval'), { recursive: true });
      writeFileSync(join(dir, 'eval', 'prompts.json'), readFileSync(resolve('eval/prompts.json'), 'utf8'));

      await expect(
        executeEvalRun(parseRunArgs(['--only', 'C01']), {
          rootDir: dir,
          env: {},
          log: () => {},
        }),
      ).rejects.toThrow('DEEPSEEK_API_KEY');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('支持并发请求、429 重试、skip-existing，并输出可被 score.ts 统计的响应目录', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genui-eval-mock-'));
    try {
      mkdirSync(join(dir, 'eval'), { recursive: true });
      writeFileSync(join(dir, 'eval', 'prompts.json'), readFileSync(resolve('eval/prompts.json'), 'utf8'));
      mkdirSync(join(dir, 'out'), { recursive: true });
      writeFileSync(join(dir, 'out', 'C01.md'), '已有 C01 响应，应被跳过。');

      const calls: Array<{ idHint: string; auth: string | null }> = [];
      let q01Attempts = 0;

      const fakeFetch: typeof globalThis.fetch = async (_input, init) => {
        const headers = new Headers(init?.headers);
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ content: string }>;
        };
        const content = body.messages[0].content;

        if (content.includes('HTTP 方法幂等性')) {
          q01Attempts += 1;
          calls.push({ idHint: 'Q01', auth: headers.get('Authorization') });
          if (q01Attempts === 1) {
            return new Response('rate limited', { status: 429 });
          }
          const reply = [
            '先回顾概念，下面是测验：',
            '```genui',
            JSON.stringify({
              w: 'form',
              title: '请作答',
              fields: [
                { id: 'q1', type: 'radio', label: '第 1 题', options: ['PUT 幂等', 'POST 幂等'] },
              ],
              submit: {
                label: '提交给我批改',
                prompt: '第 1 题我选择 {q1}，请帮我批改并点评理由。',
              },
            }),
            '```',
          ].join('\n');
          return new Response(
            JSON.stringify({ choices: [{ message: { content: reply } }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        calls.push({ idHint: 'other', auth: headers.get('Authorization') });
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '普通纯文本回答。' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const opts = parseRunArgs([
        '--out',
        'out',
        '--only',
        'C01,Q01',
        '--skip-existing',
        '--concurrency',
        '2',
      ]);
      const report = await executeEvalRun(opts, {
        rootDir: dir,
        env: { DEEPSEEK_API_KEY: 'sk-mock-xyz' },
        fetchFn: fakeFetch,
        retryDelayMs: 0,
        scoreFn: (runsDir) => runEvaluationSuite(join(dir, runsDir)),
        log: () => {},
      });

      expect(report.selectedCount).toBe(2);
      expect(report.skippedCount).toBe(1);
      expect(report.completedCount).toBe(1);
      expect(report.errors).toEqual([]);
      expect(q01Attempts).toBe(2);
      expect(calls.every((c) => c.auth === 'Bearer sk-mock-xyz')).toBe(true);
      expect(readFileSync(join(dir, 'out', 'C01.md'), 'utf8')).toBe('已有 C01 响应，应被跳过。');
      expect(existsSync(join(dir, 'out', '_run-meta.json'))).toBe(true);
      expect(report.summary?.evaluatedCount).toBe(2);
      expect(report.summary?.quizNoPreselectRate).toEqual({ count: 1, total: 1, rate: 1 });
      expect(report.summary?.templateSelfConsistencyRate).toEqual({ count: 1, total: 1, rate: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('遇到 401 鉴权失败立即中止并抛出异常', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genui-eval-auth-'));
    try {
      mkdirSync(join(dir, 'eval'), { recursive: true });
      writeFileSync(join(dir, 'eval', 'prompts.json'), readFileSync(resolve('eval/prompts.json'), 'utf8'));

      const fakeFetch: typeof globalThis.fetch = async () =>
        new Response('invalid api key', { status: 401 });

      await expect(
        executeEvalRun(parseRunArgs(['--out', 'out', '--only', 'C01,Q01', '--concurrency', '1']), {
          rootDir: dir,
          env: { DEEPSEEK_API_KEY: 'sk-bad' },
          fetchFn: fakeFetch,
          retryDelayMs: 0,
          log: () => {},
        }),
      ).rejects.toThrow('HTTP 401');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
