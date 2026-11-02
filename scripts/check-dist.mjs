#!/usr/bin/env node
/**
 * 生产包静态校验（npm run postbuild 自动执行）。
 *
 * 检查项：
 * 1. dist/manifest.json 存在且为 MV3，匹配范围严格限定 https://chat.deepseek.com/*；
 * 2. 阶段 1 权限决议：不申请任何 permissions / host_permissions / background（开发指南 §3
 *    “按实际 API 调用声明权限”，storage 等待阶段 3 实现开关时按调用补充）；
 * 3. 内容脚本产物 content.js 存在且非空，manifest 与 package.json 版本一致；
 * 4. 全包扫描：禁止 eval / new Function / importScripts、远程脚本与样式 URL、常见 CDN 域名、
 *    动态 <script src> —— 确保生产包只加载本地资源（开发指南 §4、Manifest V3 禁止远程代码）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const ALLOWED_PERMISSIONS = []; // 阶段 1：零额外权限。阶段 3 需要时在此登记 storage。
const ALLOWED_HOST_PERMISSIONS = [];

/** 违规即构建失败的模式（violation patterns）。 */
const FORBIDDEN = [
  { name: 'eval()', re: /\beval\s*\(/ },
  { name: 'new Function()', re: /new\s+Function\s*\(/ },
  { name: 'importScripts()', re: /\bimportScripts\s*\(/ },
  { name: '动态 <script src>', re: /<script[^>]*\ssrc\s*=/i },
  { name: '远程 JS/CSS URL', re: /https?:\/\/[^\s"'`)]+\.(?:m?js|css)(?:\?[^\s"'`)]*)?/ },
  {
    name: 'CDN 域名',
    re: /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/,
  },
];

const errors = [];

function fail(message) {
  errors.push(message);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// ---- 1/2/3：manifest 与产物 ----
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
} catch (error) {
  fail(`dist/manifest.json 缺失或无法解析：${error.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail(`manifest_version 应为 3，实际 ${manifest.manifest_version}`);

  const matches = manifest.content_scripts?.flatMap((cs) => cs.matches ?? []) ?? [];
  const expected = ['https://chat.deepseek.com/*'];
  if (JSON.stringify([...matches].sort()) !== JSON.stringify(expected)) {
    fail(`content_scripts 匹配范围应严格为 ${expected.join(', ')}，实际：${matches.join(', ') || '(空)'}`);
  }

  const permissions = manifest.permissions ?? [];
  if (JSON.stringify([...permissions].sort()) !== JSON.stringify(ALLOWED_PERMISSIONS)) {
    fail(`permissions 应为 [${ALLOWED_PERMISSIONS.join(', ')}]（阶段 1 零额外权限），实际：[${permissions.join(', ')}]`);
  }
  const hostPermissions = manifest.host_permissions ?? [];
  if (JSON.stringify([...hostPermissions].sort()) !== JSON.stringify(ALLOWED_HOST_PERMISSIONS)) {
    fail(`host_permissions 应为空，实际：[${hostPermissions.join(', ')}]`);
  }
  if (manifest.background) fail('阶段 1 不应包含 background（阶段 0 结论：无后台逻辑需求）');

  const js = manifest.content_scripts?.flatMap((cs) => cs.js ?? []) ?? [];
  if (JSON.stringify(js) !== JSON.stringify(['content.js'])) {
    fail(`content_scripts js 应为 ["content.js"]，实际：[${js.join(', ')}]`);
  }

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) {
    fail(`manifest 版本 ${manifest.version} 与 package.json 版本 ${pkg.version} 不一致`);
  }
}

const contentJs = join(dist, 'content.js');
if (!exists(contentJs) || statSync(contentJs).size === 0) {
  fail('dist/content.js 缺失或为空');
}

// ---- 4：全包扫描 ----
function exists(file) {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

let files = [];
try {
  files = walk(dist);
  if (files.length === 0) fail('dist 目录为空');
} catch (error) {
  fail(`dist 目录缺失或不可读：${error.message}`);
}
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const { name, re } of FORBIDDEN) {
    // 全局匹配逐条检查：text.match(re) 只返回首个命中，会漏检其后的违规。
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const match of text.matchAll(global)) {
      fail(`${relative(root, file)} 含 ${name}：${match[0].slice(0, 120)}`);
      break; // 每个模式每个文件只报告首个违规（保持原有信息量）
    }
  }
}

// ---- 汇总 ----
if (errors.length > 0) {
  console.error('生产包校验未通过：');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const sizes = files.map((f) => `${relative(dist, f)} (${statSync(f).size} B)`);
console.log(`生产包校验通过：${files.length} 个文件`);
for (const size of sizes.sort()) console.log(`  - ${size}`);
console.log('  - 权限：无 permissions / host_permissions / background（阶段 1 决议）');
console.log('  - 未发现远程脚本、CDN 或动态执行模式');
