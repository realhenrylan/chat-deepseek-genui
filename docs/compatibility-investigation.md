# 阶段 0：环境、官方规范与真实网页调查

更新日期：2026-11-02。本文记录阶段 0 的真实观察、适配依据、默认增强可行性、权限草案及风险。所有页面集成结论均来自 Edge 156 上 chat.deepseek.com 的实测取证，未涉及认证信息与个人聊天内容（侧栏历史会话标题仅作为 DOM 结构观察，不记录内容）。

## 1. 环境与版本记录

| 项 | 版本 / 状态 |
| --- | --- |
| 操作系统 | Windows NT 10.0.26300（Windows 11） |
| Git | 2.56.0.windows.2；分支 `main`；1 个提交 `07ddb04 Initial commit`；未跟踪 `CHANGELOG.md` 与 `docs/`；origin `https://github.com/realhenrylan/chat-deepseek-genui.git` |
| Node.js | v24.15.0 |
| npm | 11.12.1（无 pnpm） |
| Edge（首要验收） | 156.0.4314.50（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`） |
| Chrome（独立检查） | 系统版 156.0.8078.79；用户目录版 148.0.7778.96 |
| Python | 3.12（本地解析脚本用） |

工具限制：`web_fetch` / `web_search` 无法访问 learn.microsoft.com（non-public IP / 401）；改用 `curl` 直接抓取官方文档，已存档 `api-support` / `mv3` / `sideload` 三份页面文本。

## 2. 官方资料确认（MV3、所需 API 与最低权限）

来源：Microsoft Learn 官方文档（MV3 概述、API 支持表、本地加载说明）。

- **MV3 约束**：禁止远程托管代码，只能运行扩展包内 JS；后台页 → Service Worker；运行时主机权限由用户可控；内容脚本与所在网页同权限；网络请求修改用 declarativeNetRequest。
- **API 支持**：`scripting`（MV3，Win/Linux/Mac/Android）、`storage`（MV2+MV3）、`tabs`、`runtime` 均支持；`activeTab` 是权限项而非 API 表条目。
- **本地加载**：`edge://extensions` → 开发者模式 → Load unpacked。

### 权限草案

| 权限 | 用途 | 是否必需 |
| --- | --- | --- |
| `content_scripts` 匹配 `https://chat.deepseek.com/*` | 注入内容脚本，观察与挂载 GenUI | 是（唯一必需） |
| `storage` | 存增强开关等本地设置 | 是（默认增强可关闭要求） |
| `scripting` | — | 否（静态 content_scripts 无需） |
| 后台 Service Worker | — | 否（无跨标签协调需求时不加） |
| `declarativeNetRequest` / host_permissions | — | 否（不修改网络请求） |

理由：阶段 0 未发现需要后台逻辑或网络拦截的集成点；内容脚本与网页同权限，无需额外主机权限。若阶段 3+ 出现跨会话/跨标签状态同步需求，再按实际调用补充并重新评审。

## 3. 真实网页 DOM 观察

### 3.1 主题检测

- 暗色：`<body class="zh_CN dark" data-ds-dark-theme="dark">`
- 浅色：`<body class="zh_CN light">`（`data-ds-dark-theme` 属性消失）
- **检测可靠途径**：body class 的 `dark` / `light`；`data-ds-dark-theme` 仅暗色存在，可作辅助。

**主题切换入口**（已成功打开取证）：侧栏底部用户区（Henry L.）→ 点击「…」按钮 → 弹出菜单（下载手机应用 / 系统设置 / 帮助与反馈 / 退出登录）→ 系统设置 → 通用设置 → 主题三选（浅色 / 深色 / 跟随系统）。实测点击「浅色」后 body 由 `dark` 变 `light`，页面整体变白；点击「跟随系统」可恢复。

### 3.2 消息边界

- 用户消息容器：`div.ds-message`（`d29f3d7d ds-message _63c77b1` / `ds-message _63c77b1`）
- AI 回复主体：`div.ds-markdown.ds-assistant-message-main-content`
- 段落：`p.ds-markdown-paragraph`
- 结论：扩展只需处理 `ds-assistant-message-main-content` 内的代码块，不触碰用户消息。

### 3.3 代码块结构与语言标记

```
div.md-code-block.md-code-block-dark        （有 -light 变体）
└─ div.md-code-block-banner-wrap
   └─ div.md-code-block-banner.md-code-block-banner-lite
      ├─ div._121d384 > div.d2a24f03 > span.d813de27   ← 语言标签（如 "python"、"json"）
      └─ div.d2a24f03._246a029 > div.efa13877           ← 复制 / 下载按钮（span.code-info-button-text）
└─ <pre><span>行</span>…</pre>              ← 代码行是 span，无 <code> 元素
```

- 高亮 span 类如 `token comment`。
- **语言标记检测路径（与原规格一致）**：只处理 AI 回复中**明确标记 `genui`** 的代码块——`div.ds-assistant-message-main-content` 内 `span.d813de27` 文本 == `genui` 才纳入，JSON 内容再按 `type == "genui"` 校验。语言标签为 `json` / `python` 或无标签的代码块一律不处理（普通 Markdown 不自动转换）。
- **`genui` 标记可渲染已实测**（2026-11-02 补测）：请求模型输出 ` ```genui ` 代码块，回复 banner 中 `span.d813de27` 按字面渲染「genui」，结构与 `json` 标记完全一致（`md-code-block-light` 变体下同样成立），见 §6.3。
- 复制功能：`复制`、`下载` 按钮文本在 `span.code-info-button-text`，位于 ds-button 内 `role="button"`。

### 3.4 回复尾部操作按钮（生成结束态）

结构：`div.ds-flex._0a3d93b`（`flex-wrap: wrap-reverse`）> `div[data-escape-transition="true"].ds-flex._965abe9._54866f7`（`gap: 10px`）> 6 个 `div[role=button].ds-button ds-button--iconLabelTertiary ds-button--capsule ds-button--xs db183363`。

顺序（悬停 tooltip 实测确认）：复制 → **重新生成**（环形箭头，tooltip「重新生成」） → 赞 → 踩 → 朗读（唯一带 `aria-label="朗读"`）→ 分享。HTML 中无「重新生成/停止」文本，为纯图标按钮。

### 3.5 输入区结构

- textarea：`<textarea class="_27c9245 ds-scroll-area ds-scroll-area--show-on-focus-within ds-scroll-area--enabled d96f2d2a" placeholder="给 DeepSeek 发送消息 " rows="2" autocomplete="off" name="search">`
- 深度思考 toggle：`div[aria-pressed="true"].f79352dc ds-toggle-button ds-toggle-button--m ds-toggle-button--selected`（含 `ds-lottie-toggle-icon`）；智能搜索同构。
- 附件按钮：`div[role=button].ds-button ds-button--iconLabelPrimary ds-button--capsule f02f0e25`，其后紧跟 `<input type="file" multiple accept="…">`。
- 初次快照曾记录空输入下的 disabled ↑ 按钮，但其采样时刻不足以证明处于流式生成中，不作为生成状态判据。流式中的停止按钮以 §4 补测结果为准。
- 页脚：`div._0fcaa63` 文本「内容由 AI 生成，请仔细甄别」。

## 4. 生命周期观察（流式、停止、重新生成、节点替换、会话切换）

| 观察项 | 结果 |
| --- | --- |
| 流式生成 | 思考先行（「已思考（用时 N 秒）」按钮出现），正文边生成边追加（heading/段落/代码块逐段出现）；侧栏出现新会话并随后自动改名。 |
| 停止按钮 | **已取证（实测完整链路）**：流式生成中，发送按钮位切换为——`<div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m _52c986b" style="--dsl-button-height: 34px;" tabindex="0">`，**无 `ds-button--disabled`、无 `bd74640a`，上箭头 path `M8.3125` 计数为 0**，图标替换为 16×16 圆角方形（path `M2 4.88C2 3.68009…11.12V4.88Z`），悬停 tooltip（`div.ds-tooltip`）文本「**停止生成**」。实测点击后生成立即截断（正文停于句中），按钮恢复为 ↑ 箭头 + `ds-button--disabled`，tooltip 变「请输入你的问题」。即：**发送与停止共用同一圆形按钮位，流式中由 ↑ 切换为 ■**；`ds-button--floating`（chevron-down）是独立的滚动到底按钮，非停止。 |
| 重新生成 | 生成结束后尾部按钮组第 2 个，悬停 tooltip「重新生成」确认。 |
| 节点替换 | 消息列表用虚拟列表（`data-virtual-list-item-key`），节点可回收重建。 |
| 会话切换 | 点击侧栏会话链接后整页消息区替换，虚拟列表节点重建 → **扩展注入的 DOM 会被销毁，生命周期观察必须用 MutationObserver 而非一次性查询**。 |

## 5. 输入框与草稿行为（不自动发送、不覆盖草稿）

实测：在「快速排序科普文章」会话输入框 fill 草稿「这是一条未发送的草稿测试」→ 切换到另一会话 → 新会话输入框 `[empty]`（草稿不跟随）→ 切回原会话 → 草稿全文恢复显示。

**结论**：草稿按会话隔离且跨会话切换保留。扩展集成必须**只读草稿、绝不覆盖或清除**；任何「继续讨论」类功能都应追加而非替换，发送仍由用户完成。

技术注意：对 DIV 包装层 fill `""` 报错 `element DIV not fillable; choose a text input, textarea, or the contenteditable editor root`——操作草稿需针对 textarea 本体。

## 6. 默认增强路径与最小协议早期验证

### 6.1 可见、可关闭的默认增强依据

网页自带「深度思考」「智能搜索」两个 toggle，均为 `aria-pressed` + `ds-toggle-button--selected` 的可见可关闭控件，位于输入框下方、用户可随时切换。这证明该站点的用户对「可见、可关闭的增强开关」有既有心智。扩展的默认增强必须同等：**默认开启但有可见开关，关闭即停止增强并恢复原始内容**，不使用隐藏内部消息。

### 6.2 最小协议早期模型输出验证

提示词（合成测试，非真实用户提问）：

> 请只输出一个 json 代码块，不要其他文字。内容是一个声明式 UI 描述，schema 为 `{"type":"genui","version":1,"elements":[{"kind":"text","value":"你好"}]}`。

模型输出（实测截图取证）：一个语言标签为 `json` 的代码块，内容精确为

```json
{"type":"genui","version":1,"elements":[{"kind":"text","value":"你好"}]}
```

会话被自动命名为「声明式UI JSON输出」。**验证结论（按证据强度如实记录）：单次 JSON 输出样本成功——一次实测中模型产出了内容精确的声明式协议 JSON，且落在标准代码块结构中。** 此样本语言标签为 `json`，按 §3.3 的正式规则必须跳过，不能作为 `genui` 识别成功的证据；`genui` 标记的补测见 §6.3。单次成功不足以断言「可靠产出、稳定检出」；多代码块、含控件的复杂协议输出与重复采样的一致性留待阶段 4/7 迭代验证。

### 6.3 `genui` 标记路径补测（2026-11-02）

> 提示词（合成测试）：请用一个代码块回答，代码块语言标记必须是 genui，内容为声明式 UI 描述：`{"type":"genui","version":1,"elements":[{"kind":"text","value":"透明增强测试"}]}`。除代码块外不要任何文字。

实测（截图 + `genui2.html` 快照取证）：

- 草稿 fill 后完整显示在输入框中，页面**未自动发送**（截图存证）；显式按 Enter 后才发出。
- 发送后用户消息气泡**逐字保留**整段提示词（含协议指令），历史可查。
- 模型回复 banner 语言标签渲染「genui」，DOM 为 `div.md-code-block.md-code-block-light > div.md-code-block-banner-wrap > div.md-code-block-banner.md-code-block-banner-lite > div._121d384 > div.d2a24f03 > span.d813de27`（文本 `genui`），内容为精确 JSON，复制/下载按钮齐全。
- 深度思考已开启（思考区「已思考（用时 1 秒）」），思考文本复述了用户要求。

**结论**：`genui` 语言标记路径已实测可渲染、可按 §3.3 检出，识别边界与原规格（只处理明确标记 genui 的代码块）一致；协议指令经**可见草稿 + 用户显式发送 + 历史逐字保留**的路径透明带入对话，用户始终能看到实际参与对话的增强内容，不依赖隐藏内部消息。仍为单次样本，不构成稳定性结论。

### 6.4 默认增强路径的可行性结论

综合 6.1–6.3：已用真实会话走通**可见草稿 → 用户显式发送 → 指令保留在历史 → 模型按要求输出**的人工验证链路，为扩展在用户可见草稿中追加协议提示提供可行性依据。扩展本身的自动追加、去重、已有草稿保护及开关逻辑尚未实现，不能将本次验证描述为默认增强功能已完成。**默认开启、可见可关闭是已确认的产品要求**；原生开关只作为界面形态参考，不构成协议提示带入对话的技术证据。**可行但未定型**：正式提示词追加位置与关闭后的恢复细节仍待实现和验证，基础开关按阶段 3 开发，默认提示词增强按阶段 7 完成验收。

## 7. 验证方法、不确定项与受限原因

**验证方法**：BrowserSkill 自动化（observe / screenshot / hover / fill / click / get-html）驱动真实 Edge 会话，配合本地 Python 解析导出的 HTML 快照取证；官方文档用 curl 抓取。

**不确定项**：

1. ~~停止按钮形态未直接取证~~ → **已消项（2026-11-02）**：流式中按钮切换为 ■（`_52c986b` 无 disabled 变体）+ tooltip「停止生成」，点击后截断生成并恢复 ↑，已截图与 HTML 双重取证（见 4）。
2. 代码块 `-light` 变体的完整结构未在浅色主题下逐字段复测（2026-11-02 的 `genui` 补测恰在浅色主题下进行，banner 与语言标签结构已确认一致；高亮 span 类名仍未逐项比对）。
3. `genui` 标记输出与协议 JSON 均为**单次样本成功**，未做重复采样，不能作为稳定性结论（留待阶段 4/5 迭代）。
4. 默认增强的提示词追加位置、去重、已有草稿保护与关闭恢复细节尚未实现和验证（见 §6.4，按阶段 3/7 推进）；开关默认开启已经确定，不属于待决策事项。

**受限原因**：自动化过程中浏览器 CDP frame 两次出现「A page frame is not responding」挂起，需重建浏览器会话（必要时重启 Edge 进程）恢复；这属于工具链限制，不影响上述取证结论的可靠性——所有结论均有截图或 HTML 快照支撑。

**隐私边界**：侧栏历史会话标题仅用于确认 DOM 结构（链接格式 `a[href^="/a/chat/s/"]`），未读取或记录任何会话内容；合成测试消息均为阶段 0 自造。
