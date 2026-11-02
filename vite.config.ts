import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 阶段 1 构建目标：单入口内容脚本（IIFE 单文件，依赖全部本地打包）。
// 渲染样式引入方式（?inline 注入）在阶段 2 出现首个 UI 组件时启用。
export default defineConfig({
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
