# Changelog

## Unreleased

### Added

- 记录 2026-11-01 已确认的 MVP 产品方向，覆盖学习演示、比较决策及计算规划。
- 修订开发任务，将组合式交互界面、即时反馈、默认增强与三个验收场景纳入范围。
- 新增开发指南，收录 Edge 官方资料、Manifest V3、API、权限、本地测试与商店规范，并区分官方要求与项目约束。
- 完成阶段 0 环境、官方规范与真实网页调查，新增 docs/compatibility-investigation.md，记录 Edge 156 上 chat.deepseek.com 的真实 DOM 结构、生命周期、草稿行为、主题切换入口、权限草案；补充取证停止生成按钮（流式中发送位切换为 ■ 停止图标，tooltip「停止生成」，点击截断生成）、`genui` 语言标记代码块渲染（识别边界与原规格一致）、协议提示经可见草稿与用户显式发送透明带入对话的可行路径；最小 genui JSON 输出按单次样本成功记录，未作稳定性结论；勾选阶段 0 全部待办。扩展功能尚未实现或验证。
- 完成阶段 1 工程初始化与最小扩展：引入并以 `--save-exact` 锁定 TypeScript 6.0.3、React 19.3.1、Vite 8.3.5、Ajv 8.20.0 + ajv-formats 3.0.1、Vitest 5.0.5、Playwright 1.64.1、ESLint 10.14.0 等依赖（已生成 package-lock.json 锁定全部版本；该文件与其余阶段 1 产物目前均未提交 git）；新增 tsconfig、flat eslint 配置、vite/playwright 配置与 `typecheck/lint/test/test:e2e/build/check` 命令；新增 MV3 `public/manifest.json`（content_scripts 仅匹配 `https://chat.deepseek.com/*`，**零 permissions/host_permissions、无后台**——按用户决议 storage 等阶段 3 实现开关时再按调用申请）与内容脚本 `src/content/{lifecycle.ts,index.ts}`（幂等注入 `data-genui-ext-loaded` 标记，本阶段无 GenUI 功能）；新增 `scripts/check-dist.mjs` 生产包静态校验（权限/匹配范围/版本一致性 + 扫描 eval/new Function/importScripts/远程脚本 URL/CDN，违规即构建失败，负向测试通过）；新增 11 个单测与 Edge/Chrome 扩展加载 e2e（默认本地模拟页面，`REAL_SITE=1` 走真实网页，`HEADED=1` 有头取证）；新增 README（非官方身份、命令、加载步骤、权限说明、已验证范围）。
- 阶段 1 检查结果：`npm run check` 通过（typecheck、lint、11 单测、build + dist 校验）；`npm ci` 重装后复跑 `npm run check` 与 `npm run test:e2e` 通过；e2e 在 Edge 156.0.4314.50 与 Chrome 156.0.8078.79 对模拟页面与真实 chat.deepseek.com 均注入成功，且未发现可归因于扩展的错误（归因依据脚本 URL/堆栈/`[dsgenui]` 日志前缀；无法归因的错误单列记录、不认定为网站，来源判断待阶段 2+ 补强）；权限经 manifest 静态断言为零申请、不引入后台请求。已知项：运行时依赖审计 0 漏洞，开发依赖存在 11 moderate 告警，根因为传递依赖 `minimatch <11.0.1`（DoS 公告 GHSA-g3hv-75wg-m249，经 eslint / typescript-eslint 链引用）；`npm audit fix`（非强制）无法在当前大版本内修复，强制修复需降级 eslint 大版本，未采纳，不阻塞检查。此阶段不宣称具备 GenUI 功能。

### Changed

- 将 development-task 按阶段 0 至阶段 8 的开发顺序重排，每阶段列出待办、交付物和通过条件。
- 复核阶段 0 补测记录：明确默认开启为已确认产品要求，区分人工透明带入链路与未实现的扩展增强；旧 json 样本按识别规则跳过，初次发送按钮快照不作为流式状态判据；同步更新开发任务首页状态。

当前状态：阶段 0 调查与阶段 1 工程初始化已完成——最小扩展可构建、可加载，但扩展尚不具备 GenUI 功能（阶段 2 起实现）；阶段 2–8 未开始，各阶段状态以 development-task 与本记录为准。
