# D03：优化卡片分组与窄聊天栏布局

状态：已实现（2026-11-06）。

GitHub：[#13](https://github.com/realhenrylan/chat-deepseek-genui/issues/13)。

## 问题与用户影响

外层卡片、内部 section 与表格均可能有描边；section 还能嵌套，容易形成较多视觉框线。多列布局目前按视口宽度切换，宽屏中的实际聊天内容区仍可能较窄。

用户需要在有限宽度里理解内容分组，过多框线和拥挤的列会增加扫读负担。

## 设计目标

用清楚的分组表达参数、结果、图表与明细的关系；在宽窄聊天栏中都能顺畅阅读和操作。

## 已确认的设计方向

- 外层保留轻边界，内部主要用标题和留白分组。
- 空间足够时参数与结果并列，窄聊天栏上下排列。
- 核心内容优先，细节按需展开；具体图表和表格细节继续由 D06 讨论。

以上来自用户第一、二轮选择。各任务的具体内容顺序按已确认的阅读层级制定。

## 验收方向

- 不阅读全部说明，也能分清输入区域、结果区域与补充信息。
- 窄栏中控件、标签和结果不会因并列布局而被挤压或截断。
- 三个示例遵循相同的分组语言，同时保留不同任务的信息顺序。
- 减少框线后，独立交互区域仍容易识别。

## 范围与协作

依赖 D01，与 D02 协作；数据表格的横向阅读由 D06 细化。

## 技术方案

- 复用现有 section/columns 协议：Card 保留轻外边界，section 默认通过标题、间距与必要分隔表达分组，不按嵌套层级不断增加底色和描边。
- 在 columns 外建立局部查询容器，用 CSS container queries 按该布局的实际可用宽度调整子 grid；避免仅依据浏览器视口判断。嵌套 columns 以自己的容器宽度适配。
- 默认单列；2 列初始阈值采用约 38rem，3 列约 58rem，结合每列可读宽度与实测校正。保留合法三列文档能力，单列化时按协议中的列/元素顺序阅读，不重排业务内容。
- 宽窄变化仅改变 CSS 排列，不生成另一棵 React 树、不改变 key、不卸载输入控件或表格。不用 JS 窗口监听器重建布局。
- 参数/结果并列由模型用已有 columns 表达；在可见提示词与示例中补充组合原则并升级版本，不用标签启发式把旧文档自动改成固定模板。不新增折叠 section 协议；现有详情和数据核对入口承载补充信息，关键来源、警告和假设保持可见。

## 实现与验收

- [x] 同一宽屏中，将实际卡片容器缩到 360px/560px 后能正确单列，足够宽时恢复原二/三列结构。（验证：Playwright E2E 阶段 15 在 Edge 和 Chrome 中验证 360/560/720/960px 宽度及亮暗色主题自适应列数）
- [x] 嵌套布局、长中文标签（120 字符）、长数值（1e12）与最长单位（20 字符）在等效回流宽度（360px）下不引起卡片水平溢出，滑块保持可见可操作；宽表的局部滚动另由 D06 处理。（说明：本项采用 360px 局部容器等效回流宽度验证，对应 WCAG 2.1 Reflow 1.4.10 标准在 1280px / 360px 视口下的响应式单列与防横向滚动；覆盖局部容器窄栏约束，但明确不等于真实浏览器全局光学缩放 optical zoom 测试）
- [x] 调整值、表格筛选/排序、详情开合后改变容器宽度，输入和当前视图状态保持。（验证：Playwright E2E 阶段 15 在 960px 宽下设置表格筛选、成本列升序排序、输入未提交超界草稿 150、展开图表数据详情与查看原始 JSON，缩窄到 360px 及切回 960px 后所有筛选、排序方向、首行排序结果、输入草稿与展开状态完整保持）
- [x] 标题层级、DOM 阅读顺序及键盘顺序一致；装饰减弱后分组仍清楚。（验证：Playwright E2E 阶段 15 在真实浏览器中通过键盘 Tab 键从首个控件连续遍历 Shadow DOM 内交互元素，验证焦点顺序严格遵循协议 columns/elements 顺序：paramA -> paramB -> inputNum -> col3_1 -> col3_2 -> col3_3 -> longField -> table 筛选框）
- [x] v1/v2/v3 示例与页面复制、滚动和原始块查看保持兼容。（验证：全量单元测试与 E2E 测试兼容；兼容旧版 v3.0 提示词草稿，避免重复追加或模式切换误删用户编辑内容）

## 实现与验证记录（2026-11-06）

1. **容器查询与组件结构**：
   - `src/render/composite.tsx`：为 `kind === 'columns'` 在外层包裹 `<div className="genui-columns-container">`，内部保留 `<div className="genui-columns" data-columns={...}>`；不修改 `walkElements` 路径、递归 `key` 及状态存储键，保证 `emphasis: "primary"` 路径收集与表格视图状态稳定。
2. **样式去框线与 Container Queries 适配**：
   - `src/render/card.css`：`.genui-section` 移除封闭四周边框、圆角和内边距，改为基于标题（14px semi-bold）、上下留白（8px/12px）与非首项顶部分隔线（`border-top: 1px solid var(--genui-color-border-subtle)`）分组；嵌套首项顶部对齐自然紧凑。
   - `.genui-columns-container` 声明 `container-type: inline-size`，`.genui-columns` 默认单列（窄屏/移动优先）；`@container (min-width: 38rem)` 恢复 2 列并列，`@container (min-width: 58rem)` 恢复 3 列并列（并校准 57.5rem 兼容 960px 宿主扣除卡片 34px 内边距后的 926px 实际可用宽度）；移除 `@media (max-width: 560px)` 视口规则。
   - 所有卡片与布局容器（`.genui-card`, `.genui-card-body`, `.genui-section`, `.genui-section-body`, `.genui-columns-container`, `.genui-columns`, `.genui-column`, `.genui-control`, `.genui-slider-row`）均设置 `min-width: 0` 与长文本自动断行，杜绝水平溢出。
3. **提示词升级与示例同步**：
   - `src/content/prompt.ts`：提示词升级至 `3.1`，补充 `section`（标题留白逻辑分组、避免无意义嵌套）与 `columns`（按卡片可用宽度自适应切换，推荐参数与主要结果 2 列并列对照，图表、表格与依据排在下方，关键说明直接可见）组合原则；优化末尾示例为并列参数与结果；
   - 同步更新 `docs/prompt.md`、`README.md`、`docs/genui-protocol.md` 与 `docs/examples/preference-v5.json` 等示例。
4. **窄栏滑块防挤压与极端值换行布局**：
   - `src/render/card.css`：`.genui-slider-row` 由 grid 升级为 `display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;`；
   - 滑块 `.genui-slider` 声明 `flex: 1 1 140px; min-width: min(120px, 100%);`，数值输出 `.genui-control-current` 声明 `overflow-wrap: anywhere; word-break: break-word;`；
   - 在 360px 窄卡片或嵌套窄列中，当标签为协议上限 120 字符、数值达 1e12 且单位为 20 字符时，数值与单位自动换行至第二行，滑块在第一行独占整行展开（实测宽度 >= 120px），保持鼠标拖拽与键盘方向键完全可操作，且无任何卡片级横向溢出。
5. **旧版 v3.0 提示词草稿兼容与用户内容保护**：
   - `src/content/prompt.ts`：导出 `GENUI_PROMPT_V30_START`、`GENUI_PROMPT_TOOL_V30_START` 及完整的 `GENUI_PROMPT_V30_TEXT` 与 `GENUI_TOOL_PROMPT_V30_TEXT`；
   - `hasGenuiPrompt` 识别 v3.0 起始标记，用户恢复旧版草稿并继续打字时绝不重复追加 v3.1 说明；
   - `describeGenuiDraftPrompt` 精确识别完整的 v3.0 auto 与 tool 说明为 `intact`，浮标模式切换时平滑替换或移除旧提示词；若用户编辑过 v3.0 说明内容，则识别为 `edited`，模式切换时严格保留用户编辑过的草稿，杜绝误删。
6. **全量测试与验证结果**：
   - 单元测试：新增 `tests/unit/grouping-layout.test.tsx`（10 项）、更新 `tests/unit/prompt.test.ts`（19 项）与 `tests/unit/augment.test.ts`（31 项），全量单元测试 46 测试文件、567 项通过（3 项按条件跳过，共 570 项）；
   - Playwright E2E：`阶段 15` 覆盖 Edge 与 Chrome 在 360px、560px、720px、960px 容器自适应列数、亮暗色主题、360px 窄栏极端滑块布局与键盘操作、真实浏览器 Tab 键焦点顺序遍历，以及列布局切换前后的表格筛选、排序、未提交输入草稿与详情开合状态完整保持，E2E 默认套件 28 项通过、6 项真实站点跳过（共 34 项）；
   - `npm run check`（包含 `typecheck`、`lint`、`test`、`build`、`check:dist`）全部 0 错误通过。

## 与现有 issues 的关系

- 依赖 D01，与 D02 协调阅读层级；为 D05、D06 提供容器布局基础。
- #2 负责跨重新挂载与刷新恢复；本 issue 仅保证自身响应式切换不引入额外卸载，不替代该工作。
- #9 的复杂侧栏承载独立推进；这里仅适配聊天内现有容器，不新增侧栏、后台或权限。
- #8 的重要来源、假设和风险不因“细节按需展开”被隐藏。

参考：[CSS container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries)。
