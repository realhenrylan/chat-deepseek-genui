# GenUI JSON 协议

更新日期：2026-11-02。协议供 `chat.deepseek.com` AI 回复中的 `genui` 代码块使用。模型输出是不可信数据；扩展只解析和渲染声明式字段，不执行脚本、HTML、CSS、事件名、网络目标或浏览器 API。

## 版本

- **v1**：静态 Card，根字段为 `type`、`version: 1`、可选 `title` 和 `elements`。元素只支持 `{ "kind": "text", "value": "..." }`。
- **v2**：在单个 Card 内增加初始状态、控件绑定、派生值和本地重置。示例见 [`examples/budget-v2.json`](examples/budget-v2.json)。
- **v3**：在 v2 的交互能力上增加组合布局、条件说明、图表和表格；仍不引入脚本或模板字符串。示例见 [`examples/parabola-v3.json`](examples/parabola-v3.json)、[`examples/shopping-comparison-v3.json`](examples/shopping-comparison-v3.json)、[`examples/budget-v3.json`](examples/budget-v3.json)。
- 缺少 `version`、未知字段、未知版本或无效引用会保留原始代码块并回退，不猜测模型意图。

## 根对象

各版本根对象只允许以下字段：

| 字段 | 用途 |
| --- | --- |
| `type` | 固定为 `genui` |
| `version` | `1`、`2` 或 `3` |
| `title` | 可选卡片标题 |
| `state` | v2/v3 初始状态定义；每个控件实例运行时持有独立状态 |
| `derived` | v2/v3 派生数值及其白名单表达式 |
| `elements` | 按顺序呈现的元素 |

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
      "label": "y = ax² + bx + c", "color": "#3988ff",
      "points": [
        { "x": -2, "y": { "op": "add", "left": { "op": "const", "value": 4 }, "right": { "op": "state", "id": "c" } } }
      ]
    }
  ]
}
```

每张折线图 1–5 个系列，每系列 2–50 个点，总点数不超过 100；同系列 `x` 必须严格递增。`color` 只能是 `^#[0-9a-fA-F]{6}$` 的本地颜色，其他值回退到内置调色板，避免把任意 CSS 或远程资源带进 SVG。

三种图都显示标题、必要图例和“查看数据”表格；图上标签与表格数值来自同一次状态快照，不重新计算。数值错误在图表局部提示。

### 表格

`columns` 为 1–10 个 `{ "key", "label", "numeric"?, "unit"? }`，列 `key` 须唯一且符合 ID 规则。`rows` 最多 30 行，每行 `cells` 按列 `key` 提供字符串、数字、`null` 或数值表达式；未定义的列 key 会被拒绝。行可带 `visibleIf`。

`sortable: true` 时列头可点击排序，并显示 `aria-sort`；`initialSort` 指定初始排序列和 `asc`/`desc`。当 `sortable` 为真或行数超过 3 时显示筛选框与行计数。表格容器可横向滚动并获得键盘焦点；空结果使用 `emptyText`，默认文案为“没有可显示的数据”。条件行无法求值时仍显示该行，并在表格上方汇总提示。

## 规模限制

| 项 | v1/v2 上限 | v3 上限 |
| --- | ---: | ---: |
| 原始 JSON | 64 KiB | 64 KiB |
| JSON 嵌套深度 | 16 | 16 |
| Card 元素 | 50 | 80 |
| 状态变量 | 20 | 20 |
| 派生值 | 20 | 20 |
| 单个选择器选项 | 20 | 20 |
| 表达式节点总数 | 100（派生） | 300（派生 + 图表/表格内联表达式） |
| 条件节点总数 | — | 100 |
| 条件嵌套深度 | — | 5 |
| 单条表达式深度 | 8 | 8 |
| 单次重算运算数 | 500 | 500 |
| 布局嵌套深度 | — | 4 |
| 标题、标签、选项文本 | 120 字符 | 120 字符 |
| 状态 ID | 32 字符，字母开头，仅字母、数字、下划线 | 同左 |

## 用户操作与失败行为

- 滑块、输入框和选择器只更新当前 Card 的内存状态，不调用模型、不发送聊天、不发起网络请求。
- 空输入、非有限数、越界数值和不符合步长的数值会显示在对应控件旁；最后一个有效状态继续用于计算。
- 表格排序、筛选只作用于当前 Card 的展示数据，不改变状态或原始数据。
- 每张交互 Card 提供“重置当前界面”，恢复该文档的初始状态并清除本地输入错误。
- 原始 JSON 查看入口保留。协议、引用或挂载失败时显示原始代码块。
- 操作不包含代码回调、表达式字符串、任意事件处理器、任意 HTML/CSS、外部请求或持久化状态。

校验器由 `src/protocol/schema.ts` 生成，执行命令为 `npm run gen-validator`。跨字段语义检查、资源限制和循环依赖检测位于 `src/protocol/validate.ts`；表达式解释器位于 `src/runtime/evaluate.ts`。
