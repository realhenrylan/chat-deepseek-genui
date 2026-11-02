# Changelog

## Unreleased

### Added

- 记录 2026-11-01 已确认的 MVP 产品方向，覆盖学习演示、比较决策及计算规划。
- 修订开发任务，将组合式交互界面、即时反馈、默认增强与三个验收场景纳入范围。
- 新增开发指南，收录 Edge 官方资料、Manifest V3、API、权限、本地测试与商店规范，并区分官方要求与项目约束。
- 完成阶段 0 环境、官方规范与真实网页调查，新增 docs/compatibility-investigation.md，记录 Edge 156 上 chat.deepseek.com 的真实 DOM 结构、生命周期、草稿行为、主题切换入口、权限草案；补充取证停止生成按钮（流式中发送位切换为 ■ 停止图标，tooltip「停止生成」，点击截断生成）、`genui` 语言标记代码块渲染（识别边界与原规格一致）、协议提示经可见草稿与用户显式发送透明带入对话的可行路径；最小 genui JSON 输出按单次样本成功记录，未作稳定性结论；勾选阶段 0 全部待办。扩展功能尚未实现或验证。
- 完成阶段 1 工程初始化与最小扩展：引入并以 `--save-exact` 锁定 TypeScript 6.0.3、React 19.3.1、Vite 8.3.5、Ajv 8.20.0 + ajv-formats 3.0.1、Vitest 5.0.5、Playwright 1.64.1、ESLint 10.14.0 等依赖（已生成 package-lock.json 锁定全部版本；该文件与其余阶段 1 产物目前均未提交 git）；新增 tsconfig、flat eslint 配置、vite/playwright 配置与 `typecheck/lint/test/test:e2e/build/check` 命令；新增 MV3 `public/manifest.json`（content_scripts 仅匹配 `https://chat.deepseek.com/*`，**零 permissions/host_permissions、无后台**——按用户决议 storage 等阶段 3 实现开关时再按调用申请）与内容脚本 `src/content/{lifecycle.ts,index.ts}`（幂等注入 `data-genui-ext-loaded` 标记，本阶段无 GenUI 功能）；新增 `scripts/check-dist.mjs` 生产包静态校验（权限/匹配范围/版本一致性 + 扫描 eval/new Function/importScripts/远程脚本 URL/CDN，违规即构建失败，负向测试通过）；新增 11 个单测与 Edge/Chrome 扩展加载 e2e（默认本地模拟页面，`REAL_SITE=1` 走真实网页，`HEADED=1` 有头取证）；新增 README（非官方身份、命令、加载步骤、权限说明、已验证范围）。
- 阶段 1 检查结果：`npm run check` 通过（typecheck、lint、11 单测、build + dist 校验）；`npm ci` 重装后复跑 `npm run check` 与 `npm run test:e2e` 通过；e2e 在 Edge 156.0.4314.50 与 Chrome 156.0.8078.79 对模拟页面与真实 chat.deepseek.com 均注入成功，且未发现可归因于扩展的错误（归因依据脚本 URL/堆栈/`[dsgenui]` 日志前缀；无法归因的错误单列记录、不认定为网站，来源判断待阶段 2+ 补强）；权限经 manifest 静态断言为零申请、不引入后台请求。已知项：运行时依赖审计 0 漏洞，开发依赖存在 11 moderate 告警，根因为传递依赖 `minimatch <11.0.1`（DoS 公告 GHSA-g3hv-75wg-m249，经 eslint / typescript-eslint 链引用）；`npm audit fix`（非强制）无法在当前大版本内修复，强制修复需降级 eslint 大版本，未采纳，不阻塞检查。此阶段不宣称具备 GenUI 功能。
- 完成阶段 2 单个 Card 的完整呈现链路：新增带版本最小 genui 协议 v1（`src/protocol/{types,schema,validate}.ts`——`type:"genui"`/`version:1`/可选 `title`/`elements[{kind:"text",value}]`，Card Schema `additionalProperties:false`，规模限制 64 KiB/深度 16/元素 50/标题 120/文本 2000，失败码 `too-large|too-deep|invalid-json|schema-violation|unsupported-version`，守卫顺序 长度→深度→JSON.parse→结构→版本）与构建期生成的校验器（`scripts/gen-validator.ts` + `src/protocol/genui-validator.generated.ts`，`npm run gen-validator`，prebuild 自动再生成）；新增识别 `src/content/detect.ts`（按阶段 0 依据：仅 AI 回复容器 `div.ds-assistant-message-main-content` 内语言标签 `span.d813de27` 为 `genui` 的代码块，用户消息/json/python/无标签一律跳过）；新增渲染与挂载 `src/render/`（元素注册表、Card、元素级与卡片级错误边界、Shadow DOM 局部挂载、`card.css?inline` 样式隔离、未知元素类型占位、模型输出仅按纯文本渲染）；新增 `src/content/enhance.ts` 幂等增强（`data-genui-state` 标记、原块隐藏保留、查看原始 JSON 切换、解析/验证/渲染失败安全回退、渲染致命错误恢复原内容并卸载卡片）。测试新增 protocol/detect/card/enhance/generated-validator 单测与真实快照 fixture（`tests/fixtures/assistant-genui-message.html`，由阶段 0 `.tmp` 快照逐字提取、仅含合成内容），单测 11→70；e2e 扩展为完整结构模拟页（合法×2/json 标签/用户消息内/非法 JSON/普通段落）+ 阶段 2 断言 + `REAL_SITE=1` 真实网页合成结构最小案例测试。
- 阶段 2 检查结果：`npm run check` 通过（typecheck、lint、70 单测、prebuild 校验器再生成、build 25 模块 231.38 kB + dist 校验零豁免）；e2e 模拟页 4 通过/2 跳过（Edge/Chrome × 阶段 1 注入 + 阶段 2 完整链路：识别、挂载、样式隔离、查看切换、失败回退、多块独立、扩展零错误）；`REAL_SITE=1` e2e 4 通过/2 跳过（含两渠道真实网页合成结构最小案例，为合成结构验证而非站点原生 genui 输出）；dist 校验负向测试（追加远程 URL → 构建失败）通过。**关键发现与修复**：首次 e2e 全数失败——Ajv 运行时 `new Function` 编译被 MV3 内容脚本 CSP（无 `unsafe-eval`）以 `EvalError` 拒绝，init 中断、Card 零挂载，而单测（Node/jsdom 允许 eval）无法暴露；改为构建期 Ajv standalone 代码生成（`npm run gen-validator`，prebuild 自动执行），运行时零动态执行，产物逐字节一致与不含 `eval(`/`new Function(` 由单测锁定，dist 由 346.61 kB/92 模块降至 231.38 kB/25 模块，ajv/ajv-formats 移入 devDependencies。check-dist 曾为 Ajv `$id` URL 引入精确豁免，负向测试暴露「`text.match` 首个命中 + 豁免」造成同文件后续违规漏检，改为 `matchAll` 逐条扫描；Ajv 移出运行时后豁免整体移除，恢复零豁免。
- 阶段 2 真实网页人工验证通过（2026-11-02，Edge 156 真实会话）：genui 代码块原位渲染为 Card、查看原始 JSON 切换双向正常且卡片常驻、json 标签与用户消息零影响、页面其他功能正常、控制台过滤 `[dsgenui]` 无扩展错误（debug 日志需 Verbose 级别可见）；页面既有 `gator.volces.com` 的 `ERR_BLOCKED_BY_CLIENT`（第三方采集 SDK `collect-rangers-v5.2.11.js`）经关闭本扩展对照测试确认依旧存在，与本扩展无关（本扩展零权限、不具备请求拦截能力）。

### Changed

- 将 development-task 按阶段 0 至阶段 8 的开发顺序重排，每阶段列出待办、交付物和通过条件。
- 复核阶段 0 补测记录：明确默认开启为已确认产品要求，区分人工透明带入链路与未实现的扩展增强；旧 json 样本按识别规则跳过，初次发送按钮快照不作为流式状态判据；同步更新开发任务首页状态。

当前状态：阶段 0–2 已完成——扩展已能在 AI 回复中识别 `genui` 代码块并渲染为样式隔离的 GenUI Card（含原始内容查看与失败回退），可构建、可加载，`npm run check` 与模拟页/真实网页双模式 e2e 通过；阶段 3–8 未开始（默认增强触发、交互控件与模型真实生成验收未进行），各阶段状态以 development-task 与本记录为准。
