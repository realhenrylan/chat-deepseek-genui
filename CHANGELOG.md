# Changelog

## Unreleased

### Fixed

- **`checklist` 不再被模型预勾选**：默认增强提示词里 checklist 的协议示例长期写作 `{"text":"步骤1","checked":true?,"note":"提示"?}`，且从未定义 `checked` 的语义，模型据此把 `"checked":true` 当成默认写法，导致生成的清单常在首项直接勾选（出现「1/5 已完成」）。现将示例改为 `{"text":"步骤1","note":"提示"?}`，并补充约束：`checked` 表示「该步骤此刻已经完成」，仅当用户明确说明已完成、或本轮回答中确实完成并如实交代时才写 `true`，其余情况一律省略；同时补上提示词回归断言，防止示例再次带回 `"checked":true`。渲染层与 `normalize.ts` 行为不变（仍忠实透传 `checked`，保留「清单可带初始已完成项」的能力）。

## 0.2.0（2026-11-06）

### Added

- **内联智能界面架构升级（w1 协议）**：
  - 新增轻量级单组件内联协议 `w1`，代码块顶层直接指定 `"w"`，彻底消除冗余的 `state`/`derived`/`models`/`elements` 样板代码；
  - 交付首批 7 种原子内联组件：
    - `quiz`：单选/多选互动测验，支持点击即时判定对错、徽章反馈、展开详细解析及重置作答；
    - `card`：概念与要点信息卡，支持副标题、Tag 标签与项目符号；
    - `compare`：横向并列方案对比卡，支持推荐项突出高亮（`highlight`）、优劣势列表与关键参数对；
    - `checklist`：交互式任务清单，支持复选框勾选与划线动效，顶部动态统计完成进度；
    - `slider`：快速参数调节滑块，大号数字呈现；
    - `result`：关键指标大字呈现，支持 `primary` 视觉强调；
    - `note`：信息、警示、错误等轻量提示贴片。
  - 新增轻量 Shadow DOM 样式隔离系统（`src/render/inline/inline.css`），自适应嵌入在正文气泡段落之间，深度适配站点亮/暗主题；
  - 新增跨组件微型 Reactive 状态总线（`InlineStateBus`）：同一回答容器内，上方 Slider 滑块拖拽可即时驱动下方 Result 指标联动重算；
  - 新增协议宽容层（`src/protocol/widget/normalize.ts`）：支持字符串数值自动转型、步长自动吸附与未知字段忽略，极大提升模型首轮生成成功率；
  - 新增标准化离线评测套件与打分系统（`eval/`）：收录 28 道覆盖 6 大场景的标准化基准题，自动评估各块解析率与穿插比例。

### Changed

- **默认增强提示词重构升级至 v4.0**：
  - 彻底移除“仅在最后输出一个 genui 块”与“正文通常用 1-3 句”的陈旧约束；
  - 全面引入自然穿插排版范式，引导模型充分展开长文深度讲解，在段落间自然穿插 0 到 3 个轻量交互组件；
  - 提示词内包含自然穿插内联组件、纯对比图表与月度预算综合看板 3 份合法示例；
  - 完美兼容历史草稿（v3.2/v3.1/v3.0）的识别、保护与平滑切换。
- **构建与版本号同步**：`package.json` 与 `public/manifest.json` 版本统一提升至 `0.2.0`。

### Fixed

- 统一「表达式」位置规则与裸数字字面量自动归一：
  - JSON Schema 与校验器全面放宽表达式位置约束，允许直接书写裸数字常量，并在解析阶段统一自动升格为 `{ op: 'const', value }` 表达式对象；
  - 覆盖范围包括：柱/饼图 `items[].value`、折线离散点 `points[].y`、函数曲线 `domain.start/end`、预算模型 `income` 与 `expenses[].amount`、成本模型 `horizon`、`fee` 与 `usesPerPeriod`、条件 `visibleIf` 比较运算两侧以及任意嵌套表达式的操作数；
  - 彻底消除模型按照数学直觉自然书写数字（如 `"value": 12`、`"y": 3.2`、`"amount": 2000`）却被 Schema 机械拦截为 `schema-violation` 的契约断层问题。
- 偏好模型权重规则消歧：提示词与 Schema、Validator 对齐，明确 weight 支持数字常量（0–1000）或表达式，并在运行时超出上限时截断与展示告警。
- 补全对比表与图表极简示例（示例 2）：提示词与文档增加零模型（`models: []`）的对比表加柱图示例，明确 `initialSort.key` 必须是 columns 中已声明的列 key，减少模型照速记拼装字段带来的格式瑕疵。
- 修复 v5 协议在无需语义模型（如对比表、纯图表、基础计算）时因 `models` 要求至少 1 项导致合法卡片校验失败的问题：允许 `models: []`（0–4 个），提示词与文档同步明确 `state`、`derived`、`models` 前三者可为空数组。
- 修复失败诊断与一键修复提示词生成对 v4/v5 的支持：
  - 诊断识别补齐 v4/v5 支持，避免 v5 文档的校验失败被误诊断为“版本号应为 1、2 或 3”；
  - 修复提示词明确使用“协议 1–5 的合法字段”，避免与系统提示词中“版本固定为 5”产生冲突；
  - 放宽修复片段截断阈值至 3200 字符，常见长度（如 10 行对比表）的完整代码块不再被中间截断，避免模型因信息缺失而拒绝修复。


## Unreleased

### Changed

- 图表与表格可读性（issue #16）：默认图表采用随主题变化的 DeepSeek 蓝与中性色，折线通过线型和文字图例辅助区分，保留旧文档的显式颜色；连续曲线、离散点、图形与数据表继续使用同一求值快照。长轴标题和标签可读，窄栏可横向查看图形及数据；负柱、饼图非正值和计算失败保留说明。表格数值列右对齐，首列确为互不重复的非数字文本时局部固定且不透底，其他表格普通滚动，列不隐藏；提示支持键盘横向查看，筛选、排序、选择与主题/宽度切换互不干扰。提示词升级 v3.2，保留 v3.0/v3.1 草稿识别。

### Added

- **Edge Add-ons 商店国际化（i18n）**：`public/manifest.json` 的 `name` / `description` 改为 `__MSG_extensionName__` / `__MSG_extensionDescription__`，新增 `default_locale: "en"` 与 `public/_locales/en|zh_CN/messages.json`。Partner Center 依据这些 `__MSG_` 引用识别包内语言，商店列表可同时提供 English (United States) 与中文（简体）；页面内 UI 语言保持不变。`scripts/check-dist.mjs` 与 `tests/unit/manifest-i18n.test.ts` 会校验各语言均提供被引用键的非空译文。ZIP 文件数 7 → 9（新增两个 `messages.json`），扩展版本提升至 `0.2.1`（商店重新上传需高于已上传版本）。

- 卡片操作与辅助信息分层（issue #15）：「继续讨论」保留为页脚唯一直接可见的主操作，使用主色浅底、主色边界与加深文字；「重置当前界面」仍在同一操作组内但改为无边框的次要文字按钮；原始 JSON 切换与“透明增强 · 纯文本渲染 · 不执行脚本 · 原始 N 字符”说明移入原生 details/summary「界面详情」，默认收起，展开后入口与说明保持可访问。页脚操作组带 `role="group"` 与“界面操作”名称，反馈继续就近以 `role="status"` 呈现且不进入详情；卡片收起时页脚整体隐藏、详情内的控件不进入 Tab 顺序，重新展开保留已调整参数与详情开合状态。首次打开“继续讨论”时焦点主动进入摘要文本域，取消或成功带入后回到触发按钮，避免下一次 Tab 越过预览落到“重置”。重复的 GenUI 文字标记降为次要文字色并去掉描边胶囊。复用既有 `onContinue`、`buildContinueSummary`、`onToggleRaw` 与重置逻辑，不重写摘要、不自动发送、不新增确认弹窗。
- 卡片分组与局部容器自适应布局（issue #13）：
  - `src/render/composite.tsx`：为 `columns` 外层增加 `.genui-columns-container` 局部查询容器节点，内部保持 `<div className="genui-columns" data-columns={...}>`，元素递归路径 `path`、`key` 及表格状态键保持零破坏；
  - `src/render/card.css`：`.genui-section` 移除默认四周封闭边框、圆角与固定内边距盒子样式，改为由区域标题（14px semi-bold）、上下留白（8px/12px）与非首项轻量顶部分隔线（`border-top: 1px solid var(--genui-color-border-subtle)`）分组；嵌套首项在列内自然紧凑对齐；
  - `.genui-columns-container` 声明 `container-type: inline-size`，`.genui-columns` 默认单列（窄屏/移动优先），通过 `@container (min-width: 38rem)` 恢复 2 列并列，`@container (min-width: 58rem)`（并校准 57.5rem 兼容扣除内边距后的 926px 可用宽度）恢复 3 列并列；移除原末尾基于浏览器视口的 `@media (max-width: 560px)` 规则，嵌套 `columns` 依托各自外层容器独立适配；
  - 核心容器全部声明 `min-width: 0` 与长文本/单位自动换行，防止在长中文标签（120 字）、长数值、20 字符单位及 200% 缩放下发生整卡水平溢出；
  - 提示词升级至 v3.1：补充 `section`（标题留白逻辑分组、避免无意义嵌套）与 `columns`（按卡片可用宽度自适应切换，推荐参数与核心结果并列对照，图表、表格与依据按层级排在下方，关键说明直接可见）组合原则；优化末尾月度预算速算示例为并列结构；同步更新 `docs/prompt.md` 与 `docs/examples/preference-v5.json` 等示例。
- 建立 GenUI 基础语义变量层（#11 所需公共层，本轮只完成变量与现有样式替换，不宣称 #11 完成）：在卡片根节点统一定义表面、主/次文字、边界、主色、状态、间距、圆角与排版角色，亮暗值均由 `data-site-theme` 切换；品牌蓝统一为 `#4d6bfe`（暗色 `#7c9aff`），移除旧 `#3988ff`，并删除重复的暗色覆盖块。默认间距采用 4/8/12/16/24px，圆角 6/8/12px，文字对比度按 4.5:1 选择。组件级全量替换、对比度矩阵、主题切换状态保持与独立 360/560/720 验收仍归 #11。
- 卡片排版层级与主结果强调（issue #12）：建立标题 16px、区域标题与正文 14px、标签/辅助文字 12–13px、主要结果 20px 的排版角色，用字号、字重、位置、留白和附加蓝线区分主次，不依赖颜色；长标签与数值可换行，数字使用等宽数字。v3–v5 的 `value` 新增可选 `emphasis: "normal" | "primary"`，省略即普通，仅文档顺序中前两个显式 primary 突出显示，超出的 primary 仍按普通结果显示，不因展示数量让整卡失败；v1/v2 字段集合保持关闭。数值与单位拆为独立排版节点但保留“数值 空格 单位”的完整文本与可访问名称，错误仍在结果位置就地显示而不是写成 0。提示词升级 v3.0，说明只给真正核心的 1–2 个结果显式写 primary，并同步预算、成本、偏好与函数示例；协议文档、生成校验器与提示词文档同步更新。
- 统一输入控件与交互状态（issue #14）：滑块改为顶行真实 label 与当前 output（`for` 指向 range），range 独占下一行，两者与 #13 的 `.genui-slider-row` 布局契约合并；移除 range 上重复的 `aria-label`，output 设 `aria-live="off"` 避免重复。Chromium 会丢弃原生 range `aria-valuetext` 中的单位，单位改由隐藏说明进入 `aria-describedby`，错误时与就地错误并列。数字输入把单位移到输入框后的后缀，`aria-describedby` 同时关联单位与错误；输入法合成期间只回显草稿，合成结束后再校验、提交和显示错误。select 保持原生元素与 label/htmlFor。number/select/slider 统一 36px 最小高度，触屏环境 44px，复用 D01 变量控制边界、背景、圆角、悬停、焦点、无效和禁用状态；控件边界以 55% 文字色混合，亮暗均达到 3:1，无效状态同时使用文字、边界与浅底色，单位与数值使用等宽数字，长标签和长单位允许换行，超长单位可换到输入框下一行。过渡只作用于颜色/边界并在减少动态效果偏好下关闭；不引入自定义下拉、Portal、新组件库或新依赖，草稿、已提交值、步长校验与重置语义不变。
- 站点适配与本地诊断（issue #9）：新增 `src/content/site-adapter.ts`，统一回答容器、`genui` 候选、输入框、生成状态、会话路由与账号/消息身份，渲染、状态与计算不再直接依赖站点选择器；`findGenuiBlocks`、`findChatInput`、`isGenerationActive` 保留兼容签名，找不到确定输入框时返回 `null` 而不猜测其他文本框。新增 `src/runtime/diagnostics.ts`（`genui-diagnostics/v1`），按识别、等待完整内容、协议、挂载四类记录固定代码、次数与首次/最近时间，并附适配器探针的计数与布尔值；浮标新增「本地诊断」面板，可预览、刷新、复制或由用户主动下载 JSON，导出不含聊天文本、草稿、账号或会话 id，仅页面内存、不上传、不新增权限。补充类名轮换、空 `pre` 延迟补齐、孤立带标签代码块三个变体样本，以及输入框歧义、路由复用、适配器注入等 39 项单测；侧栏承载形成评审稿 [docs/side-panel-evaluation.md](docs/side-panel-evaluation.md)，本轮只评审不实施。
- 候选表支持 `selectable`：用户在表格中筛选、排序并选中一行后，点击「继续讨论」会先展示一份可修改的摘要，包含已提交参数、筛选条件、排序依据、选中项与对比候选、主要差异和未提交的输入草稿；摘要来自点击瞬间的同一份状态快照，确认后才填入输入框并保留已有草稿，不自动发送。提供「解释当前结果」「讨论选中方案」「比较两个方案」三个入口，无选中、无对比、无候选、计算失败和超出摘要长度时都有确定行为。提示词在 v2.5 基础上升级到 v2.6，补充候选表可开启 `selectable` 的说明，不改协议能力与上限。
- 协议 v5 新增本地语义模型 `models`（预算、成本、偏好，1–4 个）：模型按声明顺序计算，输入表达式可读 state/derived 与更早模型标量；金额按精度转整数最小单位处理，缺失资料不按 0。元素新增模型来源的 `value`、`table`、柱/饼 `chart` 与本地 `explain` 依据；参数、数值、图表、表格共享同一 `ModelResult` 快照。覆盖零预算、超支、零周期、零次数、并列、空候选、缺失值与权重 0 等边界；偏好 `weight` 与筛选阈值可写数字或表达式，单模型失败只影响自身。新增 `budget-v5.json`、`preference-v5.json`、`cost-v5.json` 示例与 [阶段 9 真实模型对比](docs/phase9-model-comparison.md)，附最终版本 2 份可复跑样本及 `model-samples.test.ts`；提示词升级 v2.5（补充固定标量键、允许筛选阈值直接写数字常量与模型来源的可选 `kind:"model"` 标记），协议文档新增 v5 章节，校验器由 Schema 重新生成。
- 折线图新增函数曲线系列（协议 v4）：`series` 可写 `{"label","color"?,"function":{"expression","domain"?,"samples"?,"features"?}}`，表达式只允许局部 `x` 变量与 state/derived 引用，公式只声明一次；状态变化时本地按有上限采样数（默认 41，5–50，文档内采样总数 200 且跨图表累计，每系列独立 5000 次运算预算）重采样重绘。`features:["zero"]` 在视口内不过零点时对称加倍扩展采样范围（最多 4 轮；仅当扩展后更接近零点时保留，无实根/相切零点会撤销扩展、视口不持续放大），扩展后仍未找到零点时显示局部提示；domain 求值失败（如 `a=0` 的对称轴除零）时静默回退默认区间 `-10…10`，曲线退化为直线不报除零。坐标轴在数据零点可见时画在 `x=0`/`y=0`，否则保持绘图区边缘（v3/v4 折线图通用）；离散点折线语义与旧行为不变。提示词升级 v2.3，示例新增 `docs/examples/parabola-v4.json`，协议/运行时/渲染/示例新增回归用例，校验器由 Schema 重新生成。
- 卡片交互状态改为独立于 React 组件生命周期保存：参数、表格筛选与排序在生成新回答、同一文档的节点替换或重新挂载后保持；新回答流式生成期间不再全局卸载未变化的历史卡片，只等待/处理正在变化的回答。身份按「账号作用域 + 会话路由 + 消息键（`data-virtual-list-item-key` > `data-message-id` > 文本指纹）+ 同文档重复序号 + 原始原文哈希」计算，不按标题或 DOM 顺序匹配；原文被改写时更换身份并清除旧状态，身份不可靠时退化为元素级一次性键，只做页面内恢复。新增 `src/runtime/card-state.ts`、`src/runtime/card-state-store.ts`、`src/content/identity.ts`。
- 新增 GenUI 失败恢复路径：解析或校验失败时保留原始回答与代码块，并在块后显示状态面板，区分等待完整内容、验证中、离屏尚未补齐、需要修复与页面暂不兼容；失败说明只保留最相关的错误路径、原因与期望格式，可展开查看原始内容。确认失败后提供「生成修复请求」，只把本次失败界面的限定片段与诊断写入可见聊天草稿或复制到剪贴板，保留已有草稿、重复点击不重复追加、绝不自动发送；内容修复为合法格式后同一代码块可重新挂载卡片。语义错误（状态范围、引用、循环依赖等）定位到具体字段；长 JSON 的修复片段覆盖解析失败位置；无输入框且自动复制失败时可在面板内展开并手动复制完整修复请求；纯空白草稿也逐字保留；生成期间只撤下当前回复的卡片，历史回答保持挂载。严格 Schema 校验与不执行生成代码的边界不变。新增 20 项单测与排序字段错误的 Edge/Chrome 端到端用例，累计 27 个测试文件、278 项单测通过。
- 输入框浮标新增「本轮」循环按钮（自动适配 / 明确生成工具 / 普通回答），只影响当前这一轮草稿的增强说明：默认自动适配保持 v2.6 文本逐字节不变；「明确生成工具」仅在首段表达策略上改为本轮优先生成界面的显式意图（协议主体与默认文本逐字节共享，能力说明、版本与预算完全一致）；「普通回答」移除本轮追加内容并恢复原文。模式不持久化：发送、清空草稿、重开会话或开关增强后回到自动适配；说明仍在草稿末尾且逐字未改时切换模式会原地整段替换或移除说明（连同分隔空行），改过说明时如实提示且不自动覆盖，手动删除过说明的草稿不会被自动恢复。说明面板的逐字内容随当前模式显示，见 docs/issue7-baseline-tasks.md 的真实模型对照设计与回退策略（本项未跑真实模型对照，不预置成功率结论）。
- 卡片支持用户主动保存当前界面（issue #2 收尾）：底部新增「保存当前界面 / 更新已保存的设置」与「清除保存」，只有点击时才把该卡片的参数、表格筛选、排序与选中项写入 `chrome.storage.local`（键前缀 `genuiSavedState:`，单条不超过 32 KB、最多 50 条、按保存时间淘汰）。刷新后同一文档自动恢复，并在卡片顶部显示「已恢复 MM-DD HH:mm 保存的设置；之后的调整不会自动保存」；恢复需通过状态版本、原文哈希与状态结构签名校验，刷新后消息键变化时仅在「同一账号/会话内该文档唯一且匹配记录唯一」时回退匹配，身份有歧义则拒绝保存并给出说明。保存失败会回滚内存副本，清除保存不改变当前界面值。新增 `src/runtime/saved-card-state-store.ts`，并在 [docs/state-storage.md](docs/state-storage.md) 记录两层存储、恢复优先级与零串值规则。

- 增加自动打包与 Release 草稿工作流：推送到 `main` 可下载 ZIP/SHA256；用户手动运行并填写最终插件版本号后，检查、构建及 Edge/Chrome 默认测试通过才创建附带安装包的 Release 草稿，正式发布由用户点击 Publish release 决定。新增版本同步脚本、PowerShell 打包脚本和发布指南，校验安装包与标签版本一致性并保留历史 Release；草稿自动带入 CHANGELOG 的中文分类更新说明，附 GitHub 变更记录。

### Fixed

- 修复 SPA 切换会话时已挂载卡片可能沿用旧会话状态键的问题：协调器在清理已挂载卡片前按当前账号/会话重算身份，身份变化即撤下并按新身份重挂，旧状态保留在内存供切回恢复；适配器新增 `readNavigationKey`，控制器通过 `popstate`、`hashchange` 与轮询发现路由/会话变化。新增“复用同一节点、仅路由变化”回归。
- 修复输入框存在多个匹配时仍猜测写入的问题：候选合并 `name="search"` 与 placeholder 两路并去重，排除隐藏、禁用、只读与不可见项，只有恰好一个可用候选时才写入，否则视为无输入框；探针新增 `inputCandidates`，多候选记录 `detection/input-ambiguous` 而不是静默成功。
- 修复注入适配器后输入路径仍走默认规则的问题：草稿增强器、继续讨论与修复请求全部接受并传递适配器，控制器默认回调改用选定适配器，`findChatInput` 的所有内部调用同步更新；诊断 `inputFound` 与实际写入行为一致。
- 修复正常启动时输入框识别失败不进入诊断的问题：启用且处于聊天路由时，启动探针找不到唯一输入框即记录；继续讨论 `no-input`、修复请求 `copied`/`copy-failed` 以及增强器 `no-input` 状态也接入记录，不再依赖先关闭再开启才能触发。
- 修复「继续讨论」摘要的六处一致性问题：被 `visibleIf` 隐藏的表格不再进入摘要，旧选中项也不会被当成当前选择；单元格缺失或无法计算时不再宣称两方案「相同」，而是标注资料不足或「未参与比较」；长摘要改为优先保留结尾请求、筛选与已选项，参数过多才标注省略；表格可见行超过两行时可在工具栏显式指定第二对比项，被筛选隐藏或已不存在的对比项如实提示而不换行冒充；用户编辑预览后切换讨论意图只替换结尾请求并保留手改；纯空白草稿也逐字保留，只追加摘要。补 6 项单测与 2 项浏览器流程断言，`npm run check`、290 项单测与默认 e2e（22 passed、6 skipped）通过。
- 修复 issue #4 复核发现的 v5 语义模型问题：成本购买份数对十进制浮点除法加入相对容差，避免 `0.07 / 0.01` 被多算一份；`cost-v5.json` 的按次方案改用 `4 元 × 每月次数` 并按实际次数累计；偏好维度 `weight` 支持数字或表达式，可由滑块等状态驱动，运行时按 0–1000 截断并在权重合计为 0 时给出诊断；提示词移除 derived 可引用模型的错误说明，与校验器保持一致；预算明细改用与合计相同的 precision 舍入值；每个 v5 模型使用独立的 5000 次运算预算，超限只影响该模型。补充对应协议、运行时、示例与提示词回归测试。
- 修复继续提问或新回答生成时历史卡片被全局卸载导致已调整参数丢失的问题：页面生命周期在生成活跃时只清理已失效/已改写的卡片，不再调用 `suspendMounted()` 卸载全部历史卡片；`enhance.ts` 仅在原始文本变化时丢弃对应状态，节点移除或虚拟列表回收保留状态供同身份恢复。
- 修复卡片身份可能串用的问题：同一消息内出现完全相同的文档、两条消息共用同一消息键，或消息只有文本指纹时，不再生成共享状态键，改为按 DOM 元素分配一次性键；元素一旦被判为歧义会保持该键，避免重复卡消失后键回退导致状态丢失。多会话、多消息与相同标题的卡片因此不会互相继承参数。
- 本轮模式切换只在说明逐字完整存在于草稿末尾时整段替换或移除（含分隔空行），编辑过说明后切换时如实提示（`edited` 状态、普通回答残留说明），移除说明时保留光标与选区，不再假设草稿总等于最近一次写入值。
- 默认增强提示词升级到 v2.2：正文与交互界面共同完成回答，明确结论、解释与详细表格、动态结果的内容分工，移除要求正文单独完整作答后再附界面的指令，减少大范围重复；保留必要解释、来源与假设，标明正文引用的结果仅对应初始条件。此为生成引导修订，实际重复程度仍需真实模型复测。
- 修复二次函数图像由稀疏采样点直线连接而出现折角的问题：折线图系列新增可选 `smooth: true`，通过经过采样点的三次插值绘制连续函数；默认折线和数据表保持原有行为。默认增强提示词升级到 v2.1，并为函数图像明确说明平滑标记。
- 修复窄视口下「查看增强说明」面板超出屏幕的问题：限制浮标宽度上限、允许面板在按钮列旁收缩，并在拖动后打开面板时按新尺寸重新夹取位置。

### Removed

- 移除 issue8 的来源/依据（`sources`/`basis`）与协议 v6：删除依据面板、来源列表、控件/表格/图表徽标、用户修改与时效标记；提示词回到 v2.9 与协议 v5，旧 v6 文档按不支持版本保留原始代码块。
- 移除手动「保存方案」、`genui-plan` 方案文件导出/导入与「方案工作台」（含并排比较、方案 CSV/摘要导出与重算差异）；卡片状态改为仅页面内保持，刷新或关闭标签页回到初始值。提示词升级 v2.8，不再提导出方案。

### Validation

- issue #15 验证（2026-11-06，已实现，待发布验收）：`npm run check` 通过：48 个测试文件、589 项单测，类型检查、lint、构建与生产包校验均通过；`dist/content.js` 876380 B（876.38 kB，gzip 157.81 kB），产物 7 个文件，权限仍仅 `storage`，无 `host_permissions` 或后台脚本。新增 `action-hierarchy.test.tsx` 14 项，覆盖操作组顺序与语义、详情默认收起与展开、原始 JSON 往返不丢参数与结果、收起后页脚隐藏与重新展开保留详情状态、反馈就近且不进入详情、重置清除输入错误、打开预览后焦点进入摘要且关闭后回到触发按钮，以及主次操作与详情可发现性的样式契约。默认 Edge/Chrome e2e 30 passed、6 skipped；阶段 2/3 先展开详情再切换原始 JSON，阶段 2 以真实键盘验证 Enter/空格开合详情、Tab 进入原始 JSON 入口、收起后入口隐藏，以及打开继续讨论后焦点进入摘要、下一次 Tab 落到“填入输入框”而非“重置”，阶段 6 断言页脚层级与收起行为，阶段 15 在 960/360px 下断言操作组首项与详情展开态保持。本轮未对详情展开态做截图比对，也未在真实页面与屏幕阅读器上人工走查。
- issue #13 验证（2026-11-06）：`npm run check` 通过：46 个测试文件、567 项单测通过（3 项按既有条件跳过，共 570 项），类型检查、lint、构建与生产包校验均通过；`dist/content.js` 870563 B（870.56 kB，gzip 156.77 kB），产物 7 个文件，权限仍仅 `storage`，无 `host_permissions` 或后台脚本。新增 `tests/unit/grouping-layout.test.tsx` 9 项单测，更新 `prompt.test.ts` 与 `card-visual-tokens.test.ts`，覆盖局部容器查询与断点规则检查、去框线顶部分隔与首项紧凑规则、各级容器 min-width: 0 防溢出声明、标题层级与 DOM/键盘阅读顺序一致性、宽窄容器切换下输入控件/未提交草稿/表格筛选/排序/详情折叠的无重建状态保持、嵌套布局下前两个 primary 收集与原始 JSON / 展开收起切换；在真实 Edge 与 Chrome 中通过 Playwright 端到端测试（新增 `阶段 15`，全套 28 项通过、6 项真实站点跳过），验证 360px、560px、720px、960px 宽度及亮/暗主题下的单列/双列/三列与嵌套自适应布局，以及长中文标签（60–120 字符）、长数值、长单位和 200% 等效缩放下的无卡片级溢出。
- issue #14 验证（2026-11-06，已发布并验收，PR #17）：`npm run check` 通过：47 个测试文件、575 项单测，类型检查、lint、构建与生产包校验均通过；`dist/content.js` 875049 B（875.05 kB，gzip 157.56 kB），产物 7 个文件，权限仍仅 `storage`，无 `host_permissions` 或后台脚本。`control-presentation.test.tsx` 5 项覆盖滑块标签/当前值同排、range 独占行与 `.genui-slider-row` 契约、output 关联与 `aria-live`、单位/错误 describedby 共存、原生 select 同步、20 字符单位及输入法合成期间只回显草稿。默认 Edge/Chrome e2e 30 passed、6 skipped（真实 origin 用例按默认跳过）。新增「阶段 4 补充」在两种浏览器验证 Arrow/PageUp/PageDown/Home/End、滑块焦点保持、数字键盘步进、select 键盘选择、无障碍树中的滑块 `单位：元` 与数字长单位描述、`pointer: coarse` 下 44px 目标、360px 下长单位换行/输入宽度/无卡片横向溢出，并按计算样式断言亮色边界 3.57:1、焦点 4.01:1、错误 4.73:1，暗色 4.82:1、5.65:1、7.38:1。Edge 中检查 720 宽亮色、360 宽暗色、错误/焦点态及 20 字符单位，无卡片级横向溢出。#13 的 `.genui-slider-row` 布局契约已在合并后的 main 上复跑，阶段 15 在 Edge/Chrome 均通过。本轮未运行真实屏幕阅读器与真实输入法（合成事件模拟）。
- issue #12 验证（2026-11-05）：`npm run check` 通过：45 个测试文件、551 项单测，类型检查、lint、构建与生产包校验均通过；`dist/content.js` 868794 B（868.79 kB，gzip 156.42 kB），产物 7 个文件，权限仍仅 `storage`，无 `host_permissions` 或后台脚本。新增 `value-emphasis.test.tsx` 13 项与 `card-visual-tokens.test.ts` 2 项单测，覆盖 v1/v2 拒绝字段、v3–v5（含 v5 模型值）接受与未知枚举拒绝、嵌套布局前两个 primary、0/1/2 个 primary、负值/小数/大数、20 字符单位、120 字符长标签、单位拆分与可访问名称、除零错误不写成 0、强调不改变求值/计算依据/继续讨论摘要，以及基础语义变量与暗色覆盖唯一性。并在 Edge 中检查预算、选购比较、函数学习、成本、偏好和长标签/长单位样例的亮色、暗色与 360/560/720 宽度；360px 下无卡片级横向溢出，选购表保留内部横向滚动，长标签与 20 字符单位正常换行；200% 页面缩放以 360px 等效回流宽度验证。本轮未重跑真实页面 e2e，也未运行真实屏幕阅读器。
- `npm run check` 通过：41 个测试文件、497 项单测，类型检查、lint、构建与生产包校验均通过；`dist/content.js` 855349 B（855.35 kB，gzip 152.49 kB），产物 7 个文件，权限仍仅 `storage`，无 `host_permissions` 或后台脚本。
- 默认 Edge/Chrome e2e：24 passed、6 skipped（真实 origin 用例按默认跳过）。流式用例断言未变化的历史卡片保持挂载、仅被改写的卡片卸载；真实 DeepSeek 页面虚拟列表键稳定性与真实模型生成本轮未重跑。
- issue #2 收尾验证（2026-11-05）：`npm run check` 通过：43 个测试文件、532 项单测（3 项按既有条件跳过），类型检查、lint、构建与生产包校验均通过；`dist/content.js` 863869 B（863.86 kB，gzip 155.17 kB），产物 7 个文件，权限仍仅 `storage`，无 `host_permissions` 或后台脚本。本轮新增 38 项单测：`card-state.test.ts` 14、`saved-card-state-store.test.ts` 11、enhance 保存/恢复 6、card 保存入口 6、controller 首扫前预载 1。
- 默认 Edge/Chrome e2e（2026-11-05）：26 passed、6 skipped（真实 origin 用例按默认跳过）；新增「阶段 14 · 主动保存后刷新恢复与清除（模拟页）」在 Edge 与 Chrome 各执行一次，覆盖保存提示、刷新后恢复滑块值与来源提示、清除后刷新回到初始值。真实 DeepSeek 页面的人工走查仍待补。

## 0.1.1（2026-11-03，本地分发包）

### Changed

- README 顶部接入已定稿的交互节点 Logo，提供明暗背景版本；扩展管理图标、DeepSeek 页面开关和交互卡片也已使用对应图形；改为以功能、使用场景、操作步骤与安装为主的产品介绍，开发和分层验收记录保留在文档中。
- 项目版本统一升级为 0.1.1：同步 package.json、根锁文件版本、扩展清单、内容脚本构建标记、当前隐私说明与发布包；历史验收保留实际测试时的版本与结果。
- 0.1.1 安装包与 SHA256 校验文件通过 GitHub Releases 分发，README 下载入口指向版本发布页。

### Validation

- `npm run check` 通过：25 个测试文件、253 项单测，类型检查、lint、构建与生产包校验均通过。产物含 7 个文件，`content.js` 441598 B、`manifest.json` 641 B。
- 默认 Edge/Chrome e2e：18 passed、6 skipped。未在本轮重跑真实 origin 或真实模型会话。
- 新发布包 `release/deepseek-genui-v0.1.1.zip`（107040 B）与 `dist/` 逐文件 SHA256 一致；完整校验值见 `release/deepseek-genui-v0.1.1.sha256` 与分层报告。商店尚未提交。

## 0.1.0（2026-11-03，发布准备完成；Edge Add-ons 商店提交未执行）

### Fixed

- 阶段 7 真实验收后落地两项缓解：①**视口门控**——站点对离屏代码块延迟渲染，文本补齐前只有短前缀，扩展曾按 invalid-json/missing-pre 误标 `data-genui-state="failed"`；新增 `src/content/viewport-gate.ts`（IntersectionObserver 首见相交解锁、threshold 0、dispose 可清理）与 `EnhanceOptions.isBlockUnverifiable` 失败出口：块进入视口前不写失败状态、不记失败签名，控制台输出 `[dsgenui] block deferred (offscreen)`，解锁后按正常规则判定；文本完整有效的离屏块不受门控影响仍提前挂载。仅在生产入口 `index.ts` 经 `PageLifecycleOptions.enableViewportGate` 开启，单测与 Playwright 模拟页保持旧行为；`EnhanceResult` 三字段形状不变。②**版本对账标记**——lifecycle.ts 新增 `data-genui-version` 属性与 `resolveContentVersion()`（vite define 注入 `__DSGENUI_VERSION__`，`vite.config.ts` 定义；无构建环境回退 `0.0.0-dev`），配合既有 `data-genui-ext-loaded` 可在真实页面区分「扩展未重载」与「脚本未注入」；新增 `docs/browser-skill-runbook.md` 收录 browser-skill 验收操作纪律（sync 先行、observation 单次消费、Shadow DOM 读取、滚动读卡时序与 edge:// 重载 request-help 交接）。新增 viewport-gate 单测 11 项、lifecycle 版本标记单测 3 项，全套 25 个测试文件 253 项单测通过，`npm run check`（typecheck、lint、构建 `dist/content.js` 440.92 kB / gzip 102.71 kB 与 dist 校验）通过；更新 phase7-acceptance.md 限制 2 与 README 目录说明。
- 阶段 7 收尾修复三项 P2：①说明被分多次删除时，首次改动即记录 `dismissed`，即使起始标记尚在，删掉剩余标记后也不会重新追加；②待执行追加绑定调度时的输入框、草稿内容与草稿记录，执行前核对，切换会话（替换 textarea 或复用节点恢复另一份草稿）不会写入新草稿；③提示词与正式文档明确只有 `state`、`derived` 可为空，`elements` 至少 1 个元素，与 v3 Schema 对齐。新增 3 项 P2 回归单测；叠加视口门控与版本标记单测后，全套 25 个测试文件 253 项单测与 18 通过/6 跳过 e2e 均通过。
- 阶段 7 真实生成验收修复场景 2 的提示词缺口：v1 未说明表格 `initialSort` 的准确形状，真实模型写成 `{"key":"price","direction":"asc"}`，被 Schema 以缺少 `dir` / 多出 `direction` 拒绝，卡片未挂载。v2 明确写作 `{"key":"列key","dir":"asc|desc"}` 并声明不得使用 `direction`，同一场景重跑通过；同步更新提示词测试、e2e v2 标记与验收记录，未放宽协议接受非标准字段。
- 阶段 6 复核修复四项 P2：①「继续讨论」追加摘要不再裁剪草稿末尾空白——原草稿逐字节保留，草稿以换行结尾时另起一行、否则补空行分隔，不改变换行与 Markdown 结构；②移除「页面最后一个 textarea」回退——输入框只认 `name="search"` 或 placeholder「给 DeepSeek 发送消息」两个确定标记，无标记时如实返回 `no-input` 并不写入，避免把摘要追加进反馈框等无关控件；③真实 origin e2e 请求断言修正归因口径——按请求 URL 只能证明无 `chrome-extension://` 起源请求，无法区分「内容脚本发起的 https 请求」与站点请求（Playwright 未暴露可信 initiator），内容脚本不发起网络请求改由新增的 src 源码静态不变量单测声明（零网络 API 引用，tests/unit/extension-static.test.ts），断言注释与文档同步收紧措辞；④README/CHANGELOG 对「`REAL_SITE=1` 覆盖 v3 与阶段 6」的高估已修正——v3 组合与阶段 6 用例在真实 origin 模式下按用例设计跳过，仅以模拟页验证。修复后重跑：21 个测试文件 216 项单测、`npm run check`、默认 e2e 与 `REAL_SITE=1` 均通过。
- 修复组合界面收尾审查发现的三处缺陷：表格单元格改用自有属性读取，列 key 为 `constructor` 等名称且行缺少该值时显示 `—`，筛选不再触发原型属性异常；卡片重置递增 `resetToken` 强制重新挂载表格，清空筛选并恢复 `initialSort`；饼图占比只对实际绘制的正值计算，负值/零值在图例与数据表中显示 `—` 而非负占比。补 3 项回归单测，`npm run check` 通过（17 个测试文件 178 项单测，`dist/content.js` 418.81 kB / gzip 95.11 kB）。
- 阶段 5 收尾重跑完整检查与默认 E2E，修正阶段 4 P2 回归用例中已过期的断言：`1e12` 仍是合法输入，但派生 `1e12+1` 超出严格计算上限，应显示局部 `[role=status]`「结果超出可计算范围」且不生成派生输出；修正后 Edge/Chrome 均通过。`npm run check` 通过（17 个测试文件、175 项单测、typecheck、lint、构建与 dist 校验），默认 e2e 为 14 passed、6 skipped。
- 修复阶段 4 收尾审查问题及两项原 P2：`Card.tsx` 对 ID 状态、草稿、字段错误及派生结果改用自有属性读取，继续支持 `constructor`、`toString` 等合法 ID；将协议与交互输入的步长判断统一到 `isStepAligned`，以不随步数增长的 ULP 容差拒绝大范围中的半步值。恢复计算上限对未舍入数值的严格检查，`toPrecision(12)` 仅用于显示，`1e12+1` 即使显示时会舍入为 `1e12` 也会产生局部计算错误；对应运行时单测已调整；后续独立复核补跑 `npx vitest run tests/unit/runtime.test.ts`，6 项通过，`git diff --check` 通过；阶段 5 收尾时已重跑完整 `npm run check`（175 单测）与默认 E2E（14 通过、6 跳过），均通过。此前修复版本的定向回归为 6 failed、25 passed；随后 `npx vitest run` 为 136 passed，`npm run check` 全部通过，默认 `npm run test:e2e` 为 12 passed、6 skipped，`git diff --check` 通过。未运行 `REAL_SITE=1`（此前按要求验证默认本地模拟页，无需访问真实会话或发送消息）。已知限制：步长远小于数值量级的双精度 ULP 时（例如 `1e12` 附近 `step=1e-6`），半步偏移无法判别。

### Added

- 完成阶段 8 完整验证与发布准备（2026-11-03）：复跑 `npm run check`（25 个测试文件 253 项单测、typecheck、lint、构建与 dist 校验；`dist/content.js` 440928 B / gzip 102.71 kB，权限仅 `storage`）；默认 e2e（Edge/Chrome 模拟页 18 通过、6 设计性跳过）与 `REAL_SITE=1`（Edge/Chrome 真实 origin 合成回复 DOM 8 通过、16 设计性跳过：阶段 2 合成结构、阶段 3 生命周期回退、阶段 4 本地计算各双通道通过），并记录浏览器版本 Edge 156.0.4314.58、Chrome 156.0.8078.79。新增 [docs/phase8-verification.md](docs/phase8-verification.md) 分层验证报告（已实现/已通过/真实环境未验证/已知限制/后续能力）、[docs/privacy.md](docs/privacy.md) 隐私说明（对应 Edge 政策 1.5.2）与 [docs/store-submission.md](docs/store-submission.md)（按官方《Developer policies》2026-07-24 版逐条复核用途/描述/隐私/权限/审核测试步骤，无阻断项；含上架素材、上架前清单与审核测试步骤；商店提交未执行，发布准备≠已上架）。生成发布包 `release/deepseek-genui-v0.1.0.zip`（扁平 `manifest.json`+`content.js`，SHA256 见 phase8-verification）。如实说明恢复行为：原始 `genui` JSON 代码块永久保留、卡片从它重新挂载、交互状态回到初始值（单卡内存不持久化）；「重新打开历史会话」未在真实页面单独立项人工验证，如实列为真实环境未验证项。README 补卸载步骤与阶段 8 口径。
- 完成阶段 7 默认增强与真实生成验收：新增 `src/content/prompt.ts`（提示词 v2，显式说明协议、组件、绑定、运算与示例，表格 `initialSort` 要求 `{key,dir}` 且禁止 `direction`）、`src/content/augment.ts`（700ms 停止输入后向非空草稿逐字追加可见说明；不自动发送、不使用隐藏消息；关闭时仅移除完整尾部追加并保留用户原文/修改；手动删除后本草稿不再追加；等待追加期间切换会话不会写入新草稿）、`src/content/toggle.ts` 的「查看增强说明」面板（逐字展示实际注入内容、版本、状态和关闭行为），并在 `controller.ts`/`index.ts` 接线。新增 prompt/augment/controller-augment/protocol-v3 单测与阶段 7 模拟页 e2e；真实 DeepSeek 网页完成二次函数抛物线、5000 元笔记本选购、每月预算三场景，健身房会员卡同类新问题与水的沸点普通问答。验收记录见 [docs/phase7-acceptance.md](docs/phase7-acceptance.md)，正式提示词见 [docs/prompt.md](docs/prompt.md)。`npm run check` 通过（25 个测试文件 253 项单测、构建 `dist/content.js` 440928 B、权限仅 `storage`、无 host_permissions/后台），默认 e2e 18 通过、6 跳过；已记录离屏代码块延迟渲染与流式不完整 JSON 的瞬时现象，以及真实页面未做 URL 级网络抓包的归因局限。
- 完成阶段 6 完整操作体验与继续讨论：新增站点主题跟随 `src/render/theme.ts`（按取证优先级 `data-ds-dark-theme` > body class > documentElement class > `prefers-color-scheme` > light，MutationObserver + matchMedia 监听仅在变化时回调，`data-site-theme` 写入卡片根与增强开关并保持同步，card.css 增加暗色变量组并保留媒体查询回退）；Card 头部新增可键盘操作的展开/收起按钮（`aria-expanded`/`aria-controls`，主体与脚注显隐、React 树不卸载，状态/草稿/错误/重置计数保留，重置不影响展开，v1 亦支持）；新增继续讨论（Card 脚注 v2/v3 按钮 → `src/render/summarize.ts` 生成带标题、状态行与派生行的当前摘要，状态缺失与派生失败如实标注且不带失败数值 → `src/content/followup.ts` 回填输入框：只认 `textarea[name="search"]` 或 placeholder「给 DeepSeek 发送消息」两个确定标记，无标记时返回 `no-input` 不猜测其他 textarea，输入框为空直接填入，已有草稿则逐字节保留原文后追加摘要并去重，原生 value setter + 冒泡 input 事件兼容受控组件，反馈文案以 `role=status` 明确「发送由你完成」），未接线时显示不可用反馈并接受 onContinue 注入（`EnhanceOptions`/`MountCardOptions` 透传，生产入口在 `src/content/index.ts` 接线）。新增单测 38 项（theme/summarize/followup/Card/enhance 与复核修复，累计 216 项）与 e2e「阶段 6」（模拟页双通道主题标记同步、收起保留滑块值与派生输出、filled/appended/去重、v1 无入口、草稿逐字节保留）。`npm run check` 通过（typecheck、lint、216 单测、build + dist 校验，`dist/content.js` 425.99 kB / gzip 96.95 kB），默认 e2e 16 passed、6 skipped，`REAL_SITE=1` 8 passed、0 failed（真实 origin 口径仅覆盖阶段 1–4 用例，v3 与阶段 6 设计为模拟页运行）。真实 origin 站点遥测（`gator.volces.com`）出现在交互窗口时不归因扩展，该用例请求断言仅禁止 `chrome-extension://` 起源并记录站点请求，归因局限与补偿的静态不变量单测见 Fixed 记录；模拟页保持零请求断言；Edge/Chrome 功能断言无差异，站点遥测出现时序不同属于站点行为差异。未做真实模型生成与人工浏览器验收（归阶段 7–8）。
- 完成阶段 5 组合界面与三个产品场景的本地实现：protocol v3 新增 `note`、`section`、`columns`、`chart`（bar/line/pie）和 `table`，新增 `state-eq/neq`、`num-*`、`and/or/not` 条件与 `visibleIf`；图表/表格复用白名单表达式，新增 v3 元素/嵌套/图表/表格/条件/表达式预算和本地 `#RRGGBB` 颜色约束，校验器由 Schema 重新生成。
- 新增组合渲染与统一求值：`evaluateComposite` 每次更新生成派生、图表/表格表达式与条件的单一快照；柱状/折线/饼图含标题、图例与「查看数据」，表格支持列定义、排序、筛选、横向滚动、条件行、空状态和计数，说明/分区/多列布局与 Card、控件、重置和错误边界组合；三场景示例见 [docs/examples/parabola-v3.json](docs/examples/parabola-v3.json)、[shopping-comparison-v3.json](docs/examples/shopping-comparison-v3.json)、[budget-v3.json](docs/examples/budget-v3.json)。
- 新增 36 项 v3 协议/运行时/渲染/示例测试及 3 项三场景示例交互测试（合计 175 项单测；收尾修复另补 3 项回归，最终 178 项），新增 v3 组合卡片 e2e；同步重写协议说明、提示词草案与产品规格状态。默认 e2e 14 passed、6 skipped；`dist/content.js` 418.81 kB（gzip 95.11 kB），权限仅 `storage`。未运行 `REAL_SITE=1`，未做真实模型或人工浏览器验收。
- 记录 2026-11-01 已确认的 MVP 产品方向，覆盖学习演示、比较决策及计算规划。
- 修订开发任务，将组合式交互界面、即时反馈、默认增强与三个验收场景纳入范围。
- 新增开发指南，收录 Edge 官方资料、Manifest V3、API、权限、本地测试与商店规范，并区分官方要求与项目约束。
- 完成阶段 0 环境、官方规范与真实网页调查，新增 docs/compatibility-investigation.md，记录 Edge 156 上 chat.deepseek.com 的真实 DOM 结构、生命周期、草稿行为、主题切换入口、权限草案；补充取证停止生成按钮（流式中发送位切换为 ■ 停止图标，tooltip「停止生成」，点击截断生成）、`genui` 语言标记代码块渲染（识别边界与原规格一致）、协议提示经可见草稿与用户显式发送透明带入对话的可行路径；最小 genui JSON 输出按单次样本成功记录，未作稳定性结论；勾选阶段 0 全部待办。扩展功能尚未实现或验证。
- 完成阶段 1 工程初始化与最小扩展：引入并以 `--save-exact` 锁定 TypeScript 6.0.3、React 19.3.1、Vite 8.3.5、Ajv 8.20.0 + ajv-formats 3.0.1、Vitest 5.0.5、Playwright 1.64.1、ESLint 10.14.0 等依赖（已生成 package-lock.json 锁定全部版本；该文件与其余阶段 1 产物已提交 git）；新增 tsconfig、flat eslint 配置、vite/playwright 配置与 `typecheck/lint/test/test:e2e/build/check` 命令；新增 MV3 `public/manifest.json`（content_scripts 仅匹配 `https://chat.deepseek.com/*`，**零 permissions/host_permissions、无后台**——按用户决议 storage 等阶段 3 实现开关时再按调用申请）与内容脚本 `src/content/{lifecycle.ts,index.ts}`（幂等注入 `data-genui-ext-loaded` 标记，本阶段无 GenUI 功能）；新增 `scripts/check-dist.mjs` 生产包静态校验（权限/匹配范围/版本一致性 + 扫描 eval/new Function/importScripts/远程脚本 URL/CDN，违规即构建失败，负向测试通过）；新增 11 个单测与 Edge/Chrome 扩展加载 e2e（默认本地模拟页面，`REAL_SITE=1` 走真实网页，`HEADED=1` 有头取证）；新增 README（非官方身份、命令、加载步骤、权限说明、已验证范围）。
- 阶段 1 检查结果：`npm run check` 通过（typecheck、lint、11 单测、build + dist 校验）；`npm ci` 重装后复跑 `npm run check` 与 `npm run test:e2e` 通过；e2e 在 Edge 156.0.4314.50 与 Chrome 156.0.8078.79 对模拟页面与真实 chat.deepseek.com 均注入成功，且未发现可归因于扩展的错误（归因依据脚本 URL/堆栈/`[dsgenui]` 日志前缀；无法归因的错误单列记录、不认定为网站，来源判断待阶段 2+ 补强）；权限经 manifest 静态断言为零申请、不引入后台请求。已知项：运行时依赖审计 0 漏洞，开发依赖存在 11 moderate 告警，根因为传递依赖 `minimatch <11.0.1`（DoS 公告 GHSA-g3hv-75wg-m249，经 eslint / typescript-eslint 链引用）；`npm audit fix`（非强制）无法在当前大版本内修复，强制修复需降级 eslint 大版本，未采纳，不阻塞检查。此阶段不宣称具备 GenUI 功能。
- 完成阶段 2 单个 Card 的完整呈现链路：新增带版本最小 genui 协议 v1（`src/protocol/{types,schema,validate}.ts`——`type:"genui"`/`version:1`/可选 `title`/`elements[{kind:"text",value}]`，Card Schema `additionalProperties:false`，规模限制 64 KiB/深度 16/元素 50/标题 120/文本 2000，失败码 `too-large|too-deep|invalid-json|schema-violation|unsupported-version`，守卫顺序 长度→深度→JSON.parse→结构→版本）与构建期生成的校验器（`scripts/gen-validator.ts` + `src/protocol/genui-validator.generated.ts`，`npm run gen-validator`，prebuild 自动再生成）；新增识别 `src/content/detect.ts`（按阶段 0 依据：仅 AI 回复容器 `div.ds-assistant-message-main-content` 内语言标签 `span.d813de27` 为 `genui` 的代码块，用户消息/json/python/无标签一律跳过）；新增渲染与挂载 `src/render/`（元素注册表、Card、元素级与卡片级错误边界、Shadow DOM 局部挂载、`card.css?inline` 样式隔离、未知元素类型占位、模型输出仅按纯文本渲染）；新增 `src/content/enhance.ts` 幂等增强（`data-genui-state` 标记、原块隐藏保留、查看原始 JSON 切换、解析/验证/渲染失败安全回退、渲染致命错误恢复原内容并卸载卡片）。测试新增 protocol/detect/card/enhance/generated-validator 单测与真实快照 fixture（`tests/fixtures/assistant-genui-message.html`，由阶段 0 `.tmp` 快照逐字提取、仅含合成内容），单测 11→70；e2e 扩展为完整结构模拟页（合法×2/json 标签/用户消息内/非法 JSON/普通段落）+ 阶段 2 断言 + `REAL_SITE=1` 真实网页合成结构最小案例测试。
- 阶段 2 检查结果：`npm run check` 通过（typecheck、lint、70 单测、prebuild 校验器再生成、build 25 模块 231.38 kB + dist 校验零豁免）；e2e 模拟页 4 通过/2 跳过（Edge/Chrome × 阶段 1 注入 + 阶段 2 完整链路：识别、挂载、样式隔离、查看切换、失败回退、多块独立、扩展零错误）；`REAL_SITE=1` e2e 4 通过/2 跳过（含两渠道真实网页合成结构最小案例，为合成结构验证而非站点原生 genui 输出）；dist 校验负向测试（追加远程 URL → 构建失败）通过。**关键发现与修复**：首次 e2e 全数失败——Ajv 运行时 `new Function` 编译被 MV3 内容脚本 CSP（无 `unsafe-eval`）以 `EvalError` 拒绝，init 中断、Card 零挂载，而单测（Node/jsdom 允许 eval）无法暴露；改为构建期 Ajv standalone 代码生成（`npm run gen-validator`，prebuild 自动执行），运行时零动态执行，产物逐字节一致与不含 `eval(`/`new Function(` 由单测锁定，dist 由 346.61 kB/92 模块降至 231.38 kB/25 模块，ajv/ajv-formats 移入 devDependencies。check-dist 曾为 Ajv `$id` URL 引入精确豁免，负向测试暴露「`text.match` 首个命中 + 豁免」造成同文件后续违规漏检，改为 `matchAll` 逐条扫描；Ajv 移出运行时后豁免整体移除，恢复零豁免。
- 阶段 2 真实网页人工验证通过（2026-11-02，Edge 156 真实会话）：genui 代码块原位渲染为 Card、查看原始 JSON 切换双向正常且卡片常驻、json 标签与用户消息零影响、页面其他功能正常、控制台过滤 `[dsgenui]` 无扩展错误（debug 日志需 Verbose 级别可见）；页面既有 `gator.volces.com` 的 `ERR_BLOCKED_BY_CLIENT`（第三方采集 SDK `collect-rangers-v5.2.11.js`）经关闭本扩展对照测试确认依旧存在，与本扩展无关（本扩展零权限、不具备请求拦截能力）。
- 完成阶段 3 页面生命周期与安全回退：新增 `src/content/controller.ts`，通过 MutationObserver 处理回复改写、重新生成、消息节点替换、会话切换与 BFCache 返回；使用调查中取证的停止生成属性/图标路径/tooltip 作为生成活跃信号，活跃期间撤下旧卡片；停止后要求整条回复保持稳定 700ms 才挂载。`src/content/enhance.ts` 新增 EnhancementManager 管理组件卸载、失败签名和原始代码块恢复；新增隔离样式、键盘可操作的可见增强开关，默认开启，`chrome.storage.local` 持久化 `genuiEnabled` 并跨标签同步。Manifest 仅新增 `storage` 权限，不增加站点权限或后台。
- 阶段 3 新增生命周期单测与 Edge/Chrome e2e，覆盖生成中不提前标记不完整 JSON、停止后稳定挂载、重新生成、节点替换、原始内容恢复、开关跨页面持久化、页面卸载/BFCache 清理、复制事件、滚动、输入框和普通 Markdown。真实站点模式在 `chat.deepseek.com` origin 上测试扩展与页面共存，消息与停止信号使用合成 DOM；此验证不代表站点原生流式输出或模型真实生成验收。
- 阶段 3 验证结果：`npm run check` 通过（类型检查、lint、76 单测、build + dist 静态校验；产物 `dist/content.js` 238.29 kB，权限仅 `storage`）；默认 `npm run test:e2e` Edge/Chrome 共 8 通过、4 个真实站点用例按模式跳过；`REAL_SITE=1` Edge/Chrome 共 6 通过、6 个模拟页用例跳过。所有运行用例均未发现可归因于扩展的错误。
- 阶段 3 复核修复：清理已断开的消息节点时也恢复原始代码块样式与状态，避免节点复用后关闭增强仍隐藏原文；DOM 扫描去抖与 700ms 稳定等待分开计时，无关页面变化不会提前挂载，回复内容变化会重启稳定窗口。新增两条永久回归单测；复跑 `npm run check`（76 单测通过）、默认 Edge/Chrome e2e（8 通过、4 跳过）和 `REAL_SITE=1` e2e（6 通过、6 跳过）。
- 阶段 4 本地交互与受限计算：新增 v2 声明式协议，同时保持 v1 静态 Card 兼容；为 number/select 状态、slider/number-input/select/value 元素和派生表达式 AST 添加严格 Schema、引用与类型语义检查、循环依赖拒绝和资源上限。新增白名单本地解释器、每卡隔离状态、局部输入/计算错误与重置；无脚本执行、聊天发送或状态持久化。新增协议文档、预算样例和提示词草案。
- 阶段 4 检查：`npm run check` 通过，97 个单测通过；默认 e2e 10 项通过、6 项跳过；`REAL_SITE=1` 在真实 origin 用合成 DOM 验证 8 项通过、8 项模拟页用例跳过。Edge/Chrome 均覆盖本地状态更新、隔离、空/越界/步长错误、重置和零额外请求。初始自动化验收未执行真实模型输出抽样；后续用户手工复核见下一项，不把合成样例计作模型证据。
- 阶段 4 真实预算单案例复核：用户手动发送提示词；首次输出 HTML，纠正为 `genui` JSON 后又因“当前类别”的空 `unit` 被拒绝。省略该字段后，用户确认卡片正常并确认本轮手工复核结束；本地复现解析与计算通过。同步明确协议及提示词中无单位时须省略 `unit`、不得创建 reset 元素。记录两项待修复 P2（对象原型同名 ID 显示异常、较大步数下接受不符合步长的数值）与联合 Schema 日志不直观的限制。此轮只更新文档，不修复运行时代码；单案例不替代阶段 7 多场景重复生成验收。

### Changed

- 将 development-task 按阶段 0 至阶段 8 的开发顺序重排，每阶段列出待办、交付物和通过条件。
- 复核阶段 0 补测记录：明确默认开启为已确认产品要求，区分人工透明带入链路与未实现的扩展增强；旧 json 样本按识别规则跳过，初次发送按钮快照不作为流式状态判据；同步更新开发任务首页状态。
- 阶段 6 真实 origin 口径调整：「阶段 4 · 真实 origin」的零请求严格断言在站点自身遥测心跳（`gator.volces.com`）出现在交互窗口时不可成立（该请求属站点、不可归因扩展——manifest 无 host_permissions、无后台、内容脚本不发起请求），按「仅扩展桶判定」收紧扩展红线：仍禁止任何 `chrome-extension://` 起源请求并记录站点遥测；模拟页保持零请求严格断言不变。
- 阶段 8 文档口径更新：README「当前状态」「环境要求」「已验证内容」与目录说明更新至阶段 8 完成、Edge 验证版本追加 156.0.4314.58；CHANGELOG 章节由 Unreleased 改为 0.1.0（发布准备完成，商店提交未执行）；development-task 首页状态与阶段 8 清单全部勾选并附结果。
- 阶段 8 发布前复审修正：store-submission 的 1.3.1/1.3.2 行由「不需要账号 / N-A」改为登录与站点在线服务依赖的如实披露（含无法提供站点测试账号的原因与替代复核路径）；privacy「第三方」区分本地打包依赖（React/react-dom）与外部服务，privacy/README 卸载说明补充「已打开页面需刷新后注入效果消失」；store-submission 状态行改为「商店素材尚未全部就绪」，Logo 规格按官方说明改为 300×300 推荐、最低 128×128、截图可选。

0.1.0 阶段收尾状态：阶段 0–8 的本地实现、自动化验证、真实网页验收与发布准备已完成（阶段 8 复检见 [docs/phase8-verification.md](docs/phase8-verification.md)：253 项单测、默认 e2e 18 通过/6 设计性跳过、`REAL_SITE=1` 8 通过/16 设计性跳过、Edge 156.0.4314.58 与 Chrome 156.0.8078.79、发布包 `release/deepseek-genui-v0.1.0.zip` 与 SHA256 基线）；Edge Add-ons 商店提交未执行（无 Partner Center 账号，政策复核与素材见 [docs/store-submission.md](docs/store-submission.md)），发布准备不等于已上架。场景 2 首轮 v1 因 `initialSort.direction` 失败、v2 修复后重跑通过的事实保留记录；离屏代码块延迟渲染与流式不完整 JSON 的瞬时现象已记录。真实页面未做 URL 级网络抓包，零未声明网络行为的结论来自源码零网络 API 静态不变量、manifest、构建扫描与模拟页零请求断言。重新打开历史会话按设计如实说明：原始 `genui` JSON 代码块永久保留，卡片总是从它重新挂载，交互状态回到初始值（单卡内存不持久化）。隐私说明见 [docs/privacy.md](docs/privacy.md)；各阶段状态以 development-task 与本记录为准。
