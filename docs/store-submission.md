# Edge Add-ons 商店提交准备与状态（2026-11-07）

**当前状态：0.2.1 本地分发包（含 en / zh_CN 商店国际化）已就绪，商店未提交。** Logo 已接入 manifest、DeepSeek 页面开关、交互卡片和 README；当前源码已通过完整检查与 Edge/Chrome 默认端到端验证，ZIP 包含全部 Logo、图标与 `_locales` 语言文件。商店方形 Logo 源素材已定稿，隐私政策公网 URL 待确认；提交动作依赖用户的 Partner Center 账号（个人或组织），由用户另行执行。提交后请在本文件追加「审核状态」小节（提交日期、审核结论、申诉记录）。

依据：Microsoft Edge Add-ons《Developer policies》，官方页面最后更新 **2026-07-24**（learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies，2026-11-03 经 browser-skill 抓取核对）。

## 政策逐条复核（对照本项目）

| 政策条目 | 要求摘要 | 本项目状态 | 证据 |
| --- | --- | --- | --- |
| Principles | 独特价值、不误导 | ✔ 声明式卡片渲染是独立价值；README/说明明确「非官方、与 DeepSeek 无关、依赖站点结构」 | README 首段；docs/privacy.md |
| 1.1.1 单一目的 | 窄功能单一目的 | ✔ 单一目的：为 DeepSeek 网页回答提供可关闭的声明式交互界面增强（默认增强是该能力的引导部分，不是独立目的） | manifest.json（`__MSG_extensionDescription__` → `_locales/zh_CN/messages.json`）；README |
| 1.1.2 准确描述 | 功能/限制/价值主张清楚，不冒充 | ✔ 明确依赖站点页面结构、可能改版失效；名称使用仅指被增强网站，带「非官方」声明 | README 权限说明；docs/prompt.md |
| 1.1.3 完全可用 | 无阻断、坏链接 | ✔ 全功能可用 | 本阶段 e2e 与人工验收 |
| 1.1.4 搜索词 | ≤7 个相关词 | ✔ 素材给出 7 词上限草稿 | 本文素材清单 |
| 1.1.5 详情 | 列表页信息充分 | ✔ 描述草稿充分；截图为可选素材（建议提供） | 本文素材清单 |
| 1.1.6 稳定性 | 不冻结/不崩溃 | ✔ 无轮询忙循环（MutationObserver + 防抖），错误边界回退 | 已通过记录 |
| 1.1.7 混淆 | 禁代码混淆 | ✔ 源码公开（本仓库），产物为可读打包；如有审核要求可提供符号化说明 | 仓库源码 |
| 1.1.8 浏览器设置 | 未经同意不改设置 | ✔ 不涉及任何浏览器设置、搜索、主页、收藏；注入仅限目标页面且有一键开关 | manifest 权限；toggle 组件 |
| 1.2 Security | 最少权限、无敏感收集 | ✔ 仅 `storage`；不收集个人信息；无 DNR；无批量变体 | check-dist + 静态不变量单测 |
| 1.2.1 CSP | 不得下载远程脚本运行 | ✔ 产物零远程脚本/CDN/eval/importScripts（构建期扫描失败即阻断） | scripts/check-dist.mjs + 本阶段校验记录 |
| 1.2.2 恶意软件 | 禁 | ✔ 无任何恶意行为面；无后台、无网络 | 同上 |
| 1.2.3 依赖披露 | 依赖非集成软件须说明 | ✔ 明确：功能依赖 DeepSeek 网页版自身的页面结构、登录后的模型对话与模型输出格式 | README 首段；描述草稿 |
| 1.2.4 更新渠道 | 仅经 Partner Center | ✔ 当前仅本地分发；上架后走商店更新 | 本文状态 |
| 1.3 可测性 + 测试步骤 | 提交时提供审核步骤 | ✔ 审核测试步骤已起草（下文）；站点登录依赖如实披露，不作豁免处理 | 本文审核测试步骤 |
| 1.3.1 凭证 | 需登录时给测试账号或解释 | ✔ 如实披露+替代说明：注入与开关（第 1 步）不需登录；卡片功能需登录站点并与模型对话（站点自身要求）。无法提供站点测试账号（账号受站点服务条款约束、非本项目所有），以 Notes for certification 中的原因说明与替代复核路径（仓库 e2e 模拟页、协议文档与示例 JSON）代替 | 下文步骤注 |
| 1.3.2 服务可用性 | 依赖服务器须可用 | ⚠ 依赖如实披露：卡片生成依赖 DeepSeek 网站自身在线服务（登录、模型生成），可用性由站点维护、非本项目控制；扩展自身不发起任何网络请求（源码静态不变量） | docs/privacy.md；phase8-verification.md |
| 1.4 可用性 | 启动快、响应、兼容 | ✔ document_idle 注入、轻量观察器；兼容性范围内（Windows 桌面 Edge/Chrome 实测） | phase8-verification.md |
| 1.5.1/1.5.2 隐私 | 必要收集 + 隐私政策 | ✔ 不收集个人信息；已维护独立隐私政策，明确 Edge 语境、随版本更新 | docs/privacy.md |
| 1.5.3 第三方分享 | 需 opt-in | N/A：无任何分享 | docs/privacy.md |
| 2.2 内容 | 第三方名称合理使用 | ✔ 「DeepSeek」仅作指代被增强网站的功能描述，附非官方声明 | 描述草稿 |
| 2.3–2.11 内容红线 | 禁赌博/盗版/挖矿等 | N/A | — |
| 2.12 年龄分级 | 按内容选级 | ✔ 非 Mature（无成人/暴力/敏感内容） | — |

## 上架素材（复制到 Partner Center 使用）

- **显示名称**：DeepSeek GenUI（非官方）
- **简短描述（manifest `extensionDescription`，来自 `_locales/*/messages.json`）**：
  - English：Adds closable, declarative interactive cards, charts, tables and local calculations to DeepSeek web answers.
  - 中文：为 DeepSeek 网页回答提供可关闭的声明式交互界面增强。
- **长描述草案**：
  > 为 chat.deepseek.com 的 AI 回答增加可交互界面：识别回答中的 `genui` 代码块并渲染为卡片，支持数值输入、滑块、选择器、图表（柱状/折线/饼图）与可排序筛选的表格，全部计算在本地白名单内完成，无需联网、无需任何账号权限。跟随站点明暗主题，可展开查看原始 JSON，可一键关闭恢复原样。另含默认增强：开始输入后自动把一份可见的「界面说明」追加到草稿末尾，发送前可完整核对并随时关闭；扩展不代发消息、不写隐藏内容。独立第三方项目，与 DeepSeek 官方无关；依赖该网站的页面结构与登录后的模型对话，网站改版可能导致功能失效，隐私说明见项目仓库 docs/privacy.md。
- **搜索词（≤7）**：DeepSeek、GenUI、交互卡片、可视化、本地计算、对话增强、图表表格
- **类别**：Productivity（生产力工具）；**年龄分级**：非 Mature
- **视觉素材**：manifest 图标已包含在 0.2.1 提交包中；选定方案 02「交互节点」的方形组合 `assets/branding/responsive-node-v1/logo-stacked.png`（512×512）可用作商店 Logo。页面截图为可选项，建议提供以充实详情。
- **隐私政策链接**：项目仓库 `docs/privacy.md` 的公开 URL（上架前确认仓库可公开访问，或在提交表单直接内嵌同文说明）。
- **网站/支持**：项目 GitHub 仓库（Issues 作为支持入口）。
- **当前提交包**：`release/deepseek-genui-v0.2.1.zip`（174896 B），含 `manifest.json`、内容脚本、4 个图标、页面 Logo 与 `_locales/en|zh_CN/messages.json`，共 9 个文件。
  SHA256 `55469db296882fcd02ae903c49ff59eafdc87aa080e5c53d0b142c15f5e0e4dc`；逐文件清单见 `release/deepseek-genui-v0.2.1.sha256`，历史 0.1.0 验收基线见 [分层报告](phase8-verification.md)。

## 国际化（i18n）与商店语言

0.2.0 及更早版本 manifest 的 `name` / `description` 是写死的字符串，包内没有 `_locales`，Partner Center 因此只识别默认的 English (United States)，`Add a language` 按钮保持灰色。0.2.1 起按 Edge/Chrome 标准改为：

- `public/manifest.json`：`"name": "__MSG_extensionName__"`、`"description": "__MSG_extensionDescription__"`、`"default_locale": "en"`；
- `public/_locales/en/messages.json`、`public/_locales/zh_CN/messages.json`：各提供 `extensionName` 与 `extensionDescription` 的非空译文；
- 构建时 Vite 将 `public/_locales/` 原样复制到 `dist/_locales/`，`scripts/check-dist.mjs` 校验占位符、`default_locale`、必需语言与每个语言的被引用键；`tests/unit/manifest-i18n.test.ts` 在源码层再做一遍。

Partner Center 的识别规则（官方文档 “If a single locale appears, but the package includes multiple languages”）：manifest 必须用 `__MSG_` 引用名称/描述，`_locales` 中每种语言都要提供对应译文，商店会跳过缺少译文的语言。

**操作顺序**：先上传新的 0.2.1 ZIP，再打开 Store listings；正常应看到 English (United States) 与中文（简体）两项，`Add a language` 可用。每种语言仍需单独填写长描述（≥250 字符）并上传 Logo。若重传后仍只显示一种语言，属于已知的 Partner Center 显示问题（microsoft/MicrosoftEdge-Extensions#169）：先退出重登、无痕窗口刷新，仍不行则通过 Partner Center 支持渠道反馈，附上包内 `_locales` 结构与上述官方文档链接。

> 说明：本次只做商店/清单元数据国际化，页面内 UI 仍为中文；如后续需要英文界面，再单独做运行时的 `chrome.i18n` 改造。

## 上架前清单（建议在提交前完成）

1. **完整复核与提交包（已完成）**：0.2.1（含 `_locales` 国际化）已通过 `npm run check` 与默认 Edge/Chrome e2e，ZIP 与逐文件 SHA256 已更新；后续若修改包内文件，应重新构建、验证并出包。
2. 商店 Logo 使用 `assets/branding/responsive-node-v1/logo-stacked.png`（512×512）；页面截图为可选项（建议提供以充实详情，非提交必需；可用模拟页/真实页面截图）。
3. 确认隐私政策 URL 可公开访问。
4. Partner Center 注册（开发者账号），提交时选择常规的自动审核即可；如预先获知需人工沟通证据，再选手动审核。
5. 提交表单把「审核测试步骤」全文粘贴进 Submission Options > Notes for certification。

## 审核测试步骤（Notes for certification 用）

1. 安装后打开 `https://chat.deepseek.com/`：页面根元素出现 `data-genui-ext-loaded` 属性与右侧中部的「GenUI 已开启」按钮，即注入成功；其他网站不出现。
2. 发送任意问题（例如「做一份每月预算可视化卡片，用 GenUI 输出格式」）：输入 700ms 停顿后草稿末尾自动追加一段可见说明文本（可点「查看增强说明」面板核对全文），由用户自行点击发送；扩展不代发消息。
3. 回答完成后，若回答含 `genui` JSON，原代码块位置渲染交互卡片：输入/滑块/选择器即时本地计算、重置、展开/收起原始 JSON、图表与表格排序筛选、「继续讨论」预填草稿（不自动发送）。
4. 点「GenUI 已开启」关闭：卡片恢复为原始 JSON 代码块；自动追加的说明（若仍完整）被移除且保留用户已写的原文；再次开启可恢复追加行为。
5. 不适用性问题（如「水的沸点是多少」）：回答为普通文本，不出现卡片，页面其他行为不受影响。
6. 站点明暗主题切换时，卡片与开关外观跟随。
7. 提示：卡片由模型输出驱动，模型可能不生成 `genui` JSON——此时该回答按设计保持原样，属预期回退，不是功能故障；可在会话中重发带明确示例要求的提示。

> 1.3.1 说明（登录依赖披露，非豁免）：扩展注入、开关与说明面板（第 1 步及第 2 步开头）无需登录；卡片渲染与本地计算需要回答中含有模型生成的 `genui` JSON，因此要求已登录 DeepSeek 站点并与模型对话——这是站点自身要求，不是扩展的权限或数据需求（扩展零网络、零用户数据）。本项目无法提供站点测试账号：账号受 DeepSeek 服务条款约束、非本项目所有。不登录时的替代复核路径：使用本仓库 `npm run test:e2e`（模拟页）复现卡片行为，或阅读 `docs/genui-protocol.md` 与 `docs/examples/` 下的示例 JSON。

## 风险与建议

- 单一目的表述在描述中保持窄口径（见 1.1.1 行），避免把「默认增强」写成独立工具以免歧义；
- 描述中不要出现「官方」「DeepSeek 推出」字样；保留「非官方」前置；
- 审核若对打包产物提出语义可读性要求（1.1.7），参见仓库源码与 `docs/genui-protocol.md` 提供对照说明；
- 上架后的每次更新：版本号同步（`package.json` = manifest）、check-dist、e2e 复跑，并在本文件记录提交与审核时间线。
