import { defineConfig } from '@playwright/test';

// 扩展加载测试自行管理持久化上下文（需要 --load-extension），不使用默认 page 夹具。
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
});
