import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 构建目标：单入口内容脚本（IIFE 单文件，依赖全部本地打包）。
// 阶段 2 起渲染样式经 `?inline` 导入并注入 Shadow DOM（card.css），产物无远程样式引用。
// __DSGENUI_VERSION__：把 package.json 版本写进内容脚本，供真实页面对账
// （documentElement 的 data-genui-version 属性，见 src/content/lifecycle.ts）。
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  define: {
    __DSGENUI_VERSION__: JSON.stringify(pkgVersion.version),
  },
  plugins: [react()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/content/index.ts',
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
        // vite 8 下单入口由 codeSplitting:false 保证单文件，
        // inlineDynamicImports 冗余并触发警告，故不设置。
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
});
