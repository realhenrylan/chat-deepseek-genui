# DeepSeek GenUI — 开发指南

更新日期：2026-11-02。本文规定后续实现方式和当前工程约束。阶段 1–3 已完成；阶段 4 的本地协议、控件、运行时、自动化验证、真实会话单案例手工复核及两项审查 P2 修复均已完成并通过本地验证（见开发任务）。组合场景、默认提示词增强与完整产品验收仍在后续阶段。

产品目标见[产品规格](product-spec.md)，按顺序执行的清单见[开发任务](development-task.md)。

## 1. Edge 官方开发体系与资料

Edge 扩展使用网页技术和 Chromium 扩展 API，普通扩展开发无需单独安装专用 Edge SDK。扩展包含 manifest.json、功能代码及所需界面资源。微软提供开发指南、API 支持列表、本地测试和发布规范。[官方概览](https://learn.microsoft.com/en-us/microsoft-edge/extensions/)

以下链接于 2026-11-01 查阅；实施和发布时重新确认 API 支持范围及商店政策。

| 官方资料 | 用途 |
| --- | --- |
| [Edge 扩展概览](https://learn.microsoft.com/en-us/microsoft-edge/extensions/) | 扩展结构、兼容性与发布路径 |
| [开发入门](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/) | 建立最小可运行扩展 |
| [Manifest V3 指南](https://learn.microsoft.com/microsoft-edge/extensions/developer-guide/migrate-your-extension-from-manifest-v2-to-v3) | MV3 配置、后台运行、权限和远程代码限制；新项目直接采用 MV3 |
| [Edge 支持的扩展 API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support) | 逐项确认 API 的平台和版本支持 |
| [本地加载与测试](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading) | 加载未打包扩展、重新加载与检查错误 |
| [Edge Add-ons 开发者政策](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies) | 用途、权限、隐私、安全和商店审核要求 |

Edge 与 Chrome 可以共用大部分 Chromium 扩展代码，但部分 API 存在差异。项目以桌面 Edge 为首要验收环境，在 Chrome 独立运行兼容性检查，不能以一方通过推定另一方通过。[官方兼容性说明](https://learn.microsoft.com/en-us/microsoft-edge/extensions/#browser-compatibility-and-extension-testing)

## 2. 工程基线

采用原任务中的 TypeScript、React、Vite、Manifest V3、JSON Schema 与 Ajv、Vitest 和 Playwright。初始化时确认实际版本兼容性并锁定依赖；不宣称任意最新版本已经兼容。

- Content Script：观察目标网页、识别回复和管理挂载生命周期。
- 协议层：JSON 解析、Schema 验证、引用检查和资源上限。
- 本地交互运行时：当前状态、受限派生计算与关联更新。
- 渲染层：受支持的组件、布局组合、样式与错误隔离。
- 提示词和设置层：透明增强、开关和协议说明。
- 仅在实际功能需要时添加后台 Service Worker，不为架构形式引入常驻任务。

模块保持单一职责，先完成最小可靠链路，不为未来版本提前引入复杂框架。

## 3. Manifest、API 与权限

使用 manifest_version: 3。如需后台逻辑，采用 MV3 的 Service Worker 方式；权限与站点访问按 MV3 规则声明。[官方 MV3 指南](https://learn.microsoft.com/microsoft-edge/extensions/developer-guide/migrate-your-extension-from-manifest-v2-to-v3)

商店要求只申请必要权限并清楚说明用途。[官方安全政策](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies#12-security)

本项目进一步约定：

- 页面匹配范围限定为 https://chat.deepseek.com/*，不申请所有网站访问权限。
- 按实际 API 调用声明权限，不为尚未实现的功能预先申请权限。
- 本项目目前仅为可见增强开关声明 `storage`，通过 `chrome.storage.local` 保存 `genuiEnabled` 布尔值；不存储聊天正文、代码块或输入内容。Edge API 支持列表已复核 `storage`，Chrome 官方参考说明使用该 API 需声明 `storage` 权限。
- 不申请 Cookie、历史记录、调试器或与 UI 增强无关的访问能力。
- 不调用 DeepSeek 非公开 API，不读取或使用认证信息，不批量读取历史聊天。
- 权限清单逐项记录使用位置、必要性和用户可见说明。

## 4. 本地代码、模型输出与 CSP

MV3 不允许远程托管代码，可执行的 JavaScript 应随扩展包提供，并遵守适用的内容安全策略。商店也要求符合 CSP，不能通过远程下载脚本规避限制。[官方 MV3 说明](https://learn.microsoft.com/microsoft-edge/extensions/developer-guide/migrate-your-extension-from-manifest-v2-to-v3)、[官方 CSP 政策](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies#121-content-security-policies)

基于这些要求和产品原定安全边界，本项目采用以下设计。这些是项目约束，不能据此宣称已经获得商店审核认可：

- 组件、样式、计算执行器和第三方依赖本地打包，不从 CDN 加载执行资源。
- 模型只输出经过验证的声明式 JSON，生成内容按不可信输入处理。
- 不使用 eval、Function 或任意脚本执行实现模型生成的计算。
- 模型提供的字符串不作为 HTML、CSS 或事件处理代码解释。
- 模型不能选择浏览器权限、网络目标或本地文件。
- 派生计算使用白名单运算，限制输入规模、嵌套深度、依赖关系和计算量。
- v2 协议字段、运算符和资源上限见[GenUI 协议](genui-protocol.md)；交互状态仅在单张 Card 内存中生效，不持久化。
- 拒绝循环依赖、未知组件和无效引用；失败后仍能查看原始内容。
- 发布前审查协议解释器与生产产物，不把 JSON 格式本身当作安全证明。

## 5. 页面与交互规范

- 先记录真实网页观察结果，再实现适配，不凭猜测选择 DOM 节点。
- 只处理 AI 回复中明确标记为 genui 的代码块，保留普通 Markdown 和用户消息的原生行为。
- 只增强目标区域，保留原始内容及回退入口，不接管整个聊天页面。
- 默认在内容完整且生成结束后呈现；结束信号不可靠时采用保守策略并记录限制。
- 防止重复挂载，处理消息更新、节点替换、会话切换，清理组件及监听器。
- 多个界面状态隔离，同一界面的图形、数值和说明使用一致的当前状态。
- 操作在本地即时生效，普通控件不调用模型、不发送消息。
- 继续讨论由用户主动触发，保留已有草稿，发送由用户完成。
- 默认提示词增强可见、可控、可关闭，不使用隐藏内部消息或自动发送。
- 主题、键盘操作、窗口尺寸、展开和重置纳入验收。

## 6. 本地加载与调试

按官方流程，在 Edge 扩展管理页开启开发者模式，选择“加载解压缩的扩展”，加载包含 manifest.json 的构建产物目录。代码修改并重新构建后，重新加载扩展，必要时刷新目标网页。[官方本地测试指南](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)

实施时补充实际安装、开发、测试和构建命令及产物路径；命令创建并验证前，不写成已经可运行的步骤。

以下命令于 2026-11-02 创建并实际验证（含 `npm ci` 重装后复跑）：

| 命令 | 作用 |
| --- | --- |
| `npm ci` | 按 `package-lock.json` 安装锁定依赖 |
| `npm run typecheck` | `tsc --noEmit` 类型检查 |
| `npm run lint` | `eslint .` 代码检查 |
| `npm test` | `vitest run` 单元测试 |
| `npm run build` | `vite build` 产出 `dist/`，postbuild 自动执行 `scripts/check-dist.mjs` 静态校验 |
| `npm run check` | 聚合：typecheck + lint + test + build（含生产包校验） |
| `npm run test:e2e` | Playwright 在 Edge/Chrome 加载 `dist/` 验证注入、生命周期、开关和页面交互；`REAL_SITE=1` 在真实网页 origin 注入合成回复结构，`HEADED=1` 强制有头 |

产物路径：`dist/manifest.json` 与 `dist/content.js`（IIFE 单文件），本地加载选择 `dist/` 目录。

真实网页调试只查看当前 UI 增强所需信息，记录时避开认证信息和无关对话。测试优先使用合成或脱敏数据，不提交个人聊天内容。

## 7. 工程与验证规则

- 按开发任务的阶段推进，每次完成一个独立功能。
- 解析、计算、生命周期和交互采用 Red → Green → Refactor；测试应发现实际行为错误。
- 每批变更更新 CHANGELOG，修复前先调查根因。
- 在对应步骤运行相关检查，发布前执行单元测试、类型检查、lint、生产构建和浏览器端到端测试。
- 模拟页面和真实网页、Edge 和 Chrome 分别记录结果。
- 未执行的检查写明原因，不标记通过；阶段状态以实际证据为准。

## 8. 发布文档与商店准备

商店要求单一用途，准确描述功能、来源和限制，权限合理，并满足适用的隐私要求。发布时按完整政策复核。[官方开发者政策](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)

项目用途统一描述为“增强 DeepSeek 回答中的交互界面”，学习、比较和计算为该用途下的场景。

README 和商店材料准确说明非官方身份、对 DeepSeek 网页的依赖、网页变化风险、权限、读取与存储的数据、第三方传输情况、默认增强的查看和关闭方式、支持能力、实际验证版本、局限和状态恢复行为。提供安装、更新、卸载、隐私说明和审核所需的可复现测试步骤。

本地安装成功、自动化测试通过或符合本指南，均不能代替商店审核结果。
