import { createRequire } from 'node:module';

globalThis.require ??= createRequire(import.meta.url);

const [, , subcommand, ...rest] = process.argv;

if (subcommand === 'score') {
  const { runEvaluationSuite } = await import('./score.ts');
  runEvaluationSuite(rest[0] || 'eval/runs/baseline');
} else if (subcommand === 'run') {
  const { runCli } = await import('./run.ts');
  try {
    await runCli(rest);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
} else {
  console.error('用法: node eval/cli.mjs <run|score> [参数]');
  process.exit(1);
}
