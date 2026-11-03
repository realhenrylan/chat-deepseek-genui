# browser-skill 真实网页验收操作手册

本文记录阶段 7 使用 browser-skill（`bsk_session` / `bsk_interact` / `bsk_page` / `bsk_inspect`）在 chat.deepseek.com 上做真实验收时遇到的四类阻碍与对应操作纪律。目的：下一轮验收不再把工具与时序问题误判为产品失败，也不再重复踩同样的坑。验收记录本体见 [phase7-acceptance.md](phase7-acceptance.md)。

## 1. 握手与授权：先 sync，再操作

**症状**：session 创建后 observe/screenshot 正常，但 click/fill/reload 等写操作全部被拒：

```text
This action requires the context returned by the latest cooperate sync
```

**原因**：插件（`@wxg-prc-cpg/browser-skill-dsh-plugin`）与扩展/CLI 版本不匹配时（曾为 0.3.3 vs 0.4.1），cooperate 握手没有建立，控制上下文缺失。截图类只读操作不经过控制上下文，所以看起来"页面正常"。

**纪律**：

1. 每个 session 的第一个动作是 `bsk_session({action:"sync"})`。
2. 插件版本以 `C:\Users\Henry Lan\.dsh\profiles\desktop\node_modules\@wxg-prc-cpg\browser-skill-dsh-plugin\package.json` 为准，与扩展/CLI（`bsk.exe --version`）一致。不匹配时优先更新/重启插件侧（Edge 重启联网更新曾被验证有效）；CLI `bsk cooperate sync --session <id> --policy auto --json` 可作为临时绕过取证手段，但不替代修复。
3. 导航、人工干预、文档替换之后必须重新 sync，再下发新动作。

## 2. 调用模型：sync → 操作 → 重新 sync

- **observation 单次消费**：sync 返回的 `observation_id` 用一次就失效；未定位的交互（脚本、视觉点击）每次都要新 observation。
- **target 策略复用 contextId**：`bsk_session sync` 得到的 `context_id` 在 target-policy 操作间可复用，业务事实用 `expect` 声明（例如按钮文本）防止无关更新阻塞。
- **ref 易过期**：文档变化、流式输出、滚动都可能让 `@eN` 失效；同一轮 sync 内拿到的 ref 不要跨"页面变化"使用。稳定读取优先用 CSS 选择器，例如 `textarea[name="search"]`、`[data-genui-state]`。
- **减少全量 sync**：完整无障碍树很大，宁可多做一次限定范围的 `bsk_interact evaluate` 读 Shadow DOM，也不要为看一个小部件反复全量 observe/sync。
- **失败重试顺序**：报 context/observation 类错误 → 重新 sync，而不是重放同一动作。若上一次动作可能已生效（如点击提交），先观察结果再决定，避免重复提交。

## 3. 扩展生命周期：版本对账 + 重载交接

**改完 `src/content/**` 后 `npm run build` 只更新 `dist/`；刷新 chat.deepseek.com 不会重载扩展**。页面跑旧 content script 时，v2 语义（如「查看增强说明」按钮）不存在，看起来像"功能坏了"，实际是旧版本仍在运行。

**版本对账（ v2 起可用）**：页面根元素 `<html>` 上有两个非视觉标记，可用于区分「扩展未重载」与「脚本未注入」：

| 属性 | 写入者 | 含义 |
| --- | --- | --- |
| `data-genui-ext-loaded` | lifecycle.ts | runtime id；存在即说明脚本注入过 |
| `data-genui-version` | lifecycle.ts | 构建注入的扩展版本（无构建环境为 `0.0.0-dev`） |

读取方式（任选其一）：

```js
document.documentElement.getAttribute('data-genui-ext-loaded');
document.documentElement.getAttribute('data-genui-version');
```

或看控制台 Verbose 日志：`[dsgenui] content script loaded (<runtimeId>, v<版本>)`。

**判定表**：

- 两个属性都存在、版本与 dist 一致 → 环境 OK。
- `data-genui-ext-loaded` 存在但版本旧 → 扩展未重载：需要用户在 `edge://extensions/` 重载，或直接重启浏览器。
- 两个属性都不存在 → 脚本未注入：检查会话站点 URL、匹配范围、注入时机。

**为什么 browser-skill 不能自己重载扩展**：`edge://` 是受限页，content script 不注入（曾报 `Could not establish connection. Receiving end does not exist.`），browser-skill 也不能接管用户普通标签页（旧版本曾提示 `Select an owned task tab; borrow user tabs explicitly`）。UIA 路线（点击扩展详情页的重载）不可依赖。**标准交接**：用 `bsk_assist request-help` 把「请重载 dist/ 扩展并回到 chat.deepseek.com」交给用户，完成后重新 `bsk_session start` + sync（重启浏览器会使旧 session 作废，`bsk_interact` 会话 id 不能复用）。

## 4. 真实页面读取陷阱

### 4.1 Shadow DOM：卡片内容不在 host 里

卡片挂载在 `<div class="genui-card-host" data-genui-host="">`，可见内容在它的 open Shadow DOM。`host.textContent` 为空、`host.querySelector` 返回 null 都是正常现象，不是渲染失败：

```js
// 正确读取
const shadow = document.querySelector('.genui-card-host')?.shadowRoot;
shadow?.querySelector('[data-genui-role=slider-input]')?.value;
shadow?.textContent.includes('预算复核');
```

### 4.2 离屏代码块：解析失败先看视口（ v2 起已缓解）

站点对视口外代码块延迟渲染，DOM 中只有短前缀；曾出现 "31 字符 / invalid-json / `data-genui-state="failed"`" 的假失败，scroll-to 后即恢复并正确挂载。

生产内容脚本已内置视口门控（`src/content/viewport-gate.ts`）：

- 块首次进入视口之前，解析失败（invalid-json / missing-pre / schema-violation）**不写** `data-genui-state`，只输出 `[dsgenui] block deferred (offscreen)`；进入视口后按正常规则判定。
- 门控只抑制"失败标记"；文本完整有效的离屏块仍会提前挂载，滚动到位时卡片已就绪。
- 注意：流式期间瞬时 invalid-json（`[dsgenui] block skipped (invalid-json): Unterminated string…`）在生成结束后自然恢复，不需要人工处理。

**读卡纪律**：判定真实生成质量前，按正常阅读路径滚动到回答末尾，等生成结束且内容稳定（无「停止生成」按钮、扫描快照稳定 ≥700ms）再读 `[data-genui-state]` 与卡片内容。

### 4.3 交互时序

- **草稿追加 debounce**：填充场景提示词后等 ~700ms（augment 的停止输入等待），先 evaluate 确认草稿已包含完整标记与正文，再按 Enter；否则可能在扩展追加前发送。
- **生成等待**：按 Enter 后轮询 `[aria-label="停止生成"]`/`[title="停止生成"]` 消失，再滚动读卡；不要在流式中下结论。
- **滑块/键盘焦点**：`bsk press ArrowRight/Home` 需要焦点真实落在控件上；不可靠时改用 evaluate 在 Shadow DOM 内对原生 `input[type=range]` 派发 `input` 事件。
- **会话 id 失效**：Edge 重启后旧 session 作废，重新 start，不要复用旧 session id。

## 5. 一轮验收的标准顺序

1. `bsk_session start`（默认 Edge 配置，Agent Window 与用户共享登录态）→ `sync`。
2. 版本对账：读 `data-genui-version` 与 dist 期望一致。
3. 新对话 → 填场景提示词 → 等 700ms → 确认草稿 → Enter。
4. 轮询生成结束 → 滚动到回答末尾 → 读 `[data-genui-state]` 与 host.shadowRoot 内容。
5. 归因判定：`deferred (offscreen)` / 流式瞬时 invalid-json 是时序现象；生成结束且块可见后仍 failed 才记产品问题。
6. 结束时 dispose 生命周期，标签页归还用户。
