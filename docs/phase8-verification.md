# 阶段 8 分层验证报告（2026-11-03）

本报告按 `docs/development-task.md` 阶段 8 要求分层输出：已实现、已通过、真实环境未验证、已知限制、后续能力。对应的政策复核与商店提交状态见 [docs/store-submission.md](store-submission.md)，隐私说明见 [docs/privacy.md](privacy.md)。

当前分发版本为 **0.1.1**，已包含 Logo 接入改动。当前构建与验证见下节；后续「0.1.0 历史验收基线」保留当时的浏览器、真实网页和 ZIP 结果，不作为本轮真实环境复验结论。

## 当前分发版本 0.1.1（2026-11-03）

- README 已接入明暗两套横向 Logo，并以功能、场景、使用和安装为主；package.json、根锁文件、manifest、内容脚本构建标记和当前隐私说明统一为 0.1.1。
- `npm run check` 通过：25 个测试文件、253 项单测；类型检查、lint、校验器再生成、构建与 dist 校验均通过。
- 默认 Edge/Chrome e2e：**18 passed、6 skipped**；本轮未重跑 `REAL_SITE=1`，未发送真实模型测试消息。既有真实 origin 与模型验收仅保留为历史证据。
- 构建为 43 个模块；`dist/content.js` **441598 B**（gzip 102.95 kB），`dist/manifest.json` **641 B**；仅 `storage` 权限，无 host_permissions/background。受限的可访问资源仅用于站点内展示本地 Logo。
- 发布包 [deepseek-genui-v0.1.1.zip](../release/deepseek-genui-v0.1.1.zip) 为 **107040 B**，包含以下 7 个文件；已核对每项的 SHA256 与当前 `dist/` 一致。

| 文件 | 大小 |
| --- | ---: |
| `branding/logo-small.svg` | 452 B |
| `icons/icon-128.png` | 1349 B |
| `icons/icon-16.png` | 329 B |
| `icons/icon-32.png` | 428 B |
| `icons/icon-48.png` | 554 B |
| `content.js` | 441598 B |
| `manifest.json` | 641 B |

SHA256（当前 0.1.1 基线；全部资源的校验值见 [校验清单](../release/deepseek-genui-v0.1.1.sha256)）：

```text
release/deepseek-genui-v0.1.1.zip  70cdaca04a738a1666301cddbe1650cd4bced654f8e5174fb95cae02f5af8d6d
dist/content.js  22ba4e4fb80b5ca08079e95764232d7c51282061c4031e4116355d23529021ed
dist/manifest.json  c47a0c7cccf4e75ff9379eb62dbefdf2e81806b45ace00e06f20eb9115c06c4f
```

0.1.1 可解压后本地加载，或直接加载当前 `dist/`。商店仍未提交，公开隐私政策链接等提交准备见 [商店记录](store-submission.md)。

## 0.1.0 历史验收基线

以下各节记录 Logo 接入前的 0.1.0 验收。其 ZIP 仅有 manifest 与内容脚本两项，旧哈希属于历史包，当前 `dist/` 与当前发布包应使用上方 0.1.1 基线核对。

## 概览

- 历史扩展版本 0.1.0（当时 `package.json` 与 `dist/manifest.json` 一致，由 `scripts/check-dist.mjs` 断言）。
- 验证环境：Windows 11；Node v24.15.0、npm 11.12.1；Playwright 1.64.1（经 `channel: msedge` / `channel: chrome` 直接启动系统浏览器）。
- 系统浏览器版本（2026-11-03 实测）：**Edge 156.0.4314.58**（较阶段 7 记录的 156.0.4314.50 更新）、**Chrome 156.0.8078.79**。本阶段全部 e2e 基于这两个版本运行，功能断言无差异。
- 名称「阶段 8」的语义：按开发任务的口径，**完整验证、文档与发布准备已完成；商店提交与审核未执行**（原因与素材见 store-submission.md）。发布准备不等于已上架。

## 已实现（阶段 1–7 累计的功能清单）

- 注入与开关：内容脚本仅在 `https://chat.deepseek.com/*` 注入，页面根元素 `data-genui-ext-loaded` / `data-genui-version` 标记；可见「GenUI 已开启」开关，`chrome.storage.local` 存储 `genuiEnabled`（默认开启，跨标签同步）。
- 协议与渲染：genui v1（静态文本卡）、v2（数值输入/滑块/选择器/白名单派生/重置）、v3（说明、分区、多列、柱状/折线/饼图、表格排序筛选条件行）；模型输出按纯文本处理；失败回退为冻结展示原始 JSON 代码块。
- 生命周期：生成等待（活跃信号 + 700ms 内容稳定）、回复改写/节点替换/会话切换清理、BFCache 返回清理、视口门控缓解离屏代码块延迟渲染误判。
- 卡片体验：按站点亮暗主题跟随；展开/收起原始 JSON（React 树不卸载、状态/草稿/错误/重置计数保留）；「继续讨论」把当前条件摘要回填输入框，是否发送始终由用户决定。
- 默认增强：停止输入 700ms 后把正式提示词（`GENUI_PROMPT_VERSION=2`）逐字追加到当前草稿末尾，可在输入框与「查看增强说明」面板核对；不自动发送、不写隐藏消息；关闭开关精确移除自动说明并保留用户原文；手动删除后不再追加。
- 安全不变量：仅 `storage` 权限、无 host_permissions、无后台；内容脚本源码零网络 API 引用（单测锁定）；产物禁 eval/动态执行/远程脚本（构建期扫描）。

## 已通过（本阶段实测）

| 检查 | 结果 |
| --- | --- |
| `npm run check`（typecheck、lint、单测、gen-validator 再生成、构建、生产包校验） | 通过（exit 0）：25 个测试文件 253 项单测 |
| 生产构建 | 通过：`dist/content.js` 440,928 B（gzip 102.71 kB）、`dist/manifest.json` 352 B；42 模块 |
| `check-dist` 生产包校验 | 通过：`permissions=["storage"]`，无 host_permissions/background，matches 严格等于 `https://chat.deepseek.com/*`，无 eval/`new Function`/importScripts/远程脚本/样式 URL/CDN 域名 |
| 默认 e2e（Edge + Chrome，本地模拟页） | 通过：18 passed / 6 skipped（6 个为真实 origin 用例按运行模式设计性跳过），1.5m |
| `REAL_SITE=1` e2e（Edge + Chrome，真实 `https://chat.deepseek.com` origin，合成回复 DOM，不读取真实聊天内容） | 通过：8 passed / 16 skipped。真实 origin 下通过：阶段 2 合成结构最小案例、阶段 3 生命周期与回退、阶段 4 合成界面本地计算（各双通道）；站点自身请求记录为空；模拟页用例与阶段 7 用例在该模式按设计跳过；38.9s |
| 源码静态不变量 | 通过：`tests/unit/extension-static.test.ts` 断言 src 源码零 `fetch`/XHR/`sendBeacon`/WebSocket/`EventSource` 引用；构建期锁定校验器无动态执行 |
| 发布包 | 通过：`release/deepseek-genui-v0.1.0.zip`（102,046 B），扁平仅两项 `manifest.json`（352 B）+ `content.js`（440,928 B）；SHA256 见下 |
| Edge Add-ons 政策复核 | 已按官方《Developer policies》最后更新 2026-07-24 版逐条核对（用途、描述、隐私、权限、审核测试步骤、CSP、单一目的等），无阻断项；详见 [docs/store-submission.md](store-submission.md) |

SHA256（验收基线）：

```
release/deepseek-genui-v0.1.0.zip  fa3128faa0f7ff6703ea30d6bb16171f8749c79bff7405bc6abb0e0300b6a9ff
dist/content.js                    82f28e41609c4e0d9fef4576a3053bf4b7ba813e8dc7a5d6843d17e7591a5c59
dist/manifest.json                 d7cbd68d4cdaaf7c7c9d0dbf7032c790329f805750c83adbc480e7a42049dc15
```

复制发布包（PowerShell）：

```powershell
Compress-Archive -Path dist\manifest.json,dist\content.js -DestinationPath release\deepseek-genui-<版本>.zip
```

加载方式：把 `release/deepseek-genui-v0.1.0.zip` 解压为目录后在 `edge://extensions`（开发人员模式）「加载解压缩的扩展」，或直接加载仓库 `dist/` 目录；访问 `chat.deepseek.com` 出现 `data-genui-ext-loaded` 即注入成功。

复现方法（全量）：

```bash
npm ci
npm run check        # 类型、lint、253 单测、生成校验器、构建 + dist 校验
npm run test:e2e     # 默认模拟页（Edge/Chrome 18 通过 / 6 设计性跳过）
# PowerShell：$env:REAL_SITE=1 后 npm run test:e2e → 真实 origin 8 通过 / 16 设计性跳过
```

构建可复现性：vite 产物与环境/锁文件相关；上述哈希是本次验收基线，跨机重建功能等价但不保证逐字节一致（`npm ci` 固定依赖树可提高一致性）。

## 真实环境未验证（不宣称完成的部分）

1. **真实页面 URL 级网络抓包**：未执行。理由：现有四条归因证据独立成立且全部通过（源码零网络 API 静态不变量、manifest 权限收敛、check-dist 全包扫描、模拟页零请求断言）；真实 origin 用例的技术底座（Playwright 未暴露可信 initiator）只能证明「无 `chrome-extension://` 起源请求」。URL 级抓包需要独立取证环境，未列入本阶段产物；文档结论保持既有收紧措辞，不以此替代抓包证据。
2. **重新打开历史会话后的恢复行为**：设计约定为——原始 `genui` JSON 代码块永久保留在消息里，卡片总是从它重新挂载，**交互状态回到初始值**（单卡内存不持久化，`docs/development-guide.md` §4；BFCache/节点替换/会话切换单测覆盖内存清理路径）。真实 DeepSeek 网页对「重新打开旧会话」未单独立项做人工验证，本报告不宣称该项已真实验证；用户可自行打开旧会话观察（预期：卡片重新挂载、控件为初始值、原始 JSON 可切回查看）。
3. **真实模型生成稳定性**：阶段 7 完成一次三场景 + 同类新问题 + 不适配样本的人工验收（含一次真实失败与 v2 修复后重跑通过），阶段 4 完成一次单案例手工复核；均为行为证据，非重复稳定性统计。提示词 v2 提高合规率，但任何模型行为都不由协议保证。
4. **Edge Add-ons 商店提交与审核**：未执行（无 Partner Center 账号/提交由用户另行决定）。政策复核与提交素材已备妥，见 [docs/store-submission.md](store-submission.md)；发布准备≠已上架。
5. **平台覆盖**：仅 Windows 11 桌面 Edge/Chrome（156.x）实测。macOS/Linux、移动端 Edge、Firefox 未验证。

## 已知限制

- 依赖站点页面结构：AI 消息容器、`genui` 语言标签（`span.d813de27`）、输入框标记（`textarea[name="search"]` 或 placeholder「给 DeepSeek 发送消息」）等任一处的站点改版都会导致识别或追加失效。
- 离屏代码块延迟渲染已由视口门控缓解（`src/content/viewport-gate.ts`），但仍依赖 IntersectionObserver 与站点渲染时序，极端情况下挂载会短暂延后。
- 流式生成期间模型可能输出不完整 JSON 的瞬时失败标记，确认停止生成并稳定后再判定，不应误记为持久失败。
- 模型输出不确定：问题不适用、模型未按提示词生成或生成非法对象时，扩展按设计回退为原始代码块展示（安全路径），不弹提示打扰。
- 交互状态不持久化是 MVP 设计边界（单卡内存，刷新/重开回到初始值）。
- 历史验收不含后来接入的 manifest icons、页面开关与卡片 Logo；这些资源的本地检查、默认 e2e 与出包已在 0.1.1 完成，尚未在真实模型会话中复验。
- 开发依赖存在 11 条 moderate 审计告警（传递依赖 minimatch，阶段 1 记录；不进运行时，不阻塞）。
- `content.js` 440.92 kB（gzip 102.71 kB）为全功能单文件；对页面加载的量化影响未做微基准。

## 后续能力（不在 MVP / 阶段 8 范围）

- 正式渠道上架：本地验证与 0.1.1 提交包已完成，后续确认公开隐私链接、Partner Center 提交与审核跟进（见 store-submission.md）。
- 会话级交互状态保存：以会话标识为键的轻量记忆，使重新打开旧会话时控件回到离开时状态（MVP 明确不做持久化承诺）。
- URL 级网络归因实验：独立取证环境下的逐请求抓包，补足「无未声明网络行为」的证据链。
- 协议演进：i18n、更多元素类型、协议 v4、示例库；以及 Firefox 移植（不同于 MV3-CSS 注入差异需另测）。
- 产物瘦身：按浏览器特性开关的代码分割。
