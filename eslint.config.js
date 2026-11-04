import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // .agents/** 是其他 agent 会话的嵌套工作树（含各自的配置根），不参与本仓库的 lint。
    ignores: [
      'dist/**',
      'node_modules/**',
      '.tmp/**',
      'test-results/**',
      'playwright-report/**',
      '.agents/**',
      // 构建期生成的 Ajv standalone 校验器：超长单行，由 gen-validator 与
      // generated-validator 测试负责正确性；ESLint 解析该文件需要数分钟。
      'src/protocol/genui-validator.generated.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node 环境的独立脚本与配置文件：显式声明 Node 全局量，不引第三方 globals 包。
    files: ['scripts/**/*.{mjs,ts}', '*.config.{js,ts,mjs}'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
