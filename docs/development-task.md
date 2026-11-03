# DeepSeek GenUI — MVP v0.1.1 开发任务

当前分发版本：**0.1.1**（2026-11-03）。README 已加入明暗 Logo 并重写为功能介绍；项目版本、当前隐私说明、构建标记与发布 ZIP 已同步。`npm run check`（253 项单测）及默认 Edge/Chrome e2e（18 通过、6 跳过）通过，ZIP 含全部 7 个运行时文件。当前校验值见 [分层报告](phase8-verification.md)；本轮未重跑真实 origin 或真实模型会话。

更新日期：2026-11-03。阶段 0–8 已完成；Edge Add-ons 商店提交与审核未执行（原因与素材见阶段 8 记录与 [store-submission.md](store-submission.md)），发布准备不等于已上架。阶段 7 默认增强 v2 已接入运行时，并完成真实 DeepSeek 网页三场景、同类新问题、普通问答、关闭/恢复与说明面板验收；收尾修复三项 P2，并并入视口门控、版本对账标记与 browser-skill 操作手册。阶段 4 真实会话单案例手工复核完成，原两项 P2 与计算上限严格检查已在阶段 5 收尾修复并重跑检查；阶段 5/6 的本地示例与合成文档验证见对应阶段记录。阶段 8 完成全量复检、双浏览器版本记录、生产包与发布 ZIP、Edge Add-ons 政策逐条复核、隐私说明与分层验证报告，见 [phase8-verification.md](phase8-verification.md)。

产品目标与验收范围见[产品规格](product-spec.md)。Edge 官方资料、技术基线、权限和工程规范见[开发指南](development-guide.md)。执行前先阅读这两份文档。

按以下顺序推进，每阶段先完成必要的行为测试，再实现和重构，记录产物及检查结果并更新 CHANGELOG。真实环境受限时可继续无关的本地工作，但不能猜测页面行为或将未验证的阶段标记为完成。涉及产品目标的变更需要说明影响。

## 阶段 0：环境、官方规范与真实网页调查

### 待办

- [x] 检查仓库规范、Git 状态和浏览器环境，记录版本。
- [x] 阅读开发指南中的官方资料，确认 MV3、所需 API 和最低权限方案。
- [x] 观察真实网页中的 AI 回复与用户消息边界、代码块语言标记和复制功能。
- [x] 观察流式生成、停止、重新生成、节点替换、会话切换和主题变化。
- [x] 调查输入框与草稿行为，确定不自动发送、不覆盖草稿的集成路径。
- [x] 调查可见、可关闭的默认增强路径，用最小协议草案进行早期模型输出验证。
- [x] 记录观察依据、验证方法、不确定项和受限原因，避开认证信息及个人聊天内容。

### 交付物与通过条件

编写 docs/compatibility-investigation.md，包含真实观察、适配依据、默认增强可行性、权限草案及风险。页面集成必须有证据支持；若需要改变产品承诺，先说明依据和影响，不将手动粘贴描述为默认自动体验。

## 阶段 1：工程初始化与最小扩展

### 待办

- [x] 初始化 TypeScript、React、Vite、Schema 验证、单元与浏览器测试工具，锁定依赖。
- [x] 配置类型检查、lint、测试和构建命令。
- [x] 建立 Manifest V3 与 Content Script，匹配范围限定为 https://chat.deepseek.com/*。
- [x] 根据阶段 0 配置必要权限，仅在确有需要时添加后台逻辑。
- [x] 确保生产包包含本地脚本、样式和依赖，不加载远程执行资源。
- [x] 在 Edge 加载构建目录并检查错误，在 Chrome 检查基本加载兼容性。
- [x] 建立 README，记录实际验证的命令、安装步骤、当前状态和非官方身份。

### 交付物与通过条件

交付最小扩展、构建配置、锁文件、检查命令和初始 README。检查命令可运行，生产包可加载，权限经过检查且不影响原页面。此时不宣称具备 GenUI 功能。

### 阶段 1 完成记录（2026-11-02）

- 交付物：`package.json` + `package-lock.json`（依赖全部 `--save-exact` 锁定：TypeScript 6.0.3、React 19.3.1、Vite 8.3.5、Ajv 8.20.0、ajv-formats 3.0.1、Vitest 5.0.5、Playwright 1.64.1、ESLint 10.14.0 等）；`tsconfig.json`、`eslint.config.js`、`vite.config.ts`、`playwright.config.ts`；`public/manifest.json`（MV3，content_scripts 仅 `https://chat.deepseek.com/*`，零 permissions/host_permissions、无后台——storage 按用户决议留待阶段 3 实现开关时按调用申请）；`src/content/{lifecycle.ts,index.ts}`（幂等注入 `data-genui-ext-loaded` 标记，无 GenUI 功能）；`scripts/check-dist.mjs` 生产包静态校验；`tests/unit/*`（11 用例）与 `tests/e2e/extension-load.spec.ts`；`README.md`。
- 检查命令：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`（postbuild 自动跑 dist 校验）、`npm run check`（聚合）、`npm run test:e2e`。
- 实际结果：`npm run check` 全部通过；`npm ci` 重装后复跑 `npm run check` 与 `npm run test:e2e` 通过（exit 0）；e2e 在 Edge 156.0.4314.50 与 Chrome 156.0.8078.79 对本地模拟页与真实 chat.deepseek.com 均注入成功，且未发现可归因于扩展的错误（归因依据脚本 URL/堆栈/`[dsgenui]` 日志前缀；无法归因的错误单列记录、不认定为网站，来源判断待阶段 2+ 补强）；dist 校验负向测试（人为注入 `eval(`）确认违规即失败；权限经 manifest 静态断言为零申请、无后台、匹配范围严格限定，e2e 未见可归因于扩展的页面错误、原页面仅被写入生命周期标记。
- 已知项：开发依赖 11 moderate 审计告警根因为 `minimatch <11.0.1`（经 eslint 链），非强制修复不可得、未采纳强制降级；运行时依赖 0 漏洞。本阶段不宣称具备 GenUI 功能。

## 阶段 2：单个 Card 的完整呈现链路

### 待办

- [x] 定义带版本的最小 genui JSON 协议、Card Schema 和正确与错误样本。
- [x] 先覆盖合法与非法 JSON、未知类型、额外字段和规模限制，再实现解析与验证。
- [x] 按真实调查依据定位 AI 回复中的 genui 代码块，不处理用户消息或其他内容。
- [x] 建立注册表、Card、局部挂载与样式隔离。
- [x] 保留原始内容和查看入口，解析、验证或渲染失败时安全回退。
- [x] 覆盖普通 Markdown 不受影响、多个代码块独立呈现及组件异常隔离。
- [x] 在模拟页面验证完整链路，在真实网页单独验证最小案例。

### 交付物与通过条件

交付最小协议、验证器、Card、识别与挂载模块及测试记录。合法 Card 在回答原位置呈现，其他内容正常；失败不丢失原始内容，不影响其他界面或聊天页面。

### 阶段 2 完成记录（2026-11-02）

- 交付物：带版本最小 genui 协议 v1 —— `src/protocol/types.ts`（`PROTOCOL_VERSION=1`、`LIMITS`：raw 64 KiB、深度 16、元素 50、标题 120、文本 2000）、`src/protocol/schema.ts`（Card Schema `additionalProperties:false`，未知字段即拒）、`src/protocol/validate.ts`（`parseGenui` 守卫顺序：长度→深度（字符串感知扫描）→JSON.parse→结构→版本；失败码 `too-large|too-deep|invalid-json|schema-violation|unsupported-version`，错误详情逐字段列出前 5 条）、`src/protocol/genui-validator.generated.ts`（构建期 Ajv standalone 生成产物，`npm run gen-validator` 再生成、prebuild 自动执行、勿手改）；识别 `src/content/detect.ts`（仅 `div.ds-assistant-message-main-content` 容器内、语言标签 `span.d813de27` 文本为 `genui` 的代码块，banner 叶子回退；用户消息/json/python/无标签一律跳过）；渲染与挂载 `src/render/`（`registry.ts` 元素注册表、`Card.tsx`、`boundaries.tsx` 元素级+卡片级错误边界、`elements.tsx` 纯文本元素、`mount.tsx` Shadow DOM 局部挂载、`card.css` 经 `?inline` 注入）；增强 `src/content/enhance.ts`（幂等 `data-genui-state`、原块隐藏保留、查看原始 JSON 切换、失败 `data-genui-state=failed` + `data-genui-reason` 保留原内容、渲染致命错误恢复原内容并卸载卡片）+ `src/content/index.ts` document_idle 一次性执行；`scripts/gen-validator.ts` 校验器生成脚本（ajv/ajv-formats 随之移入 devDependencies，运行时不再打包 ajv）；测试 `tests/unit/{protocol,detect,card,enhance,generated-validator}.test.ts`、`tests/fixtures/assistant-genui-message.html`（由阶段 0 真实快照逐字提取，仅含合成内容）、`tests/e2e/extension-load.spec.ts` 扩展为完整结构模拟页与阶段 2 断言。
- 检查命令：`npm run typecheck`、`npm run lint`、`npm test`、`npm run gen-validator`、`npm run build`（prebuild 再生成 + postbuild dist 校验）、`npm run check`（聚合）、`npm run test:e2e`、`REAL_SITE=1 npm run test:e2e`。
- 实际结果：`npm run check` 通过（typecheck、lint、70 单测、校验器再生成、build 25 模块 231.38 kB、dist 校验零豁免）；e2e 模拟页 4 通过/2 跳过（Edge/Chrome × 阶段 1+阶段 2，断言 host 挂载、影子样式隔离、原块隐藏、查看切换、非法回退、普通 Markdown 与用户消息零影响、多块独立、扩展零错误）；`REAL_SITE=1` e2e 4 通过/2 跳过（含两渠道真实网页合成结构最小案例）；单测覆盖合法与非法 JSON、未知类型、额外字段、规模限制、识别正反例、组件异常隔离与回退；dist 校验负向测试（追加远程 URL）确认违规即失败。
- 真实网页人工验证（2026-11-02，Edge 156 真实会话，用户执行）：genui 代码块原位渲染为 Card（GenUI 徽标、文本元素、底部透明说明齐全）；「查看原始 JSON」双向切换正常且卡片常驻；json 标签代码块与用户消息零影响；页面其他功能正常；控制台过滤 `[dsgenui]` 无任何错误（debug 日志默认级别隐藏，需 Verbose 级别可见）。页面既有的红色错误为第三方采集 SDK `collect-rangers-v5.2.11.js` → `gator.volces.com` 的 `ERR_BLOCKED_BY_CLIENT`，经关闭本扩展对照测试确认依旧存在，且本扩展零权限不具备请求拦截能力，与本扩展无关。
- 关键发现与修复：首次 e2e 全数失败——Ajv 运行时 `new Function` 编译被 MV3 内容脚本 CSP（无 `unsafe-eval`）以 `EvalError` 拒绝，init 中断、Card 零挂载；单测（Node/jsdom 允许 eval）无法暴露此问题。修复为构建期 Ajv standalone 代码生成，运行时零动态执行，产物逐字节一致与不含 `eval(`/`new Function(` 由单测锁定；dist 由 346.61 kB/92 模块降至 231.38 kB/25 模块。check-dist 曾为 Ajv `$id` URL 引入精确豁免，负向测试暴露「`text.match` 首个命中 + 豁免」造成同文件后续违规漏检，改为 `matchAll` 逐条扫描；Ajv 移出运行时后豁免整体移除，恢复零豁免。
- 已知项：真实网页最小案例的自动验证为合成结构（在真实 origin 注入结构忠实的合成消息），站点原生 genui 输出已由用户人工验证通过（见上）；其自动化识别验收待阶段 7 模型真实生成后进行；查看原始 JSON 切换仅切换原代码块显隐、卡片常驻可见（保证收起入口在真实浏览器始终可点）；`.tmp/` 存放阶段 0 真实页面快照（含真实页面结构），已加入 `.gitignore` 不入库；模型输出中的 HTML 一律按纯文本渲染，未知元素类型与渲染异常均降级占位，单元素异常不拖垮卡片、卡片级异常回退原始内容。

## 阶段 3：页面生命周期与安全回退

### 待办

- [x] 测试并实现生成结束后的保守挂载，未完成 JSON 不提前呈现。
- [x] 处理重复观察、消息重写、重新生成和节点替换，避免重复挂载。
- [x] 处理节点移除、会话切换和页面生命周期，清理组件、Observer 及监听器。
- [x] 实现增强开关，关闭时停止增强并恢复原始内容的可访问性。
- [x] 验证复制、滚动、输入框及普通 Markdown 交互正常。
- [x] 补充上述边界的自动化测试与真实网页验证。

### 交付物与通过条件

交付生命周期模块、回退行为和测试记录。页面更新和会话切换没有重复或遗留组件，生成中内容不被误处理，开关与回退可用。

### 阶段 3 完成记录（2026-11-02）

- 交付物：`src/content/controller.ts` 持续观察消息 DOM，以调查中取证的「停止生成」语义属性/图标路径/tooltip 为活跃信号；候选 AI 回复停止变化后等待完整 700ms 再挂载，并把整条回复文本纳入稳定指纹，避免代码块暂时静止或无关 DOM 变化导致提前呈现。扫描去抖与稳定等待使用独立计时器，目标回复变化会重新开始稳定窗口。重新生成期间立即卸载旧卡片并恢复代码块，节点改写后只挂载新内容。`src/content/enhance.ts` 新增 `EnhancementManager`，处理失败签名、DOM 移除、标签变化、节点替换、卡片 host 丢失、关闭清理与恢复；清理已断开的消息节点时也恢复原始显示样式和状态，支持页面稍后复用节点。`src/content/toggle.ts` 提供 Shadow DOM 样式隔离、键盘可操作的可见开关；`src/content/settings.ts` 用 `chrome.storage.local` 保存唯一布尔键 `genuiEnabled`，默认开启，跨标签页监听变更，导航离开时移除 Observer、存储监听、控件和 React 根，BFCache 返回时重新接管。
- 权限变更：`public/manifest.json` 仅新增 `storage`；保留 `https://chat.deepseek.com/*` 唯一匹配，不新增 `host_permissions` 或 Service Worker。生产包检查已同步限定允许项为 `storage`。当前 API 支持复核见[开发指南 §3](development-guide.md#3-manifestapi-与权限)、[Microsoft Edge 官方 API 支持表](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support)及 [Chrome 官方 storage API 说明](https://developer.chrome.com/docs/extensions/reference/api/storage)。
- 自动化覆盖：新增生命周期单测，覆盖停止信号、流式不完整 JSON、稳定后挂载、无关 DOM 变化不缩短稳定等待、断开再复用节点后关闭增强、重新生成、会话节点替换、关闭/恢复、跨页面设置与 BFCache 清理；总单测 76 项通过。Edge 与 Chrome 模拟页端到端覆盖复制事件、滚动、输入框、普通 Markdown、开关与设置持久化、消息重写、节点替换；默认 e2e 8 项通过、真实网页模式 4 项跳过。`REAL_SITE=1` 在 Edge 与 Chrome 的真实 `chat.deepseek.com` origin 运行合成回复生命周期和安全回退，6 项通过、6 项模拟页检查跳过；测试没有读取真实会话内容。
- 页面验证范围：真实 origin 用于验证内容脚本在实际站点 origin 中运行、真实站点页面脚本与扩展共存；回复节点、停止信号和流式文本由自动化插入的合成 DOM 提供，不宣称已验证站点原生流式更新或模型真实生成。本机已打开的 DeepSeek 会话当前没有加载此工作区扩展，因此未在该会话中进行本阶段手工复验。阶段 2 的 Edge 真实会话人工验证仍保留在前一节记录。
- 检查命令：`npm run check`、`npm run test:e2e`、`$env:REAL_SITE=1` 后运行 `npm run test:e2e`（最终结果见阶段 3 验证记录及 README）。
- 已知项：生成完成识别依赖阶段 0 取证的停止按钮属性/图标路径；站点若改变该信号需更新适配。完整回包后仍等待 700ms 稳定，以减少过早呈现风险。

## 阶段 4：最小本地交互与受限计算

### 待办

- [x] 扩展协议，描述初始状态、绑定、白名单运算、派生值和允许的操作。
- [x] 先编写状态传播、界面隔离、无效引用、循环依赖与资源超限测试。
- [x] 实现输入、滑块、选择控件和数值结果，清楚展示名称、单位与当前值。
- [x] 实现本地状态和派生计算，不使用 eval、Function 或模型生成的脚本。
- [x] 限制表达式深度、依赖关系、数据规模和运算量。
- [x] 实现重置，统一处理空输入、非法数值、除零和越界反馈。
- [x] 在 Edge/Chrome 模拟页及真实 origin 合成 DOM 验证即时更新、无发送和无额外网络请求。
- [x] 同步更新 Schema、协议文档与提示词草案，并用文档样例复核本地解析格式。
- [x] 在真实 DeepSeek 会话中复查模型输出格式（用户手动发送并完成单案例手工复核；多场景真实模型产品验收仍归阶段 7）。

### 交付物与通过条件

交付交互协议、状态与计算运行时、控件、协议文档和测试。控件可靠驱动结果变化，多个界面状态隔离，无效输入被限制在相应界面内，重置恢复初始状态。

### 阶段 4 本地实现记录（2026-11-02）

- 协议：新增 v2 并继续接受既有 v1 静态 Card。v2 包括有界 number/select 初始状态、控件绑定、value 输出和派生值 AST；白名单运算为 const/state/derived、negate/abs/round/floor/ceil、add/subtract/multiply/divide/min/max。Ajv standalone 校验器由 schema 生成；`validate.ts` 补充跨字段类型/引用/范围检查、状态与派生 ID 冲突检查、循环依赖检查及表达式节点/深度上限。
- 运行时与渲染：`src/runtime/evaluate.ts` 以白名单解释 AST，派生值缓存并限制单次运算数；单卡状态隔离。Shadow DOM Card 增加数值输入、滑块、选择器、值显示和重置，标签、当前值、单位和键盘焦点可见。空值、非有限数、越界、步长不符、除零和结果溢出显示局部反馈，保留最后一个有效状态。
- 文档：新增[协议说明](genui-protocol.md)、[预算示例](examples/budget-v2.json)和[提示词草案](prompt-draft.md)。文档样例通过真实协议解析链路。提示词草案没有自动插入聊天内容。
- 自动化：`npm run check` 通过（类型检查、lint、97 单测、校验器生成、构建与生产包静态检查）；默认 `npm run test:e2e` Edge/Chrome 模拟页 10 项通过、6 项真实 origin 用例跳过；`REAL_SITE=1` 在两种浏览器真实 origin 上以合成 DOM 验证阶段 2/3/4，8 项通过、8 项模拟页用例跳过。控件交互不改写草稿、不发送聊天、不产生额外请求。真实 origin 测试没有读取真实会话内容。
- 初始自动化验收时未做真实模型输出抽样；后续由用户手动发送提示词并完成下述单案例复核。重复采样仍待阶段 7，合成协议样例不作为真实模型证据。

### 阶段 4 真实会话手工复核与审查（2026-11-02）

- 执行方式：用户在真实 DeepSeek 会话手动发送预算测试提示词及纠正提示词，助手未代为提交消息。模型版本与本轮浏览器版本未记录，不据此声称两种浏览器均完成人工复核。
- 失败与修正：首次可见回复输出 `html` 代码块与 JavaScript，扩展按规则不增强；纠正为 `genui` JSON 后，`elements[5]`（当前类别）的 `unit: ""` 不符合 Schema 的最小长度限制，原始代码块被保留。用户提供完整原文后，本地复现相同控制台错误；仅省略该空 `unit` 即通过完整协议解析，初始余额为 60、支出占比为 40，零预算时余额为 -40、占比为局部除零错误。两项临时复现测试通过，测试文件已清理。
- 人工结果：用户确认修正后正常渲染为交互卡片，随后确认本轮手工复核结束。此前提供的操作清单包含控件联动、类别切换、空输入/步长反馈、零预算与重置；未另外提供逐项操作日志。该结果记录为本轮单案例手工复核完成，不代表模型首次输出成功、重复生成稳定性或阶段 7 产品验收完成。
- 本轮复跑：`npm run check` 通过（97 单测、类型检查、lint、生产构建与静态检查）；默认 Edge/Chrome e2e 10 通过、6 跳过；`git diff --check` 通过。没有复跑 `REAL_SITE=1`，前文真实 origin 合成 DOM 结果保留为原有验证记录。
- P2 修复及验证（2026-11-02）：原两项 P2 已修复。协议继续接受与 `Object.prototype` 同名的合法 ID；`Card.tsx` 对状态、草稿、字段错误和派生结果统一使用自有属性读取/存在性判断，避免命中继承属性。将协议初始值/最大值校验与交互输入校验合并到 `src/protocol/step.ts` 的 `isStepAligned`，用按数值 ULP 估算且封顶为四分之一步长的容差，拒绝随步数扩大而被旧容差放行的半步值。修复前定向回归为 6 failed、25 passed；修复后 `npx vitest run` 为 12 个测试文件、136 passed。`npm run check` 通过（typecheck、lint、136 单测、构建及 dist 校验）；默认 `npm run test:e2e` 在 Edge/Chrome 模拟页 12 passed、6 skipped；`git diff --check` 通过。收尾复核发现此前对计算上限的检查因显示舍入而放宽；现已恢复对未舍入结果的严格检查，并调整运行时单测，`toPrecision(12)` 仅用于显示，收尾修正后独立复核补跑 `npx vitest run tests/unit/runtime.test.ts`，6 项通过；`git diff --check` 通过。未在该修正后重跑完整 `npm run check` 或 E2E。未运行 `REAL_SITE=1`，本批要求的是默认模拟页验收，不需要访问真实会话或发送消息。步长判断仍受双精度分辨率限制：当步长远小于对应数值量级的 ULP（如 `1e12` 附近 `step=1e-6`），半步在表示中不可区分。
- 诊断限制：联合 v1/v2 Schema 的错误只输出前五条，会把 v1 分支错误显示在前面，掩盖 v2 的实际字段问题。本次不能从 `/version` 的提示推断用户版本填写错误。提示词草案已补充无单位时省略 `unit` 的约束。

## 阶段 5：组合界面与三个产品场景

### 待办

- [x] 增加布局、文字、条件说明、图表和表格，与 Card 和控件组合使用。
- [x] 支持柱状图、折线图、饼图、标题、必要图例和数据查看。
- [x] 实现表格列定义、排序、筛选和必要的横向滚动。
- [x] 图形、数值、排名与说明随同一份当前状态联动。
- [x] 验证抛物线：参数、曲线和性质同步变化，a 为 0 时正确退化。
- [x] 验证选购比较：预算、偏好、筛选、排名依据、缺失数据与无候选结果。
- [x] 验证预算规划：合计、余额、图表、超支、空输入和零预算。
- [x] 使用同类新问题验证通用组合能力，不将固定提问路由到预制业务页面。（本地以通用 v3 文档与元素分派验证；真实模型同类新问题抽样留阶段 7。）
- [x] 保持协议、Schema 和提示词一致，补充独立测试与端到端场景。

### 交付物与通过条件

交付组合组件、三个样本与测试、扩展协议和提示词草案。三个场景可以完成实际操作且结果正确；数据来源、假设和示例数据清楚，不编造事实。

### 阶段 5 本地实现记录（2026-11-02）

- 协议：新增 v3 并继续接受 v1/v2。v3 增加 `note`、`section`、`columns`、`chart`（bar/line/pie）与 `table`，新增条件语法 `state-eq/neq`、`num-eq/neq/gt/gte/lt/lte`、`and/or/not`；文本、说明和表格支持 `visibleIf`，图表/表格单元格复用白名单数值表达式。新增限制：v3 元素 80、布局嵌套 4、列 2–3、图表柱/饼 1–20 项、折线 1–5 系列（每系列 2–50 点、总计 100）、表列 10/行 30、条件节点 100/深度 5、共享表达式节点 300。Schema 同步收紧图表颜色为本地 `#RRGGBB`，校验器由 Schema 重新生成。
- 运行时与渲染：`evaluateComposite` 每次状态更新只遍历一次 v3 树，生成派生、内联表达式与条件的统一快照；图表、表格、文字和说明均只读取该快照，不各自重算。渲染新增柱状/折线/饼图（标题、图例、查看数据表）、表格（列定义、排序、筛选、横向滚动、条件行、空状态与计数）、说明、分区与多列布局；保留逐元素错误边界和重置，条件/表达式失败局部提示且不阻断其余内容。
- 示例与文档：新增[抛物线](examples/parabola-v3.json)、[选购比较](examples/shopping-comparison-v3.json)、[预算规划](examples/budget-v3.json)三份 v3 示例，覆盖退化提示、开口方向、预算内排名、缺失资料、无候选、超支、空输入与零预算；重写[协议说明](genui-protocol.md)，更新[提示词草案](prompt-draft.md)为 v3 并补充数据来源、缺失数据、空状态和不路由固定页面的约束；[产品规格](product-spec.md)状态同步到阶段 5。
- 自动化：`npm run check` 通过（typecheck、lint、17 个测试文件 178 项单测、校验器再生成、构建与 dist 校验）；`dist/content.js` 418.81 kB（gzip 95.11 kB），权限仅 `storage`。默认 `npm run test:e2e` 为 14 passed、6 skipped（Edge/Chrome 各 7 通过、3 个真实 origin 用例跳过），其中新增 v3 组合卡片的图表/表格/条件联动与重置用例。收尾复核又修复表格原型属性读取、表格重置不恢复筛选/排序、饼图负值占比三处缺陷，并补 3 项回归单测。阶段 4 P2 回归用例中已过期的“严格上限不产生状态”断言按当前严格计算规则修正后，两渠道均通过。
- 验证边界：三场景验证使用本地示例、合成 v3 文档和自动化交互，未在真实 DeepSeek 会话中由模型重新生成，也未执行人工浏览器操作；`REAL_SITE=1` 未在本阶段重跑，真实 origin 自动化不覆盖 v3 组合界面。因此本记录只证明本地协议、运行时、渲染与示例可用，不替代阶段 7 的多场景真实模型产品验收。

## 阶段 6：完整操作体验与继续讨论

### 待办

- [x] 统一视觉，适配 DeepSeek 亮暗主题和常见桌面窗口尺寸。
- [x] 支持键盘操作、清楚的控件标签与反馈。
- [x] 实现展开查看，展开和收起时保留当前状态。
- [x] 实现用户主动触发的继续讨论，将当前条件和结果摘要带入输入框。
- [x] 验证已有草稿得到保留，发送仍由用户完成。
- [x] 在复杂界面中复查生命周期、异常隔离、原始内容入口和重置。
- [x] 在 Edge 与 Chrome 分别验证并记录差异。

### 交付物与通过条件

交付主题适配、展开、继续讨论和测试记录。界面可读可操作，展开不丢失状态，继续讨论保留草稿、不自动发送，不影响原生聊天功能。

### 阶段 6 本地实现记录（2026-11-03）

- 主题跟随：新增 `src/render/theme.ts`。按取证优先级检测 `data-ds-dark-theme="dark"` 属性 > body class `dark`/`light` > documentElement class > `prefers-color-scheme`（仅当可调用）> light；`watchSiteTheme` 以 MutationObserver 观察 documentElement 的 class/属性与子树变化并配合 matchMedia 监听，仅在结果实际变化时回调；`attachThemeAttribute` 把结果写到卡片根与增强开关 host 的 `data-site-theme` 属性并保持跟随。`card.css` 增加 `[data-site-theme]` 暗色变量组（卡片/控件/图表/表格/错误/反馈），与 `prefers-color-scheme` 媒体查询回退并用（开关 host 仅对站点暗色覆盖，避免双源冲突）。桌面窗口尺寸沿用代码块在对话流内的块级自适应宽度，卡片不设固定宽度。
- 展开/收起：Card 头部新增 `button.genui-card-expand`（`aria-expanded`/`aria-controls`，文案「收起界面/展开查看」）；主体与脚注以 `hidden={!expanded}` 显隐（card.css 补 `.genui-card-body/.genui-card-footer[hidden]{display:none}` 覆盖原有 flex），React 树不卸载，状态、草稿、错误与重置计数全部保留；重置只作用于界面内容，不影响展开状态。v1 静态卡片同样可展开。收起时脚注一并隐藏（原始 JSON/重置/继续讨论入口都在展开视图内，展开后恢复）。
- 继续讨论：Card 脚注新增 `button.genui-card-followup`（仅 v2/v3），点击由 `buildContinueSummary`（`src/render/summarize.ts`，自有属性读取，状态缺失标注「（未确认）」、派生失败标注「无法计算（原因）」且不带数值）生成当前条件与结果摘要，经 `onContinue` 回调交给 `src/content/followup.ts` 的 `fillContinueIntoInput`：输入框只认 `textarea[name="search"]` 或 placeholder「给 DeepSeek 发送消息」两个确定标记，无标记时返回 `no-input`、不猜测其他 textarea（复核修正）；输入框为空直接填入（filled），已有草稿则逐字节保留原文后按其末尾换行情况追加摘要——草稿以换行结尾时另起一行、否则补空行（appended，不覆盖不清空），内容已存在则不重复追加；写值使用原生 value setter 并派发冒泡 `input` 事件以兼容受控组件。反馈文案固定为「已填入输入框；发送由你完成。」「草稿已保留：已在草稿后追加继续讨论摘要，发送由你完成。」「未找到聊天输入框，未能带入当前条件。」（`p role=status`）。未接线时点击显示不可用反馈；不发送、不点击发送按钮，扩展没有任何发送路径。生产接线在 `src/content/index.ts` 以箭头适配 `(summary) => fillContinueIntoInput(document, summary)` 传入。
- 复查：生命周期/异常隔离/原始内容入口/重置由既有阶段 2–5 用例与新增用例覆盖；本阶段的 re-render 面板不影响错误边界、原始 JSON 切换与重置链路。审查回归：此前部分单测/e2e 用 shadow `querySelector('button')` 取第一个按钮，头部新增展开按钮后被误点捕获，已统一改为 `button.genui-card-toggle`/`button.genui-card-followup` 专属类定位。
- 测试：新增单测 38 项（theme 检测/监听、summarize 摘要/失败/原型键、followup 填充/追加/去重/无确定标记拒绝写入/草稿逐字节保留/降级，Card 展开/继续讨论/反馈，enhance onContinue 透传，含复核新增），累计 216 项单测通过；e2e 新增「阶段 6 · 主题跟随、展开保留状态与继续讨论」（mock 页输入框补 `name="search"`）：双通道主题标记同步、收起保留滑块值与派生输出、继续讨论 filled/appended/去重/v1 无入口/草稿逐字节保留断言全部通过。
- 检查结果：`npm run check` 通过（typecheck、lint、216 单测、prebuild 校验器再生成、build + dist 静态校验）；`dist/content.js` 425.99 kB（gzip 96.95 kB），权限仅 `storage`。默认 e2e 16 passed、6 skipped；`REAL_SITE=1` 8 passed、0 failed（Edge/Chrome 真实 origin 合成结构；真实 origin 口径仅覆盖阶段 1–4 用例，v3 组合与阶段 6 用例在该模式下按用例设计跳过，仅以模拟页验证——README 初稿的覆盖高估已在复核中修正）。
- Edge/Chrome 差异记录：功能断言层面两通道无差异；真实 origin 差异仅为站点自身遥测（`gator.volces.com` 心跳）出现在 Edge 一次交互窗口内——该请求属于站点、不可归因扩展（manifest 无 host_permissions、无后台、内容脚本不发起请求），真实口径按「仅扩展桶判定」处理，该用例的请求断言收紧为「不得出现 `chrome-extension://` 起源请求」并记录站点请求，模拟页保留零请求严格断言。归因局限如实记录：按请求 URL 无法区分内容脚本发起的 https 请求与站点自身请求，内容脚本不发起网络请求由 src 静态不变量单测（`tests/unit/extension-static.test.ts`，全部源码零网络 API 引用）声明，URL 红线仅证明无 `chrome-extension://` 起源请求。Chrome 未在同一窗口内观测到遥测，属于站点行为时序差异，非扩展差异（阶段 2 人工验证时已确认站点遥测与本扩展无关）。
- 已知限制：主题跟随依赖阶段 0 取证的站点标记（`data-ds-dark-theme`/body class）；「跟随系统设置」由站点在系统设置面板中决定，扩展不推断系统偏好，仅镜像站点标记。继续讨论输入框选择依赖站点输入框结构（name/placeholder 取证），页面改版会使回填失效并如实反馈「未找到聊天输入框」。未做真实模型生成与人工浏览器验收（归阶段 7–8）。
- 阶段 6 复核修复（2026-11-03，四项 P2）：①追加摘要时草稿全文逐字节保留（不再裁剪末尾空白，按末尾换行情况决定分隔方式）；②移除「最后一个 textarea」回退，只认 `textarea[name="search"]` 与 placeholder 两个确定标记，无标记返回 `no-input` 不写入；③真实 origin 请求断言的归因口径修正（URL 红线 + `tests/unit/extension-static.test.ts` 静态不变量 + e2e 断言注释与文档同步收紧）；④`REAL_SITE=1` 覆盖范围高估修正（v3/阶段 6 用例真实 origin 下设计为跳过、仅模拟页验证，文档不再声称覆盖）。修复后重跑全部 21 个测试文件 216 项单测、`npm run check`、默认 e2e 与 `REAL_SITE=1` 通过（数字见上方检查结果）。

## 阶段 7：默认增强与真实生成验收

### 待办

- [x] 基于阶段 0 调查，完成可见、可关闭的默认增强机制。
- [x] 提示词包含实际支持的明确协议、组件、绑定、运算规则和示例。
- [x] 引导模型在适合时生成界面，普通问题正常回答，不强行生成工具。
- [x] 用户能查看实际参与对话的增强内容，不使用隐藏内部消息或自动发送。
- [x] 在真实网页验证三个产品场景和同类新问题。
- [x] 记录提示词版本、成功与失败案例、协议合法性、操作正确性及不适用场景表现。
- [x] 验证关闭增强及错误回退，根据已查明原因修复问题。
- [x] 复查生成内容由本地能力解释，未引入远程代码或未声明的网络行为。

### 交付物与通过条件

交付正式提示词、默认增强与设置、真实输出和产品验收记录。默认增强真实可用，输出能生成有效工具，普通聊天正常。手工 JSON、模拟页面或手动粘贴成功不能单独证明本阶段完成。

### 阶段 7 本地实现与真实网页验收记录（2026-11-03）

- 正式提示词与版本：新增 `src/content/prompt.ts`，`GENUI_PROMPT_VERSION=2`；稳定起止标记为 `〔GenUI 增强 v2｜…〕` / `〔GenUI 增强说明结束〕`；正文覆盖 v3 根字段、state/derived、控件绑定、白名单 AST、note/section/columns/chart/table、visibleIf、预算上限、数据真实性与不适用回退，并附一个合法 v3 示例。v2 修订专门补上 `initialSort:{key,dir}` 并明确「不能写 direction」；收尾时明确 `elements` 至少 1 个元素，与 Schema 对齐；v1→v2 的字段缺口、失败样本与修复理由见 `docs/prompt.md` 与 `docs/phase7-acceptance.md`。
- 可见追加：新增 `src/content/augment.ts`。仅在用户输入停止 700ms 后向非空草稿末尾逐字追加；空草稿不写、已有标记不重复、原草稿逐字节保留并按末尾换行补分隔。任何路径都不调用发送按钮、不模拟 Enter、不写隐藏输入。引用 `findChatInput` / `setNativeValue` 只认 `textarea[name="search"]` 或 placeholder「给 DeepSeek 发送消息」的确定标记；草稿已含说明时不重复追加。
- 关闭与恢复：关闭开关时，若草稿仍以自动追加说明结尾，只移除该尾部后缀并保留用户原文（即使说明前已有新输入）；说明文本被用户修改时不覆盖。手动删除说明后当前草稿不再追加，清空/新草稿可恢复。重新开启会对当前非空草稿重新追加。
- 用户可核对：`src/content/toggle.ts` 增加「查看增强说明」信息按钮与 `role=dialog` 面板，展示与追加逻辑同一 `GENUI_PROMPT_TEXT` 常量的逐字 `<pre>`、版本号、状态 `aria-live`，并明确「不自动发送、不使用隐藏消息」；面板 `order:-1` 保持主开关按钮仍为第一个按钮，不破坏既有定位。控制器在设置加载后创建并启动 augmenter，关闭状态与存储同步。
- 真实网页验收：由用户在已登录的 Edge 中显式发送，完成二次函数抛物线（v1，含滑块、重置、继续讨论）、笔记本选购（v1 失败、v2 重跑成功，含预算/重量筛选与重置）、每月预算（v1，含余额联动、超支警告、重置）、健身房会员卡（v2，简单版与复杂版，含次数/月数联动）以及不适用问题「水的沸点」（只答文字、不生成卡片）。默认开关关闭/恢复、面板全文、草稿保护均在真实页面核对。逐项记录见 `docs/phase7-acceptance.md`。
- 关键失败与修复：场景 2 首次运行使用 v1，模型把 `initialSort` 写成 `{"key":"price","direction":"asc"}`，Schema 只接受 `{key,dir}`，卡片以 `schema-violation` 回退为原始块。根因是 v1 提示词只写字段名未写形状；修复为 v2 提示词补全字段与禁用词，协议不放宽别名。另记录站点离屏代码块延迟渲染导致扩展暂见短前缀、滚动后恢复，以及流式不完整 JSON 的瞬时失败标记，两者都不应误记为持久生成失败。
- 收尾 P2 修复：①说明被分多次删除时，首次改动即记录 `dismissed`，即使起始标记尚在也不会在删掉剩余标记后重新追加；②待执行的追加绑定调度时的输入框、草稿内容与草稿记录，执行前逐项核对，切换会话（替换 textarea 或复用节点恢复另一份草稿）不会写入新草稿；③提示词与正式文档明确只有 `state`、`derived` 可为空，`elements` 至少 1 个元素，与 v3 Schema 的 `minItems: 1` 对齐。三项均有回归测试。
- 测试：新增 `tests/unit/prompt.test.ts`（标记/版本、追加与逐字节保留、去重、示例通过协议校验）、`tests/unit/augment.test.ts`（防抖、已有草稿、关闭精确恢复、说明前新输入、手动删除、分次删除后保持 dismissed、切换会话不污染新草稿、IME、缺失输入框）、`tests/unit/controller-augment.test.ts`（真实控制器接线、面板全文、关闭恢复、不点击发送、存储关闭/开启）与 `tests/unit/protocol-v3.test.ts` 的 `initialSort.direction` 拒绝用例；e2e 新增阶段 7 模拟页用例（可见追加、面板全文、关闭恢复）。累计 25 个测试文件 253 项单测；默认 e2e 18 passed / 6 skipped。
- 检查结果：`npm run check` 通过（typecheck、lint、253 单测、校验器生成、build + dist 校验）；`dist/content.js` 440928 B、`dist/manifest.json` 352 B，仅 `storage` 权限，无 host_permissions/background；check-dist 未发现远程脚本/CDN/`eval`/`new Function`/`importScripts`。真实页面 URL 级网络未抓包，安全结论来自零网络 API 静态不变量、权限清单、构建扫描与模拟页零请求断言，限制已记录。
- 已知限制：输入框/流式/语言标签/离屏渲染依赖站点 DOM；提示词只对 700ms 后停止输入的草稿追加；真实页面未做 URL 级网络归因；网页未暴露模型版本号，验收记录不宣称具体模型版本；场景 2 的首个 v1 失败是真实失败案例，v2 修复后重跑通过，但不构成重复稳定性统计。

## 阶段 8：完整验证、文档与发布准备

### 待办

- [x] 执行完整单元测试、类型检查、lint、生产构建和浏览器端到端测试。→ `npm run check` 通过（25 个测试文件 253 项单测 + typecheck + lint + 构建与 dist 校验）；默认 e2e Edge/Chrome 18 通过 / 6 设计性跳过。
- [x] 在 Edge 与 Chrome 分别检查实际兼容性，记录版本及结果。→ Edge 156.0.4314.58、Chrome 156.0.8078.79；默认与 `REAL_SITE=1` e2e 双通道通过，功能断言无差异（见 [phase8-verification.md](phase8-verification.md)）。
- [x] 按产品规格核对三个场景、默认行为、展开、重置、继续讨论和安全回退。→ 三场景与不适配样本为阶段 7 真实网页人工验收（[phase7-acceptance.md](phase7-acceptance.md)）；默认增强、展开留态、重置、继续讨论与安全回退由 253 项单测与模拟页/真实 origin e2e 持续锁定。
- [x] 检查生产包依赖、CSP、权限、站点范围和网络行为。→ check-dist 通过（仅 `storage`、匹配严格限定、无远程脚本/CDN/`eval`/`new Function`/`importScripts`）；src 零网络 API 静态不变量单测通过。
- [x] 按最新 Edge Add-ons 政策复核用途、功能描述、隐私、权限和审核测试步骤。→ 按官方《Developer policies》2026-07-24 版逐条复核，无阻断项，见 [store-submission.md](store-submission.md)。
- [x] 完善 README、CHANGELOG、安装卸载步骤、架构、支持能力、隐私说明和已知限制。→ README/CHANGELOG 更新至阶段 8 口径（含卸载步骤）；新增 [privacy.md](privacy.md) 与 [store-submission.md](store-submission.md)。
- [x] 如实说明交互状态保存与重新打开回答后的恢复行为。→ 约定：原始 `genui` JSON 永久保留、卡片从它重新挂载、交互状态回到初始值（单卡内存不持久化）；该重开行为未在真实页面单独立项人工验证，已如实记录于 [phase8-verification.md](phase8-verification.md)「真实环境未验证」。
- [x] 提供可加载的构建产物与发布用 ZIP，记录版本和复现方法。→ 当前 `dist/` 与 `release/deepseek-genui-v0.1.1.zip` 可加载；包内包含清单、脚本与 Logo/图标资源，SHA256、当前及历史验证记录见 [phase8-verification.md](phase8-verification.md)。
- [x] 输出分层验证报告：已实现、已通过、真实环境未验证、已知限制和后续能力。→ [phase8-verification.md](phase8-verification.md)。

### 交付物与通过条件

交付源码、扩展包、README、CHANGELOG、隐私说明、安装说明和测试报告。必要检查有实际结果，三个场景与默认增强达到真实可用标准。未执行检查写明原因；必要行为未验证时不宣称 MVP 完成。商店提交和审核状态单独报告，发布准备不等于已上架。

### 阶段 8 完成记录（2026-11-03，0.1.0 历史基线）

- 全量复检：`npm run check` 通过（typecheck、lint、25 个测试文件 253 项单测、校验器再生成、构建与 dist 校验）。产物基线：`dist/content.js` 440,928 B（gzip 102.71 kB）、`dist/manifest.json` 352 B；源码静态不变量（零网络 API 引用）与生产包扫描（无 `eval`/`new Function`/`importScripts`/远程脚本/CDN）通过。
- 浏览器端到端（Playwright 1.64.1 直启系统浏览器）：默认模拟页 Edge/Chrome 18 通过、6 设计性跳过；`REAL_SITE=1`（真实 `https://chat.deepseek.com` origin，合成回复 DOM，不读取真实聊天内容）Edge/Chrome 8 通过、16 设计性跳过——真实 origin 下阶段 2 合成结构、阶段 3 生命周期与回退、阶段 4 本地计算各双通道通过，站点自身请求记录为空。浏览器版本：Edge 156.0.4314.58（较阶段 7 记录的 156.0.4314.50 更新）、Chrome 156.0.8078.79。
- 商店政策复核：按 Edge Add-ons《Developer policies》官方 2026-07-24 版逐条核对（单一目的、准确描述与依赖披露、隐私政策与个人信息、权限最少化、CSP、可测性与审核测试步骤、内容红线、年龄分级），无阻断项；提交流程未执行，素材与审核测试步骤齐备于 [store-submission.md](store-submission.md)。
- 发布包：`release/deepseek-genui-v0.1.0.zip`（102,046 B）＝`manifest.json` + `content.js` 扁平两项，可直接解压为未打包扩展加载。SHA256：zip `fa3128faa0f7ff6703ea30d6bb16171f8749c79bff7405bc6abb0e0300b6a9ff`、`dist/content.js` `82f28e41609c4e0d9fef4576a3053bf4b7ba813e8dc7a5d6843d17e7591a5c59`、`dist/manifest.json` `d7cbd68d4cdaaf7c7c9d0dbf7032c790329f805750c83adbc480e7a42049dc15`。复现方法见 [phase8-verification.md](phase8-verification.md)。
- 文档：新增 [phase8-verification.md](phase8-verification.md)（已实现/已通过/真实环境未验证/已知限制/后续能力）、[privacy.md](privacy.md)（隐私政策，对应政策 1.5.2）、[store-submission.md](store-submission.md)（政策逐条复核、上架素材、审核测试步骤与上架前清单）；README/CHANGELOG 更新至阶段 8 口径（含卸载步骤）。
- 交互状态与重开行为的如实说明：MVP 设计为单卡内存、不持久化——原始 `genui` JSON 代码块永久保留，卡片总是从它重新挂载，交互状态回到初始值（展开留态为单卡内行为；BFCache/节点替换/会话切换单测覆盖内存清理路径）。真实页面对「重新打开历史会话」的专项人工验证未执行，不宣称完成。
- 检查未执行与原因：①Edge Add-ons 商店提交未执行——无 Partner Center 账号，属用户侧动作，政策复核与素材已备妥；②真实页面 URL 级网络抓包未执行——需独立取证环境，「无未声明网络行为」结论由源码静态不变量、manifest 权限、构建扫描与模拟页零请求断言四条独立证据支撑，口径沿用阶段 6 收紧措辞；③Logo 接入发生在本次全量复核之后：manifest `icons`、受限页面图形资源与 UI 标记已加入源码，尚未全量复核或重出包，因此保留旧 ZIP 和 SHA256 作为历史验收基线。
- 交付物状态：源码、可加载 `dist/`、发布 ZIP、README/CHANGELOG、隐私说明、安装与卸载说明、分层验证报告齐备；商店提交与审核状态单独报告——发布准备不等于已上架。
- 发布前复审修正三处文档口径（2026-11-03 第二轮）：①store-submission 的 1.3.1/1.3.2 由「不需要测试账号 / N-A」改为登录与站点在线服务依赖的如实披露，给出无法提供站点账号的原因（账号受站点服务条款约束、非本项目所有）与不登录的替代复核路径（e2e 模拟页、协议文档与示例 JSON），审核者自有账号不再作为豁免依据；②privacy/README 卸载说明改为「已打开页面注入效果需刷新或关闭标签页后消失」，privacy「第三方」区分本地打包库（React/react-dom）、数据共享（无）与站点自身在线服务；③store-submission 状态行改为「商店素材尚未全部就绪」，Logo 规格按官方提交说明改为 300×300 推荐、最低 128×128、截图可选。
