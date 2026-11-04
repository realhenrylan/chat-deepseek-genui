# GenUI JSON 协议

更新日期：2026-11-04。协议供 `chat.deepseek.com` AI 回复中的 `genui` 代码块使用。模型输出是不可信数据；扩展只解析和渲染声明式字段，不执行脚本、HTML、CSS、事件名、网络目标或浏览器 API。

## 版本

- **v1**：静态 Card，根字段为 `type`、`version: 1`、可选 `title` 和 `elements`。元素只支持 `{ "kind": "text", "value": "..." }`。
- **v2**：在单个 Card 内增加初始状态、控件绑定、派生值和本地重置。示例见 [`examples/budget-v2.json`](examples/budget-v2.json)。
- **v3**：在 v2 的交互能力上增加组合布局、条件说明、图表和表格；仍不引入脚本或模板字符串。示例见 [`examples/parabola-v3.json`](examples/parabola-v3.json)、[`examples/shopping-comparison-v3.json`](examples/shopping-comparison-v3.json)、[`examples/budget-v3.json`](examples/budget-v3.json)。
- **v4**：在 v3 上增加 `sources` 和可选的 `basis` 依据字段，用于区分用户输入、示例、估算、模型引用与计算结果；插件只展示声明，不访问链接、不核验资料。v4 文档可导出为方案文件并再次导入。示例见 [`examples/budget-v4.json`](examples/budget-v4.json)。
- 缺少 `version`、未知字段、未知版本或无效引用会保留原始代码块并回退，不猜测模型意图。

## 根对象

各版本根对象只允许以下字段：

| 字段 | 用途 |
| --- | --- |
| `type` | 固定为 `genui` |
| `version` | `1`、`2`、`3` 或 `4` |
| `title` | 可选卡片标题 |
| `state` | v2/v3/v4 初始状态定义；每个控件实例运行时持有独立状态 |
| `derived` | v2/v3/v4 派生数值及其白名单表达式 |
| `elements` | 按顺序呈现的元素 |
| `sources` | 仅 v4；最多 20 条来源声明，供 `basis.sourceId` 引用 |

## 状态与控件（v2/v3）

数值状态使用 `kind: "number"`，需提供 `initial`、`min`、`max`、`step`，可选 `unit`。必须满足 `min < max`、初始值在范围内、`step > 0`，且初始值与最大值都和步长对齐。数值最大绝对值为 `1,000,000,000,000`。

选择状态使用 `kind: "select"`，需提供 `initial` 和 `options: [{ "label", "value" }]`。选项值须唯一，初始值必须对应某个选项。

`unit` 为可选字段；提供时长度须为 1–20 字符。没有单位时省略该字段，不能写 `"unit": ""`（例如选择状态的当前值显示）。

v2/v3 均允许以下叶元素：

| `kind` | 字段 | 行为 |
| --- | --- | --- |
| `text` | `value` | 按纯文本显示；v3 可加 `visibleIf` |
| `number-input` | `bind` | 编辑绑定的数值状态 |
| `slider` | `bind` | 按范围和步长调整数值状态 |
| `select` | `bind` | 选择绑定状态中的一个选项 |
| `value` | `label`、`source: { "kind": "state" | "derived", "id" }`、可选 `unit` | 显示当前状态或派生结果 |

控件绑定必须引用存在且类型匹配的状态。不同控件可绑定同一个状态，例如同时提供滑块和数字输入；同一 Card 内共享状态。多个 Card 的状态彼此隔离。

## 派生表达式

表达式是 JSON AST，不是字符串表达式。叶子节点：

```json
{ "op": "const", "value": 12 }
{ "op": "state", "id": "budget" }
{ "op": "derived", "id": "remaining" }
```

允许的单目运算：`negate`、`abs`、`round`、`floor`、`ceil`，字段形式为 `{ "op": "abs", "value": <表达式> }`。

允许的双目运算：`add`、`subtract`、`multiply`、`divide`、`min`、`max`，字段形式为 `{ "op": "subtract", "left": <表达式>, "right": <表达式> }`。

派生值可以引用数值状态和其他派生值，但不能引用选择状态。所有引用必须存在，依赖图不能有循环。除零或结果溢出只在对应结果位置显示错误，不会崩溃或影响其他结果。

## v3 组合元素

v3 的 `elements` 除上述叶元素外还允许：

| `kind` | 关键字段 | 行为 |
| --- | --- | --- |
| `note` | `text`、可选 `tone: "info" \| "warn" \| "error"`、可选 `visibleIf` | 条件说明块；`error` 使用 alert 语义 |
| `section` | 可选 `title`、`children` | 带标题的分组，可嵌套其他 v3 元素 |
| `columns` | `columns`，2–3 个元素数组 | 多列布局；窄窗口自动变为单列 |
| `chart` | `chartType`、`title`、`legend`、`items` 或 `series` | 柱状、饼状或折线图 |
| `table` | `columns`、`rows`、`sortable`、`initialSort`、`emptyText`、可选 `visibleIf` | 本地排序、筛选、条件行与横向滚动 |

`section` 的 `children` 为 1–20 个元素；`columns` 为 2–3 列，每列 1–20 个元素。布局嵌套语义深度不超过 4，整张 Card 的 v3 元素总数不超过 80。

### 条件

`text`、`note`、`table` 和表格行可带 `visibleIf`。条件只读当前状态，不使用字符串或代码：

```json
{ "op": "state-eq", "id": "priority", "value": "price" }
{ "op": "num-gt", "left": { "op": "state", "id": "budget" }, "right": { "op": "const", "value": 0 } }
{ "op": "and", "conditions": [ <条件>, <条件> ] }
{ "op": "not", "condition": <条件> }
```

数值比较还可使用 `num-eq`、`num-neq`、`num-gte`、`num-lt`、`num-lte`；选择比较使用 `state-neq`。`state-eq`/`state-neq` 必须引用选择状态，`value` 必须是该状态的合法选项。`and`/`or` 的 `conditions` 为 1–10 项；`not` 包一项。条件无法求值时，说明内容保持可见并显示局部提示，而不是静默消失。

### 图表

柱状图和饼图：

```json
{
  "kind": "chart", "chartType": "bar", "title": "预算分配", "legend": true,
  "items": [
    { "label": "固定支出", "value": { "op": "state", "id": "fixedCost" } }
  ]
}
```

`items` 为 1–20 项，每项 `value` 是数值表达式。饼图只绘制正值，非正值被忽略并显示提示；所有值都非正时显示空状态。

折线图：

```json
{
  "kind": "chart", "chartType": "line", "title": "函数图像", "xLabel": "x", "yLabel": "y",
  "series": [
    {
      "label": "y = x²", "color": "#3988ff", "smooth": true,
      "points": [
        { "x": -2, "y": { "op": "const", "value": 4 } },
        { "x": 0, "y": { "op": "const", "value": 0 } },
        { "x": 2, "y": { "op": "const", "value": 4 } }
      ]
    }
  ]
}
```

每张折线图 1–5 个系列，每系列 2–50 个点，总点数不超过 100；同系列 `x` 必须严格递增。连续函数系列可设 `smooth: true`，以三次插值平滑连接并通过采样点；二次函数的三点导数估算可精确还原其曲线。平滑插值可能改变一般数据点之间的形状，因此只用于连续函数，不用于实测或离散数据；省略或设为 `false` 时仍绘制普通折线。`color` 只能是 `^#[0-9a-fA-F]{6}$` 的本地颜色，其他值回退到内置调色板，避免把任意 CSS 或远程资源带进 SVG。

三种图都显示标题、必要图例和“查看数据”表格；图上标签与表格数值来自同一次状态快照，不重新计算。数值错误在图表局部提示。

### 表格

`columns` 为 1–10 个 `{ "key", "label", "numeric"?, "unit"? }`，列 `key` 须唯一且符合 ID 规则。`rows` 最多 30 行，每行 `cells` 按列 `key` 提供字符串、数字、`null` 或数值表达式；未定义的列 key 会被拒绝。行可带 `visibleIf`。

`sortable: true` 时列头可点击排序，并显示 `aria-sort`；`initialSort` 指定初始排序列和 `asc`/`desc`。当 `sortable` 为真或行数超过 3 时显示筛选框与行计数。表格容器可横向滚动并获得键盘焦点；空结果使用 `emptyText`，默认文案为“没有可显示的数据”。条件行无法求值时仍显示该行，并在表格上方汇总提示。

## v4 来源与依据

v4 在 v3 的全部字段上增加根级 `sources`，并允许在状态变量、派生值、值元素、图表条目/系列、表格列/行/整体以及分组元素上添加 `basis`。两者都是描述性元数据：插件不会请求链接、不会核验资料，也不会把模型声明当成已确认事实。

### `sources`

```json
{
  "id": "stats",
  "label": "统计公报",
  "url": "https://example.com/report",
  "publisher": "统计局",
  "publishedAt": "2026-01-02",
  "retrievedAt": "2026-01-03",
  "note": "模型从对话中引用，未核验"
}
```

| 字段 | 要求 |
| --- | --- |
| `id` | 必填，1–32 字符，字母开头，仅字母、数字、下划线；同一文档内唯一 |
| `label` | 必填，1–120 字符，用于界面与摘要 |
| `url` | 可选，最长 2048；应为 `https://`，但结构校验接受任意非空字符串，界面会把非 https、含空白/控制字符/凭据或指向本地/私有主机的链接明确标注为“形式不可靠” |
| `publisher` | 可选，最长 120 字符 |
| `publishedAt` / `retrievedAt` | 可选，`YYYY-MM-DD` 或带 `Z`/`±HH:MM` 的日期时间；必须是真实日期 |
| `note` | 可选，最长 500 字符 |

界面把 `url` 当纯文本显示，不生成可点击链接；来源固定标注“模型声称 · 未核验”。链接形式不可靠时只影响该来源的展示提示，不会让整份界面回退，也不会被当作可访问或已核验的地址。

### `basis`

```json
{ "kind": "reference", "sourceId": "stats", "asOf": "2026-01-02", "validUntil": "2026-12-31", "note": "年度公报" }
```

| 字段 | 要求 |
| --- | --- |
| `kind` | 必填：`user`、`example`、`estimate`、`reference`、`computed` 或 `unknown` |
| `sourceId` | 可选；`reference` 必须提供，`computed` 不得提供；其他类别可引用已声明来源 |
| `note` | 可选，最长 300 字符 |
| `asOf` / `validUntil` | 可选真实日期；`validUntil` 不得早于 `asOf`。带时间部分时按绝对时刻判断是否过期（同一日期内的截止时间也会生效），界面与摘要保留原始秒和时区 |

`kind` 的界面文案：

| `kind` | 文案 | 含义 |
| --- | --- | --- |
| `user` | 用户提供 | 来自用户消息或用户上传的资料 |
| `example` | 示例数据 | 为演示而设，不代表真实数据 |
| `estimate` | 估算 | 模型推算，误差未核验 |
| `reference` | 模型引用 · 未核验 | 模型声称引用了 `sourceId` 指向的资料 |
| `computed` | 计算结果 | 由已声明输入与白名单表达式计算得到 |
| `unknown` | 未标注来源 | 无法判断来源；与缺失值一样不背书 |

跨字段规则：`reference` 缺少 `sourceId` 或引用了未声明的来源会被拒绝；`computed` 绑定来源会被拒绝；状态变量不得标为 `computed`（状态是用户可改的输入，不是计算结果）；派生值若带 `basis` 必须是 `computed`。`validUntil` 已过期时，界面与摘要会标注“已过期”，但仍保留原始值而不是自动更新。

没有 `basis` 的数据在界面上按“未标注来源”处理，不会显示为已核验；表格中的 `null` 单元格显示“—”并注明“缺失值（不是 0）”，不会参与数值比较。v4 卡片提供“依据与适用范围”面板，列出声明来源、关键输入与假设；面板中的数值/选择控件直接绑定当前状态，修改后派生结果、图表与表格同步更新，旧值不会伪装成当前结果。

用户修改某个输入后，该值不再沿用原始依据：徽标与继续讨论摘要会标注“用户修改”，并保留“原依据”仅作历史说明；输入回到初始值时该标记自动清除。存在用户修改时，静态 `text`/`note` 下方会提示“按初始条件生成，可能已不对应当前结果”，导出方案也会记录被修改的状态 id。

如果输入框当前内容为空或无效（界面上会显示错误，且状态保留上一次有效值），导出方案与“继续讨论”都会被阻止，提示先修正或恢复有效值，避免把旧值当成当前条件带出。`basis` 的日期/来源问题只影响对应条目，不使整份文档回退。

v3 及更早文档不需要 `basis`，渲染行为保持不变；在 v4 之外出现 `basis` 或 `sources` 会被拒绝。

## 方案导出与导入

v2/v3/v4 卡片可导出方案文件，格式为：

```json
{
  "type": "genui-plan",
  "formatVersion": 1,
  "exportedAt": "2026-06-01T10:00:00+08:00",
  "document": { "type": "genui", "version": 4, "...": "..." },
  "state": { "budget": 120 },
  "editedState": ["budget"]
}
```

`document` 会重新经过完整校验；`state` 必须与文档的状态变量一一对应，且满足范围、步长与选项约束。`editedState` 可选，记录用户改过且当前值已偏离初始值的状态 id；导入时恢复这些标记，旧方案没有该字段时按当前值与初始值是否相同推断。导入只恢复界面、来源/依据与状态，不发送聊天、不访问网络。导入失败时保留当前界面并显示原因，不会回退到原始代码块。

## 规模限制

| 项 | v1/v2 上限 | v3/v4 上限 |
| --- | ---: | ---: |
| 原始 JSON | 64 KiB | 64 KiB |
| JSON 嵌套深度 | 16 | 16 |
| Card 元素 | 50 | 80 |
| 状态变量 | 20 | 20 |
| 派生值 | 20 | 20 |
| 来源声明 | — | 20 |
| 单个选择器选项 | 20 | 20 |
| 表达式节点总数 | 100（派生） | 300（派生 + 图表/表格内联表达式） |
| 条件节点总数 | — | 100 |
| 条件嵌套深度 | — | 5 |
| 单条表达式深度 | 8 | 8 |
| 单次重算运算数 | 500 | 500 |
| 布局嵌套深度 | — | 4 |
| 标题、标签、选项文本 | 120 字符 | 120 字符 |
| 来源链接 | — | 2048 字符 |
| 来源备注 / 依据备注 | — | 500 / 300 字符 |
| 状态 ID | 32 字符，字母开头，仅字母、数字、下划线 | 同左 |

## 用户操作与失败行为

- 滑块、输入框和选择器只更新当前 Card 的内存状态，不调用模型、不发送聊天、不发起网络请求。
- 空输入、非有限数、越界数值和不符合步长的数值会显示在对应控件旁；最后一个有效状态继续用于计算。
- 表格排序、筛选只作用于当前 Card 的展示数据，不改变状态或原始数据。
- 每张交互 Card 提供“重置当前界面”，恢复该文档的初始状态并清除本地输入错误。
- 原始 JSON 查看入口保留。协议、引用或挂载失败时显示原始代码块。
- 操作不包含代码回调、表达式字符串、任意事件处理器、任意 HTML/CSS、外部请求或持久化状态。

校验器由 `src/protocol/schema.ts` 生成，执行命令为 `npm run gen-validator`。跨字段语义检查、资源限制和循环依赖检测位于 `src/protocol/validate.ts`；表达式解释器位于 `src/runtime/evaluate.ts`。
