#!/usr/bin/env node
/**
 * 生产包静态校验（npm run postbuild 自动执行）。
 *
 * 检查项：
 * 1. dist/manifest.json 存在且为 MV3，匹配范围严格限定 https://chat.deepseek.com/*；
 * 2. 按实际 API 调用检查权限：仅允许阶段 3 本地开关所需的 storage；
 *    不申请 host_permissions 或 background（开发指南 §3）；
 * 3. 内容脚本产物 content.js 与 MAIN world 拦截器 interceptor.js 均存在且非空，
 *    manifest 与 package.json 版本一致；
 * 4. Edge 商店国际化：manifest 的 name/description 为 __MSG_<key>__ 引用，声明 default_locale，
 *    每个 _locales/<locale>/messages.json 都提供被引用键的非空译文（Partner Center 据此识别语言）；
 * 5. 全包扫描：禁止 eval / new Function / importScripts、远程脚本与样式 URL、常见 CDN 域名、
 *    动态 <script src> —— 确保生产包只加载本地资源（开发指南 §4、Manifest V3 禁止远程代码）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const ALLOWED_PERMISSIONS = ['storage']; // 阶段 3：本地增强开关持久化。
const ALLOWED_HOST_PERMISSIONS = [];
/** 必须随包提供的语言；Edge 商店列表据此提供对应语言的商品页。 */
const REQUIRED_LOCALES = ['en', 'zh_CN'];

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
let locales = [];
try {
  manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
} catch (error) {
  fail(`dist/manifest.json 缺失或无法解析：${error.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail(`manifest_version 应为 3，实际 ${manifest.manifest_version}`);

  const matches = [
    ...new Set(manifest.content_scripts?.flatMap((cs) => cs.matches ?? []) ?? []),
  ];
  const expected = ['https://chat.deepseek.com/*'];
  if (JSON.stringify([...matches].sort()) !== JSON.stringify(expected)) {
    fail(`content_scripts 匹配范围应严格为 ${expected.join(', ')}，实际：${matches.join(', ') || '(空)'}`);
  }

  const permissions = manifest.permissions ?? [];
  if (JSON.stringify([...permissions].sort()) !== JSON.stringify(ALLOWED_PERMISSIONS)) {
    fail(`permissions 应为 [${ALLOWED_PERMISSIONS.join(', ')}]（仅含阶段 3 开关所需权限），实际：[${permissions.join(', ')}]`);
  }
  const hostPermissions = manifest.host_permissions ?? [];
  if (JSON.stringify([...hostPermissions].sort()) !== JSON.stringify(ALLOWED_HOST_PERMISSIONS)) {
    fail(`host_permissions 应为空，实际：[${hostPermissions.join(', ')}]`);
  }
  if (manifest.background) fail('不应包含 background（阶段 0 结论：无后台逻辑需求）');

  const js = manifest.content_scripts?.flatMap((cs) => cs.js ?? []) ?? [];
  if (JSON.stringify(js) !== JSON.stringify(['interceptor.js', 'content.js'])) {
    fail(`content_scripts js 应为 ["interceptor.js", "content.js"]，实际：[${js.join(', ')}]`);
  }
  const interceptorEntry = (manifest.content_scripts ?? []).find((cs) =>
    (cs.js ?? []).includes('interceptor.js'),
  );
  if (!interceptorEntry) {
    fail('缺少 interceptor.js 的 content_scripts 条目');
  } else {
    if (interceptorEntry.world !== 'MAIN') {
      fail(`interceptor 条目 world 应为 "MAIN"，实际：${String(interceptorEntry.world)}`);
    }
    if (interceptorEntry.run_at !== 'document_start') {
      fail(`interceptor 条目 run_at 应为 "document_start"，实际：${String(interceptorEntry.run_at)}`);
    }
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
const interceptorJs = join(dist, 'interceptor.js');
if (!exists(interceptorJs) || statSync(interceptorJs).size === 0) {
  fail('dist/interceptor.js 缺失或为空');
}

// ---- 4：Edge 商店国际化 ----
/** 从 __MSG_key__ 占位符中取出 key；不是占位符时返回 null。 */
function msgKey(value) {
  const match = /^__MSG_([A-Za-z0-9_@]+)__$/.exec(typeof value === 'string' ? value : '');
  return match ? match[1] : null;
}

if (manifest) {
  // Partner Center 只识别 __MSG_ 引用；写死字符串会导致列表页只能出现一种语言。
  const localizedFields = ['name', 'description'];
  const referencedKeys = new Set();
  for (const field of localizedFields) {
    const key = msgKey(manifest[field]);
    if (!key) {
      fail(`manifest.${field} 应使用 __MSG_<key>__ 国际化占位符，实际：${JSON.stringify(manifest[field])}`);
      continue;
    }
    referencedKeys.add(key);
  }

  const localesRoot = join(dist, '_locales');
  try {
    locales = readdirSync(localesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    fail(`dist/_locales 缺失或不可读：${error.message}`);
  }

  if (typeof manifest.default_locale !== 'string' || manifest.default_locale.trim() === '') {
    fail('manifest 缺少 default_locale（使用 __MSG_ 占位符时必填，例如 "en"）');
  } else if (locales.length > 0 && !locales.includes(manifest.default_locale)) {
    fail(`default_locale "${manifest.default_locale}" 在 dist/_locales 中没有对应目录`);
  }

  for (const locale of REQUIRED_LOCALES) {
    if (!locales.includes(locale)) fail(`缺少必需语言目录 dist/_locales/${locale}`);
  }

  for (const locale of locales) {
    let messages;
    try {
      messages = JSON.parse(readFileSync(join(localesRoot, locale, 'messages.json'), 'utf8'));
    } catch (error) {
      fail(`_locales/${locale}/messages.json 缺失或无法解析：${error.message}`);
      continue;
    }
    for (const key of referencedKeys) {
      const entry = messages[key];
      const message = entry?.message;
      if (typeof message !== 'string' || message.trim() === '') {
        fail(`_locales/${locale}/messages.json 缺少非空译文：${key}`);
        continue;
      }
      // 占位符只能由 manifest 定义，消息里出现 $NAME$ 时必须已声明，否则浏览器会丢掉整条译文。
      for (const placeholder of message.matchAll(/\$([A-Za-z0-9_@]+)\$/g)) {
        const defined = manifest[placeholder[1]] !== undefined;
        const declared = entry.placeholders && Object.prototype.hasOwnProperty.call(entry.placeholders, placeholder[1]);
        if (!defined && !declared) {
          fail(`_locales/${locale}/messages.json 的 ${key} 使用了未声明的占位符 $${placeholder[1]}$`);
        }
      }
    }
  }
}

// ---- 5：全包扫描 ----
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
console.log('  - 权限：storage（本地增强开关）；无 host_permissions / background');
console.log(`  - 国际化：${manifest ? `default_locale=${manifest.default_locale}；语言 ${locales.join(', ')}` : 'manifest 不可用，未检查'}`);
console.log('  - 未发现远程脚本、CDN 或动态执行模式');
