# GenUI JSON 协议

更新日期：2026-11-05。协议供 `chat.deepseek.com` AI 回复中的 `genui` 代码块使用。模型输出是不可信数据；扩展只解析和渲染声明式字段，不执行脚本、HTML、CSS、事件名、网络目标或浏览器 API。

## 版本

- **v1**：静态 Card，根字段为 `type`、`version: 1`、可选 `title` 和 `elements`。元素只支持 `{ "kind": "text", "value": "..." }`。
- **v2**：在单个 Card 内增加初始状态、控件绑定、派生值和本地重置。示例见 [`examples/budget-v2.json`](examples/budget-v2.json)。
- **v3**：在 v2 的交互能力上增加组合布局、条件说明、图表和表格；仍不引入脚本或模板字符串。示例见 [`examples/parabola-v3.json`](examples/parabola-v3.json)、[`examples/shopping-comparison-v3.json`](examples/shopping-comparison-v3.json)、[`examples/budget-v3.json`](examples/budget-v3.json)。
- **v4**：在 v3 基础上新增折线函数曲线系列——曲线用受限表达式 `y = f(x)` 一次声明，定义域可随交互状态变化，本地运行时按有上限的采样数重算；旧能力语义不变。示例见 [`examples/parabola-v4.json`](examples/parabola-v4.json)。
- **v5**：新增本地语义模型 `models`（预算、成本、偏好），把有明确规则的计算下沉到受测运行时；元素可用模型来源读取同一计算快照，并用 `explain` 解释依据。示例见 [`examples/budget-v5.json`](examples/budget-v5.json)、[`examples/preference-v5.json`](examples/preference-v5.json)、[`examples/cost-v5.json`](examples/cost-v5.json)。
- 缺少 `version`、未知字段、未知版本或无效引用会保留原始代码块并回退，不猜测模型意图。

## 根对象

各版本根对象只允许以下字段：

| 字段 | 用途 |
| --- | --- |
| `type` | 固定为 `genui` |
| `version` | `1`、`2`、`3`、`4` 或 `5` |
| `title` | 可选卡片标题 |
| `state` | v2–v5 初始状态定义；每个控件实例运行时持有独立状态 |
| `derived` | v2–v5 派生数值及其白名单表达式 |
| `models` | v5 必填，1–4 个，按数组顺序计算 |
| `elements` | 按顺序呈现的元素 |

## 状态与控件（v2–v5）

数值状态使用 `kind: "number"`，需提供 `initial`、`min`、`max`、`step`，可选 `unit`。必须满足 `min < max`、初始值在范围内、`step > 0`，且初始值与最大值都和步长对齐。数值最大绝对值为 `1,000,000,000,000`。

选择状态使用 `kind: "select"`，需提供 `initial` 和 `options: [{ "label", "value" }]`。选项值须唯一，初始值必须对应某个选项。

`unit` 为可选字段；提供时长度须为 1–20 字符。没有单位时省略该字段，不能写 `"unit": ""`（例如选择状态的当前值显示）。

v2–v5 均允许以下叶元素：

| `kind` | 字段 | 行为 |
| --- | --- | --- |
| `text` | `value` | 按纯文本显示；v3 可加 `visibleIf` |
| `number-input` | `bind` | 编辑绑定的数值状态 |
| `slider` | `bind` | 按范围和步长调整数值状态 |
| `select` | `bind` | 选择绑定状态中的一个选项 |
| `value` | `label`、`source: { "kind": "state" | "derived", "id" }` 或 v5 的 `{ "kind": "model", "model", "key" }`、可选 `unit`、v3–v5 可选 `emphasis: "normal" \| "primary"` | 显示当前状态、派生结果或模型标量 |

`emphasis` 只表达展示优先级，不参与求值，也不改变摘要、排序或模型快照。省略等同 `normal`；v3–v5 按文档顺序只强调前两个显式 `primary`，超出的 `primary` 按普通结果显示，卡片不会因显示数量失败。v1/v2 的字段集合仍为封闭白名单，不接受 `emphasis`。

控件绑定必须引用存在且类型匹配的状态。不同控件可绑定同一个状态，例如同时提供滑块和数字输入；同一 Card 内共享状态。多个 Card 的状态彼此隔离。

## 派生表达式

表达式是 JSON AST，不是字符串表达式。叶子节点：

```json
{ "op": "const", "value": 12 }
{ "op": "state", "id": "budget" }
{ "op": "derived", "id": "remaining" }
{ "op": "model", "model": "monthly", "key": "balance" }
```

`model` 叶子仅 v5 允许，只能读取已计算模型的标量；模型输入只能引用更早声明的模型，derived 不能引用模型。元素表达式和条件可以读取任意已计算模型。

允许的单目运算：`negate`、`abs`、`round`、`floor`、`ceil`，字段形式为 `{ "op": "abs", "value": <表达式> }`。

允许的双目运算：`add`、`subtract`、`multiply`、`divide`、`min`、`max`，字段形式为 `{ "op": "subtract", "left": <表达式>, "right": <表达式> }`。

派生值可以引用数值状态和其他派生值，但不能引用选择状态。所有引用必须存在，依赖图不能有循环。除零或结果溢出只在对应结果位置显示错误，不会崩溃或影响其他结果。

## v3–v5 组合元素

v3–v5 的 `elements` 除上述叶元素外还允许：

| `kind` | 关键字段 | 行为 |
| --- | --- | --- |
| `note` | `text`、可选 `tone: "info" \| "warn" \| "error"`、可选 `visibleIf` | 条件说明块；`error` 使用 alert 语义 |
| `section` | 可选 `title`、`children` | 逻辑分组；通过标题与留白组织，内部无四周封闭框线，可嵌套其他 v3–v5 元素 |
| `columns` | `columns`，2–3 个元素数组 | 多列布局；依托局部容器查询按实际可用宽度自适应（宽时并列、窄栏自动切换为单列） |
| `chart` | `chartType`、`title`、`legend`、`items` 或 `series`；v5 柱/饼可用 `source: { "model" }`（可带可选 `"kind": "model"`） | 柱状、饼状或折线图 |
| `table` | `columns`、`rows`、`sortable`、可选 `selectable`、`initialSort`、`emptyText`、可选 `visibleIf`；v5 可用 `source: { "model", "view"? }`（可带可选 `"kind": "model"`） | 本地排序、筛选、条件行与横向滚动；`selectable` 时行首单选并记录原始行序号，选中项、筛选与排序进入「继续讨论」摘要；v5 模型表格按模型快照渲染 |
| `explain` | v5：`model`、可选 `title`、`visibleIf` | 本地生成模型依据、诊断与公式 |

`section` 的 `children` 为 1–20 个元素；`columns` 为 2–3 列，每列 1–20 个元素。布局嵌套语义深度不超过 4，整张 Card 的 v3–v5 元素总数不超过 80。

### 条件

`text`、`note`、`table` 和表格行可带 `visibleIf`。条件只读当前 state/derived；v5 还可读已计算模型标量，不使用字符串或代码：

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

`items` 为 1–20 项，每项 `value` 是数值表达式。饼图只绘制正值，非正值被忽略并显示提示；所有值都非正时显示空状态。v5 柱/饼也可用 `source: { "model": "..." }` 读取模型 `chartItems`，此时不写 `items`，且不得与 `items` 同时出现；折线不提供模型来源。

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

v4 折线系列可用函数曲线写法代替离散点；同一 `series` 数组中两种写法可混用：

```json
{
  "label": "y = a·x² + b·x + c", "color": "#3988ff",
  "function": {
    "expression": { "op": "add", "left": { "op": "multiply", "left": { "op": "state", "id": "a" }, "right": { "op": "x" } }, "right": { "op": "state", "id": "c" } },
    "domain": { "start": { "op": "subtract", "left": { "op": "state", "id": "vertexX" }, "right": { "op": "const", "value": 10 } }, "end": { "op": "add", "left": { "op": "state", "id": "vertexX" }, "right": { "op": "const", "value": 10 } } },
    "samples": 41,
    "features": ["zero"]
  }
}
```

- `expression` 是与派生值同一白名单的表达式 AST，额外允许叶子 `{"op":"x"}`（局部变量）；可在其中引用数值状态与派生值，因此曲线随滑杆重算。`x` 不允许出现在其他任何位置（派生值、离散点、domain）。
- `domain` 可选，`start`/`end` 是不含 `x` 的表达式；缺省为固定区间 [-10, 10]。定义域表达式求值失败（如 `a = 0` 时对称轴 `-b/(2a)` 除零）、结果非有限或 `end <= start` 时静默回退默认域，不显示错误，曲线退化为普通直线照常绘制。
- `samples` 可选，5–50（默认 41），在域内等分采样含端点；函数公式只声明一次，参数调整后由本地运行时按该上限重算。
- `features: ["zero"]` 表示零点覆盖：首轮采样后若既无恰好为 0 的样本也无跨 0 的符号变化，则以当前域中心对称加倍范围重采样，最多 4 轮，域幅值超出上限时提前停止。仅当扩展后采样更接近零点（无零样本/无符号变化，但最近样本的 `|y|` 减小）时才保留本轮扩展；无实根或相切零点等扩展无效的情况会撤销该轮、保留上一个视口，并在最终仍未覆盖时显示「未找到零点」提示。无实根时视口不会被持续放大。
- 渲染上函数曲线始终以三次插值平滑连接采样点，不绘制样本圆标；个别采样求值失败（如 `1/x` 于 `x = 0`）时丢弃该样本、曲线断开并计入局部提示（例如「1 个采样点无法计算」）。曲线采样使用每系列独立的 5000 次运算预算，不占用共享的 500 次池；超出时该系列整体显示错误，其余内容不受影响。
- 坐标轴：视口内包含 `x = 0` / `y = 0` 时，坐标轴画在数据坐标零点；否则退回绘图区边缘。该行为适用于 v3/v4 全部折线图。

三种图都显示标题、必要图例和“查看数据”表格；图上标签与表格数值来自同一次状态快照，不重新计算。数值错误在图表局部提示。

### 表格

`columns` 为 1–10 个 `{ "key", "label", "numeric"?, "unit"? }`，列 `key` 须唯一且符合 ID 规则。`rows` 最多 30 行，每行 `cells` 按列 `key` 提供字符串、数字、`null` 或数值表达式；未定义的列 key 会被拒绝。行可带 `visibleIf`。

`sortable: true` 时列头可点击排序，并显示 `aria-sort`；`initialSort` 指定初始排序列和 `asc`/`desc`。当 `sortable` 为真、`selectable` 为真或行数超过 3 时显示筛选框与行计数。表格容器可横向滚动并获得键盘焦点；空结果使用 `emptyText`，默认文案为“没有可显示的数据”。条件行无法求值时仍显示该行，并在表格上方汇总提示。

`selectable: true` 时每行首列出现单选控件，用户选中一行作为候选项；选中项按文档行序号记录，排序或筛选不会改变身份。选中行不在当前筛选结果中时显示提示，而不是悄悄取消选择；再次点击「清除选择」可取消。可见行超过两行时，工具栏提供第二对比项选择器；未指定时只有恰好两行可见才自动比较。被筛选隐藏或已不存在的选中项、对比项都会在表格与摘要中如实提示，不会自动改选。候选表的筛选文本、排序、选中项、对比项与可见行会在点击「继续讨论」时进入同一份摘要快照；被 `visibleIf` 隐藏的表格不进入摘要。

v5 可用 `source: { "model": "...", "view"? }` 替代 `columns`/`rows`，视图必须与模型类型匹配：预算 `summary`（默认）或 `items`，成本 `plans`，偏好 `ranking`（默认）或 `breakdown`。模型表格与显式列/行互斥；`source` 可带可选 `"kind": "model"` 标记，仍复用本地排序、筛选、空状态与横向滚动。

## v5 语义模型

`models` 是 v5 必填数组（1–4 个），按声明顺序计算。模型把预算、成本、偏好三类规则固定在本地运行时，模型只提供数据、约束与呈现方式；扩展不执行脚本，也不访问网络。模型输入表达式可读 `state`、`derived`、常量以及更早模型的标量，不能读自身或更晚模型；derived 仍不能读模型。

公共字段：`kind`、`id`（唯一、符合 ID 规则）、可选 `label`、可选 `precision`（0–4，默认 2）。金额按 `precision` 转为整数最小单位后计算（四舍五入、half away from zero），避免浮点累计误差；预算和成本的 `unit` 仅用于显示，`useUnit` 用于单次成本的显示。

### 预算 `budget`

```json
{
  "kind": "budget", "id": "monthly", "unit": "元", "precision": 0,
  "income": { "op": "state", "id": "income" },
  "expenses": [
    { "label": "房租", "amount": { "op": "state", "id": "rent" } }
  ]
}
```

`income` 与 `expenses[].amount` 是数值表达式，支出项 0–20 个。输出标量：`income`、`expenses`、`balance`、`overspend`、`usage`、`itemCount`。`balance = income - expenses`；`overspend` 为 `1`/`0`；`usage` 是支出占收入的百分比（保留 1 位小数），收入为 0 时为 `null` 并给出诊断。负数输入按 0 计并给出警告；没有支出项时表为空并给出提示。

表格视图：`summary` 三行（收入、支出、余额，含支出占比）与 `items`（支出项、金额、占支出比例；支出为 0 时占比为 `null`）。明细金额与合计使用同一个按 `precision` 舍入后的值，不会出现明细显示 1.234、合计按 1.23 计算的不一致。`chartItems` 为收入与支出两项。`explain` 展示收入、支出、余额、占比、超支与支出项依据。

### 成本 `cost`

```json
{
  "kind": "cost", "id": "membership", "unit": "元", "useUnit": "次", "precision": 2,
  "horizon": { "op": "state", "id": "months" },
  "plans": [
    { "label": "月付", "fee": { "op": "const", "value": 30 }, "coverage": 1, "usesPerPeriod": { "op": "state", "id": "visits" } },
    { "label": "年付", "fee": { "op": "const", "value": 300 }, "coverage": 12, "usesPerPeriod": { "op": "state", "id": "visits" } }
  ]
}
```

`horizon` 是计划周期数；`plans` 为 1–10 个方案，`fee` 是每份价格，`coverage > 0` 是每份覆盖的周期数，`usesPerPeriod` 是每周期使用次数。购买份数 `ceil(horizon / coverage)`；对十进制输入，运行时允许相对 `1e-9` 的浮点容差，数学上恰好整除时按整数份计，避免 `0.07 / 0.01` 被多算一份。总成本 `fee × 份数`，总次数 `usesPerPeriod × horizon`，单次成本 `totalCost / totalUses`。周期为 0 时不购买、总成本为 0、总次数为 0、单次成本为 `null`；总次数为 0 时单次成本不可用。负数按 0 计并警告；整份超买会给出提示。方案按单次成本升序（不可用排最后）、总成本、声明顺序排列。输出标量：`horizon`、`planCount`、`lowestTotalCost`、`lowestUnitCost`（不可用时为 `null`）。表格视图 `plans`；`chartItems` 为各方案总成本。

### 偏好 `preference`

```json
{
  "kind": "preference", "id": "pick", "precision": 1,
  "dimensions": [
    { "id": "price", "label": "价格", "weight": 3, "direction": "lower" },
    { "id": "battery", "label": "续航", "weight": 2, "direction": "higher" }
  ],
  "candidates": [
    { "label": "手机 A", "values": { "price": 4999, "battery": 80 } },
    { "label": "手机 B", "values": { "price": null, "battery": 88 } }
  ],
  "filters": [
    { "dimension": "price", "max": { "op": "state", "id": "budget" } }
  ]
}
```

维度 1–8 个，`weight` 可写 0–1000 的数字常量或表达式；表达式可引用 state、derived 或更早模型，运行时负数按 0、超过 1000 按上限并警告。数字权重至少一个大于 0；使用表达式时运行时会处理权重合计为 0 的情况。`direction` 为 `higher` 或 `lower`；候选 0–30 个，`values` 只允许已声明维度，值可为数字或 `null`；筛选 0–8 个，每个维度最多一个，至少提供 `min` 或 `max`。筛选阈值可写数字常量或表达式（如 `{"dimension":"price","max":8000}`）。`null` 与缺失键都表示资料缺失，不按 0 处理。

计算顺序：先用筛选阈值（数字常量或表达式）排除候选（缺失值不通过筛选），再对通过候选的每个维度用现存值做 min-max 归一化；`max = min` 时该维度归一为 1；`lower` 方向取反。得分 `Σ(归一值 × 有效weight) / Σ(存在的有效weight > 0) × 100`，缺失维度不计 0、不进分母；没有可计权维度或权重合计为 0 时得分为 `null`，`rankedCount` 为 0 并给出诊断。得分按 `precision` 四舍五入（默认 1 位小数）。排序按得分降序、缺失计权维度数升序、声明顺序；同分同名次（competition ranking），未计分候选排后且名次为空。输出标量：`candidateCount`、`eligibleCount`、`rankedCount`、`topScore`、`weightTotal`（有效权重之和）、`dimensionCount`。表格视图：`ranking`（名次、候选、得分、缺失维度）与 `breakdown`（候选、得分、各维度归一值，列数上限 10）；`chartItems` 只含有得分的候选。空候选、全部被筛掉、全部缺少可计权维度都会返回明确计数与诊断，而不是编造 0 分。

### 模型来源与解释

- `value` 可用 `{ "kind": "model", "model": "monthly", "key": "balance" }` 显示标量；标量为 `null` 时显示“不可用”，模型失败时显示具体错误。
- `table` 与柱/饼 `chart` 可用 `source` 读取模型表格/图表项；`source` 可带可选 `"kind": "model"` 标记，它们与显式 `columns`/`rows`、`items` 互斥。
- `explain` 读取同一 `ModelResult`，展示公式、依据、诊断与失败原因；不重新计算。
- 一次求值产生同一份模型快照，参数、数值、图表和表格都读取该快照。单个模型失败只影响自身及其展示，其他模型和元素继续工作。

## 规模限制

| 项 | v1/v2 上限 | v3–v5 上限 |
| --- | ---: | ---: |
| 原始 JSON | 64 KiB | 64 KiB |
| JSON 嵌套深度 | 16 | 16 |
| Card 元素 | 50 | 80 |
| 状态变量 | 20 | 20 |
| 派生值 | 20 | 20 |
| 单个选择器选项 | 20 | 20 |
| 语义模型（v5） | — | 4；预算支出 20、成本方案 10、偏好候选 30、维度 8、筛选 8 |
| 表达式节点总数 | 100（派生） | 300（v3/v4 派生 + 图表/表格内联表达式；v5 为 400） |
| 条件节点总数 | — | 100 |
| 条件嵌套深度 | — | 5 |
| 单条表达式深度 | 8 | 8 |
| 单次重算运算数 | 500 | 500 |
| 每个语义模型运算数（v5） | — | 5000（独立于共享 500 次池） |
| 布局嵌套深度 | — | 4 |
| 标题、标签、选项文本 | 120 字符 | 120 字符 |
| 状态 ID | 32 字符，字母开头，仅字母、数字、下划线 | 同左 |

v4 在 v3 基础上新增：函数曲线每系列采样数 5–50（默认 41）；文档内函数曲线采样总数 200（跨图表、跨嵌套布局累计）；每系列采样运算预算 5000（独立于共享 500 次池）；零点覆盖扩展最多 4 轮（扩展无效时提前停止）；函数表达式节点计入共享的 300 节点预算。

v5 在 v4 基础上新增：语义模型 1–4 个；模型输入与元素表达式共享 400 节点预算；每个模型另有 5000 次运算预算，失败只影响该模型。模型集合、金额量级与权重上限由 `LIMITS` 与校验器统一执行。

## 用户操作与失败行为

- 滑块、输入框和选择器只更新当前 Card 的内存状态，不调用模型、不发送聊天、不发起网络请求。
- 空输入、非有限数、越界数值和不符合步长的数值会显示在对应控件旁；最后一个有效状态继续用于计算。
- 表格排序、筛选只作用于当前 Card 的展示数据，不改变状态或原始数据。
- 模型计算失败（引用不可用、除零、溢出、资源超限等）只在对应模型、数值、图表、表格和 explain 中显示错误；其他模型与元素继续工作，失败值不会显示为 0。
- 每张交互 Card 提供“重置当前界面”，恢复该文档的初始状态并清除本地输入错误。
- 原始 JSON 查看入口保留。协议、引用或挂载失败时显示原始代码块。
- 操作不包含代码回调、表达式字符串、任意事件处理器、任意 HTML/CSS、外部请求或持久化状态。

校验器由 `src/protocol/schema.ts` 生成，执行命令为 `npm run gen-validator`。跨字段语义检查、资源限制和循环依赖检测位于 `src/protocol/validate.ts`；表达式解释器位于 `src/runtime/evaluate.ts`。
