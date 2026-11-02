# DeepSeek GenUI（非官方）

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

为 [chat.deepseek.com](https://chat.deepseek.com) 提供交互式 GenUI 增强的浏览器扩展。**本项目为独立开发的第三方扩展，与 DeepSeek 官方无关**，依赖 DeepSeek 网页版的页面结构，网页改版可能导致功能失效。

## 当前状态（2026-11-03）

阶段 1–6 的本地实现与自动化验证已完成；阶段 4 真实会话的预算单案例手工复核已由用户完成。扩展识别 AI 回复中 `genui` 语言标记的代码块；生成期间不处理候选块，停止生成后还会等待回复内容稳定再挂载。回复改写、节点替换和会话切换会清理旧卡片。页面右侧中部提供增强开关，默认开启；关闭后恢复原始内容，设置保存在当前浏览器的本地扩展存储中。卡片按站点亮暗主题（`data-ds-dark-theme` 与 body class）自动跟随，头部可展开/收起原始 JSON 代码块，收起不影响输入值与派生结果。协议 v2 支持卡片内数值输入、滑块、选择器、白名单派生计算与重置，状态按卡片隔离；协议 v3 增加说明、分区、多列布局、柱状/折线/饼图与表格，图表、数值、排名和条件说明共享同一份状态快照，表格支持排序、筛选、横向滚动与条件行，重置恢复初始状态。基于当前状态与派生结果，可通过卡片脚注「继续讨论」按钮把摘要带入聊天输入框（已有草稿时在草稿末尾追加，不覆盖不清空、不重复追加），是否发送始终由用户决定。

阶段 4 复核中，首次 HTML 输出及随后空 `unit` 导致的协议失败经纠正后正常渲染。两项 2026-11-02 复核发现（合法 ID 与对象原型属性重名、较大步数下的步长校验）与四项 2026-11-03 复核发现（追加时逐字节保留草稿、输入框只在取证标记命中时写入、真实 origin 请求断言的归因口径与文档覆盖修正）均已修复；计算上限严格按未舍入结果检查，12 位精度舍入仅用于显示。阶段 5 的三份示例（[抛物线](docs/examples/parabola-v3.json)、[选购比较](docs/examples/shopping-comparison-v3.json)、[预算规划](docs/examples/budget-v3.json)）已在本地自动化中完成交互回归，阶段 6 的主题跟随、展开保留状态与继续讨论已在模拟页 Edge/Chrome 双通道验证（真实 origin 模式下该组用例按用例设计只跑模拟页，见下方已验证内容），但均未由真实模型重新生成，也未进行人工浏览器操作或多场景产品验收。默认提示词增强和多场景模型生成产品验收仍归阶段 7；阶段 7–8 未完成。阶段计划及复核范围见 [docs/development-task.md](docs/development-task.md)，协议见 [docs/genui-protocol.md](docs/genui-protocol.md)，提示词草案见 [docs/prompt-draft.md](docs/prompt-draft.md)，安全与工程约束见 [docs/development-guide.md](docs/development-guide.md)。

## 环境要求

- Node.js v24.15.0、npm 11.12.1（本仓库实际验证版本；其他版本未验证）
- 桌面 Edge（验证版本 156.0.4314.50）或 Chrome（验证版本 156.0.8078.79），Windows 11 下验证

## 安装与检查命令

```bash
npm ci                # 按 package-lock.json 安装锁定依赖
npm run typecheck     # tsc --noEmit 类型检查
npm run lint          # eslint . 代码检查
npm test              # vitest run 单元测试
npm run gen-validator # 由 src/protocol/schema.ts 重新生成校验器（build 前 prebuild 自动执行）
npm run build         # vite build → dist/，postbuild 自动执行生产包静态校验
npm run check         # 聚合：typecheck + lint + test + build（含生产包校验）
npm run test:e2e      # Playwright：在 Edge/Chrome 加载 dist 并验证注入、交互与生命周期
```

e2e 可选环境变量（PowerShell 语法）：

- `$env:REAL_SITE=1` 后运行 `npm run test:e2e`：在真实 `https://chat.deepseek.com` origin 测试扩展注入与生命周期；使用合成回复 DOM，不读取真实聊天内容。
- `$env:HEADED=1` 后运行 `npm run test:e2e`：强制有头模式。

默认 e2e 拦截站点导航并提供本地模拟页面，适合离线运行。

## 本地加载扩展

1. `npm run build` 生成构建产物目录 `dist/`（含 `manifest.json`、`content.js`）。
2. Edge：打开 `edge://extensions`，开启「开发人员模式」，选择「加载解压缩的扩展」，选中本仓库的 `dist/` 目录。
3. Chrome：打开 `chrome://extensions`，开启「开发者模式」，「加载已解压的扩展程序」选中 `dist/`。
4. 访问 `https://chat.deepseek.com/`，页面根元素出现 `data-genui-ext-loaded="<32位扩展id>"` 即注入成功。右侧中部的「GenUI 已开启」按钮可关闭增强；关闭后原始代码块恢复显示。重新构建后需在扩展页点击刷新按钮。

## 权限说明

- `manifest.json` 只申请 `storage`，用于在 `chrome.storage.local` 中保存一个 `genuiEnabled` 布尔开关；未设置时默认开启。
- 不申请 `host_permissions`，无后台 Service Worker；内容脚本仅匹配 `https://chat.deepseek.com/*`。
- 不保存聊天文本、代码块内容或用户输入，也不把设置传出本机。
- 生产包只加载本地资源：构建为 IIFE 单文件，`npm run build` 后自动扫描产物，出现 `eval`/`new Function`/`importScripts`/远程脚本与样式 URL/CDN 域名即构建失败。

## 已验证内容（阶段 1–6）

| 检查 | 结果 |
| --- | --- |
| `npm run check`（类型检查、lint、21 个测试文件 216 项单测、校验器再生成、生产构建与 dist 校验） | 通过（阶段 6 复核后重跑全量） |
| 默认 e2e：Edge/Chrome 模拟页的注入、Card、生命周期、数值输入/滑块/选择器、状态隔离、重置、v3 图表/表格/条件联动、主题跟随、展开保留状态、继续讨论与无额外请求检查（16 通过、6 个真实 origin 用例跳过） | 通过 |
| 阶段 5 三场景本地回归：抛物线退化/开口方向、选购预算无候选与资料缺失、预算超支/空输入，状态变化同步图表、表格与说明 | 通过 |
| 阶段 6 交互回归：收起后滑块值与派生输出保留、展开恢复；继续讨论空输入填入、草稿逐字节保留后追加、重复去重、无确定输入框标记时拒绝写入、v1 无入口；卡片与增强开关同步站点主题标记（Edge/Chrome 双通道模拟页） | 通过 |
| `REAL_SITE=1` e2e：Edge/Chrome 真实 `chat.deepseek.com` origin 的合成 Card 生命周期、生成等待与 v2 本地交互（8 通过、0 失败，阶段 6 复核后重跑；覆盖范围仅阶段 1–4 口径——v3 组合与阶段 6 的三个用例在真实 origin 模式下设计为跳过，只以模拟页验证） | 通过 |
| 内容脚本零网络调用静态不变量：src 源码无 `fetch`/XHR/`sendBeacon`/WebSocket/`EventSource` 引用（tests/unit/extension-static.test.ts），与真实 origin 的 URL 红线各自覆盖不同归因维度 | 通过 |
| 真实网页结构与普通交互人工验证（Edge 156，阶段 2）：Card、原始 JSON 切换、页面原生内容 | 通过 |
| 阶段 4 真实 DeepSeek 预算单案例：用户纠正空 `unit` 后确认卡片正常，并确认本轮手工复核结束（非重复生成验收） | 用户确认完成 |
| 生产包静态校验负向测试（人为注入 `eval(`、远程 URL → 构建失败） | 通过 |
| 权限审查：仅 `storage`，无 host_permissions、无后台，匹配范围严格限定 | 通过 |

真实 origin 自动化采用合成回复 DOM，不代表站点原生流式响应或模型真实生成已验证。阶段 3 自动化覆盖输入、滚动、普通 Markdown 与原始代码块复制事件；阶段 4 自动化交互使用合成协议文档，另有用户手动发送提示词完成的真实预算单案例复核。阶段 5 的组合界面与三场景、阶段 6 的主题/展开/继续讨论均使用本地示例、模拟页或合成文档验证，未在真实会话中由模型重新生成，也未执行人工浏览器操作；该案例经历格式纠正，不能作为模型首次生成成功或重复稳定性的证据，本轮模型及浏览器版本未记录。真实 origin 下的请求断言只能按 URL 识别 `chrome-extension://` 起源（扩展页面上下文）的请求；内容脚本是否发起 https 请求无法由 URL 归因，由 src 源码零网络 API 的静态不变量单测与 manifest/构建期扫描保证，不能宣称 URL 检查单独证明了「扩展无请求」。Edge/Chrome 功能断言无差异；差异记录仅限真实 origin 下站点自身遥测（`gator.volces.com` 心跳）出现时序不同，已知为站点行为并在阶段 2 人工验证中确认与本扩展无关。阶段 7 的默认提示词增强与多场景真实模型生成验收，以及 Edge Add-ons 商店提交和审核仍未完成。

## 目录结构

```
public/manifest.json      MV3 清单（仅 storage 权限、无后台）
src/protocol/             genui v1/v2/v3 类型、Schema、语义校验与生成产物
src/runtime/              v2/v3 白名单本地计算与组合求值运行时
src/content/              内容脚本：生命周期观察、生成等待、本地开关与增强挂载
src/render/               Card 渲染：控件、图表、表格、布局、错误边界、Shadow DOM 挂载与样式
scripts/gen-validator.ts  由 Schema 重新生成校验器（prebuild 自动执行）
scripts/check-dist.mjs    生产包静态校验（postbuild 自动执行）
tests/unit/               vitest 单元测试
tests/e2e/                Playwright 扩展加载与链路测试
tests/fixtures/           真实页面结构 fixture（仅含合成内容）
docs/                     产品规格、开发指南、开发任务、兼容性调查、协议与提示词草案
```

## 许可

MIT
