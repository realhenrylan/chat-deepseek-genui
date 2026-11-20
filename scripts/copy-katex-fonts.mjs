#!/usr/bin/env node
/**
 * 构建期拷贝 KaTeX 本地 woff2 字体到 dist/fonts/katex/。
 *
 * 扩展严禁加载远程字体或 CDN；仅拷贝现代 Chromium/Edge 原生支持的 .woff2，
 * 并在 manifest.json 的 web_accessible_resources 中限定仅 https://chat.deepseek.com/* 可访问。
 */

import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', 'katex', 'dist', 'fonts');
const dstDir = join(root, 'dist', 'fonts', 'katex');

mkdirSync(dstDir, { recursive: true });

let copied = 0;
for (const entry of readdirSync(srcDir)) {
  if (!entry.endsWith('.woff2')) continue;
  copyFileSync(join(srcDir, entry), join(dstDir, entry));
  copied += 1;
}

if (copied === 0) {
  console.error('未找到任何 KaTeX .woff2 字体文件，请检查 katex 依赖是否已安装。');
  process.exit(1);
}

console.log(`已复制 ${copied} 个 KaTeX 本地字体到 dist/fonts/katex/`);
