import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * P2 复核（阶段 6）补偿不变量：真实 origin 的 e2e 请求断言只能按 URL 识别
 * chrome-extension:// 起源（扩展页面上下文），无法区分「内容脚本发起的 https
 * 请求」与站点自身请求（Playwright 未暴露可信的 initiator 归因）。因此由本
 * 测试静态锁定：除 MAIN world 拦截器外，src/ 下的生产源码不得引用任何网络 API。
 * 维度互补：manifest（零 host_permissions、无后台）→ 构建期 dist 校验（无远程
 * 资源/动态执行）→ 本测试（源码零网络 API，拦截器只包裹原生 fetch）→ 真实 origin
 * URL 红线。
 */

// 注意：不用 new URL(…, import.meta.url)——Vite 会静态改写该模式导致解析失真。
// vitest 的 root 恒定为本仓库根（npm scripts 均从根目录运行），按 cwd 解析即可。
const SOURCE_ROOT = join(process.cwd(), 'src');
/** 唯一允许接触网络 API 的文件：MAIN world 拦截器包裹原生 fetch，不自行发起请求。 */
const INTERCEPTOR_FILE = join(SOURCE_ROOT, 'content', 'interceptor.ts');

const collectTypeScriptFiles = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTypeScriptFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
};

const SOURCE_FILES = collectTypeScriptFiles(SOURCE_ROOT);

/** 出现在源码任何位置（含字符串/注释）都按违规处理，避免维护免检白名单。 */
const NETWORK_API = new RegExp(
  ['fetch', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource']
    .map((name) => `\\b${name}\\b`)
    .join('|'),
  'g',
);

const scanLines = (file: string): string[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .map((line, index) => ({ lineNo: index + 1, line }))
    .filter(({ line }) => NETWORK_API.test(line))
    .map(({ lineNo, line }) => `${file}:${lineNo}: ${line.trim()}`);

describe('内容脚本静态不变量：生产源码零网络调用', () => {
  it('除 MAIN world 拦截器外，src/ 下的 TS/TSX 源码不含任何网络 API 引用', () => {
    const offenders = SOURCE_FILES.filter((file) => file !== INTERCEPTOR_FILE).flatMap(scanLines);

    expect(
      offenders,
      '内容脚本必须零网络调用；如需新增网络能力，先在开发指南中评审权限与归因口径',
    ).toEqual([]);
  });

  it('拦截器只包裹原生 fetch，不自行发起请求、不引用远程地址或扩展 API', () => {
    const source = readFileSync(INTERCEPTOR_FILE, 'utf8');
    expect(source).toContain('fetch');
    expect(source).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/\bchrome\./);
  });

  it('扫描确实覆盖 src/ 下的源码（防止目录变化造成扫描真空）', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(10);
    const posixPaths = SOURCE_FILES.map((file) => file.replace(/\\/g, '/'));
    expect(posixPaths.some((file) => file.endsWith('followup.ts'))).toBe(true);
    expect(posixPaths.some((file) => file.endsWith('content/index.ts'))).toBe(true);
    expect(posixPaths.some((file) => file.endsWith('content/interceptor.ts'))).toBe(true);
  });
});
