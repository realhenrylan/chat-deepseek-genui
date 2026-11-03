/**
 * 全局构建注入。
 *
 * `__DSGENUI_VERSION__` 由 vite.config.ts 的 `define` 从 package.json 写入，
 * 仅构建产物存在；vitest 等无 define 环境运行时为 undefined，
 * 读取方必须用 `typeof … !== 'undefined'` 保护（见 src/content/lifecycle.ts）。
 */
declare const __DSGENUI_VERSION__: string;
