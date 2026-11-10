import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vitest/config';

// 构建目标：两个独立 IIFE 产物。
// - content.js：隔离世界内容脚本（卡片渲染、浮标、DOM 兜底）；
// - interceptor.js：MAIN world 网络层拦截器（document_start，只做 fetch 转发与剥离）。
// 两个入口都必须单文件，因此分两次构建；第二次不清空 dist、也不重复拷贝 public。
// __DSGENUI_VERSION__：把 package.json 版本写进内容脚本，供真实页面对账
// （documentElement 的 data-genui-version 属性，见 src/content/lifecycle.ts）。
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const shared: UserConfig = {
  define: {
    __DSGENUI_VERSION__: JSON.stringify(pkgVersion.version),
  },
  plugins: [react()],
};

export default defineConfig(({ mode }): UserConfig => {
  if (mode === 'interceptor') {
    return {
      ...shared,
      publicDir: false,
      build: {
        outDir: 'dist',
        target: 'es2022',
        emptyOutDir: false,
        rollupOptions: {
          input: 'src/content/interceptor.ts',
          output: {
            format: 'iife',
            entryFileNames: 'interceptor.js',
          },
        },
      },
    };
  }

  return {
    ...shared,
    build: {
      outDir: 'dist',
      target: 'es2022',
      emptyOutDir: true,
      rollupOptions: {
        input: { content: 'src/content/index.ts' },
        output: {
          format: 'iife',
          entryFileNames: '[name].js',
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
  };
});
