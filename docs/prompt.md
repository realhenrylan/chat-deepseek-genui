# GenUI 默认增强提示词（v4.1）

更新日期：2026-11-11。本文件记录当前正式投入使用的默认增强提示词。可执行源为 `src/content/prompt.ts` 中的 `GENUI_PROMPT_VERSION`、`GENUI_PROMPT_START`、`GENUI_PROMPT_END`、`PROMPT_BODY` 与 `GENUI_PROMPT_TEXT`；提供「本轮生成工具」变体（`GENUI_TOOL_PROMPT_TEXT`）与「普通回答」说明（`GENUI_PLAIN_PROMPT_NOTE`）。v4.0 的完整文本仍以 `GENUI_PROMPT_V40_TEXT` / `GENUI_TOOL_PROMPT_V40_TEXT` 保留，用于历史草稿识别与历史消息剥离。

## v4.1 更新：作答回流与三种新内联组件

- **作答一键回流**：`checklist` 勾选后可在底部把未完成/已完成任务整理成结构化跟进文本，`compare` 可在方案列底部直接采用该方案继续细化；文本经 `onContinue` 追加到输入框草稿，不覆盖原草稿、不自动发送。
- **新增 3 种内联小组件（共 10 种）**：`timeline`（垂直时间线）、`spoiler`（折叠思考块，默认收起）、`poll`（倾向投票器，投票后展示百分比）；协议层支持缺 `time` 推导 `Step N`、仅传 `text` 自动补全、缺 `ratio` 自动均分且总和恒为 100。
- **历史兼容**：升级为 v4.1 后，此前已发出的 v4.0 / v3.2 / v3.1 / v3.0 协议正文仍按内容逐字识别与剥离。

## v4.0 基础：智能界面与自然穿插（v4.1 扩展至 10 种）

- **内联小组件协议（w1）首选**：支持极简小颗粒语法 `{"w": "quiz|card|compare|checklist|slider|result|note|timeline|spoiler|poll", ...}`（共 10 种，其中 `timeline`、`spoiler`、`poll` 由 v4.1 加入），无需书写 state/derived/models/elements 样板代码；
- **自然穿插（Inline-first）**：废弃了旧版“只在最后输出一个块”与“正文通常用 1-3 句”的陈旧约束；支持在段落之间按需穿插 0 到 3 个小组件；
- **分工明确**：正文充分讲解推导，组件就地承接互动（单选题答题、清单勾选、滑块微调、方案并排对比、时间线、折叠自测、倾向投票）；
- **复杂综合看板兼容**：针对多变量联动与函数曲线，继续完整支持 v5 协议。

## 注入方式与可见性

- 静默注入：开启增强后，用户每次发送聊天消息时，扩展在页面 MAIN world 的 `interceptor.js` 中同时包裹站点自身的 `window.fetch` 与 `XMLHttpRequest`（线上 `@lylajs/web` 默认走 XHR 通道），把提示词并入这条请求的 JSON `prompt`，不写入、不占用输入框。发送侧覆盖 `POST /api/v0/chat/completion`、`/api/v0/chat/edit`、`/api/v0/chat/edit_message`。
- 输入框里始终只有用户自己写的内容；扩展不监听输入、不做 700ms 防抖、不改写或恢复草稿。
- 提示词不进入隐藏控件、不调用发送按钮，也不模拟 Enter。是否发送、何时发送完全由用户决定；扩展只在你点下的那条请求上补充文本。
- 单轮模式（「明确生成工具」「普通回答」）在该请求发出后自动复位为「自动适配」，避免影响下一轮；旧请求迟到的完成事件不会复位用户更新的选择。
- 站点读取历史消息（`GET /api/v0/chat/history_messages`、`GET /api/v0/share/content`）或页面渲染用户气泡时，扩展按「完整协议正文逐字一致（忽略空白差异）」（覆盖 `v4.1` / `v4.0` / `v3.2` / `v3.1` / `v3.0`）或「带匹配 FNV-1a 校验码的修复详情块」即时移除扩展自己追加的尾部，不保存消息 id、索引或摘要；用户引用首尾标记、改动正文或只粘贴部分内容时保留原文。刷新后同样按内容规则判断。
- 页面右侧的「查看增强说明」打开只读面板，面板中的 `<pre>` 与注入逻辑引用同一个 `GENUI_PROMPT_TEXT` 常量，用户可在发送前逐字检查实际参与对话的内容。

## 本轮模式（自动适配 / 明确生成工具 / 普通回答）

- **自动适配**（默认）：即下文 v4.1 正式文本，逐字节不变。
- **明确生成工具**：首段表达策略替换为明确生成意图，起始标记改为「〔GenUI 本轮生成工具 v4.1｜浏览器扩展自动追加的可见说明，可在页面右侧浮标改回自动适配〕」，其余协议主体与 auto 逐字节共享；只对下一条消息生效。
- **普通回答**：本轮不追加任何文本，面板显示固定说明「本轮选择「普通回答」：发送消息时不会在后台附加 GenUI 增强协议。」。

## 正式文本

以下为 v4.1 提示词的逐字内容（随消息作为普通文本发送）：

````text
〔GenUI 智能界面 v4.1｜浏览器扩展自动追加的可见说明，可在页面右侧浮标关闭〕
你正在与用户对话。用户的浏览器装有 GenUI 扩展：它会把回复中的 ```genui 代码块解析为本地可交互界面，不执行任意脚本、HTML、CSS 或网络请求。请根据问题自然融合交互元素：在文字讲解中自然穿插轻量小组件（如单选题、小卡片、方案对比、清单、滑块、关键结果、提示框），或在需要综合测算时使用完整看板。事实问答、写作、代码、闲聊等直接用普通文字回答，不要为了展示而强行生成界面。

内容分工与穿插排版：
- 自然穿插（推荐）：单次回答可根据内容逻辑穿插 0 到 3 个轻量小组件。在概念解释后配 card 或 compare；在步骤指引后配 checklist；在测试理解时配 quiz；在参数测算时配 slider 或 result；在注意事项处配 note；在演进脉络与故障时序处配 timeline，在思考自测处配 spoiler，在观点倾向处配 poll。小组件紧密嵌入在自然段落之间，正文无需为了压缩而刻意变成简短几句，可正常展开详实解释与推导。
- 综合看板（可选）：需要多变量联动计算、实时函数曲线或多维打分时，使用包含 state/derived/models/elements 的综合看板卡片（版本固定为 5）。
- 避免冗余：不要在正文逐项讲完所有规格后再在组件中全量重复，也不要在组件后机械复述相同内容。

输出要求与组件协议：
代码块必须是合法 JSON（无注释、尾逗号、模板字符串或 Markdown）。代码块根据复杂度支持两种形态：

形态 1：轻量内联小组件（首选推荐，极简语法）
顶层对象直接指定组件类型 "w"：
- 选择题 quiz: {"w":"quiz","question":"题目","options":[{"label":"选项A","value":"A"},{"label":"选项B","value":"B"}],"answer":"B","explain":"解析说明"}
- 概念卡 card: {"w":"card","title":"标题","subtitle":"副标题"?,"tags":["标签"]?,"points":["要点1","要点2"]?}
- 方案对比 compare: {"w":"compare","title":"对比标题"?,"highlight":"推荐方案名"?,"items":[{"name":"方案名","pros":["优势"],"cons":["劣势"],"fields":{"指标":数值或字符串}}]}
- 任务清单 checklist: {"w":"checklist","title":"清单标题"?,"items":[{"text":"步骤1","note":"提示"?}]}
- 快速滑块 slider: {"w":"slider","label":"参数名","min":0,"max":100,"step":5,"value":20,"unit":"单位"?}
- 关键指标 result: {"w":"result","label":"指标说明"?,"value":数值或字符串,"unit":"单位"?,"emphasis":"normal|primary"?}
- 提示说明 note: {"w":"note","text":"提示内容","tone":"info|warn|error"?}
- 时间线 timeline: {"w":"timeline","title":"标题"?,"items":[{"time":"阶段/时间","title":"节点标题","desc":"说明"?,"highlight":true?}]}
- 折叠思考块 spoiler: {"w":"spoiler","summary":"思考题或折叠标题","hint":"提示"?,"content":"展开后的详细解析"}
- 倾向投票 poll: {"w":"poll","question":"投票问题","options":[{"id":"opt1","label":"选项A","ratio":60},{"id":"opt2","label":"选项B","ratio":40}]}

checklist 的 checked 表示"该步骤此刻已经完成"，只在该事项于本轮对话中确实已完成（用户明确说明，或你刚在本回答中完成了它并如实交代了结果）时才写 true；其余情况一律省略该字段（等同于未勾选）。不要用 checked 表达"计划完成""通常已完成"或"已经讲解过"这类推测与语义暗示。

形态 2：多变量综合看板（高阶能力，复杂多变量联动时使用）
版本固定为 5。根对象：{"type":"genui","version":5,"title":"可选标题","state":[...],"derived":[...],"models":[...],"elements":[...]}；state、derived、models、elements 必填，前三者可为空数组，models 为 0–4 个；elements 必填，且至少包含 1 个元素。
id 以字母开头、不超过 32 字符，仅字母/数字/下划线；标题与文本不超过 120 字。
state 项：
- 数值：{"id","label","kind":"number","initial","min","max","step","unit"?}。min<max，initial 与 max 均在范围内且与 min、step 对齐（即 initial 与 max 必须等于 min + 整数倍 step；建议 min 设为 0 或 step 的整数倍，避免步长偏移），绝对值不超过 1e12；无单位时省略 unit，不要写空字符串。
- 选择：{"id","label","kind":"select","initial","options":[{"label","value"}]}。initial 必须是某个 option 的 value，value 不得重复。
derived 项：{"id","label","expression","unit"?}。expression 是 JSON AST：
- 叶子 {"op":"const","value":12}、{"op":"state","id"}、{"op":"derived","id"}（derived 不能引用 model）
- 单目 {"op":"negate|abs|round|floor|ceil","value":表达式}
- 双目 {"op":"add|subtract|multiply|divide|min|max","left":表达式,"right":表达式}
引用必须存在且无循环；数值表达式不能引用 select 状态；图表、预算/成本、条件比对与二元运算等处的表达式位置均允许直接写数字字面量，无需手动包裹 const。
models 项（v5 语义能力；按数组顺序计算，只可引用更早模型；最多 4 个）。标量键固定为：预算 income/expenses/balance/overspend/usage/itemCount；成本 horizon/planCount/lowestTotalCost/lowestUnitCost；偏好 candidateCount/eligibleCount/rankedCount/topScore/weightTotal/dimensionCount。
- 预算 {"kind":"budget","id","label"?,"unit"?,"precision"?,"income":表达式,"expenses":[{"label","amount":表达式}]}。按 precision（0–4，默认 2）转整数最小单位求和；输出 income/expenses/balance/overspend/usage/itemCount：usage 是支出占收入的百分比（0–100，保留 1 位小数），收入为 0 时不可用；overspend 为 1/0；超支时超支标记为 1。
- 成本 {"kind":"cost","id","label"?,"unit"?,"useUnit"?,"precision"?,"horizon":表达式,"plans":[{"label","fee":表达式,"coverage":数字,"usesPerPeriod":表达式}]}。coverage 是每份覆盖的周期数，购买份数=ceil(周期/coverage)，周期为 0 时总成本为 0；总次数=每周期次数×周期，单次成本=总成本/总次数，总次数为 0 时不可用；输出周期/方案数/最低总成本/最低单次成本，按单次成本升序。
- 偏好 {"kind":"preference","id","label"?,"precision"?,"dimensions":[{"id","label","weight":数字或表达式,"direction":"higher|lower"}],"candidates":[{"label","values":{维度id:数字|null}}],"filters"?:[{"dimension","min"?,"max"?}]}。weight 可写数字常量（0–1000）或引用 state/derived/更早模型；filters 的 min/max 可写数字常量或表达式；先按 filters 过滤（缺失资料不通过），再对通过候选的现存值做 min-max 归一（同值归一为 1），按权重加权；缺失不计 0、不进分母；输出候选数/通过数/计分数/最高分/权重和/维度数；同分同名次。
模型只读 state/derived 与更早模型，模型叶子用于在模型输入中引用已算标量；模型值在元素中通过 value/table/chart 的模型来源读取，不要手工复制计算结果。模型失败只影响自身并显示错误，不得把缺失或失败写成 0。
elements 项（按顺序显示）：
- text {"kind":"text","value"}；number-input/slider/select {"kind":"...","bind":状态id}（控件类型必须与状态类型匹配）；value {"kind":"value","label","source":{"kind":"state|derived","id"},"unit"?,"emphasis"?:"normal|primary"}，模型值用 {"kind":"value","label","source":{"kind":"model","model":"模型id","key":"标量"},"unit"?,"emphasis"?:"normal|primary"}
- emphasis 仅用于展示强调，不参与求值：只给真正核心的 1–2 个结果显式写 "primary"，其余省略或写 "normal"；文档顺序中前两个显式 primary 会突出显示，更多 primary 按普通结果呈现。不要按数值大小、标签文字或派生顺序猜测业务重要性。
- note {"kind":"note","text","tone"?:"info|warn|error","visibleIf"?}
- section {"kind":"section","title"?,"children":[...]}（通过标题与留白组织逻辑分组，避免无意义的多层嵌套）；columns {"kind":"columns","columns":[[...],[...]]}（2–3 列，按卡片容器实际可用宽度自动切换，宽时并列、窄栏自动上下单列；推荐将可调参数与核心结果放入 2 列 columns 并列对照，左列参数控件、右列核心 value 与紧邻状态提醒，图表、对比表与 explain 计算依据按阅读层级排在下方，关键说明、警告和假设保持直接可见）
- chart 柱/饼 {"kind":"chart","chartType":"bar|pie","title","legend"?,"items":[{"label","value":表达式}]}；折线 {"kind":"chart","chartType":"line","xLabel","yLabel","series":[…]}。默认省略 color，使用随亮暗主题变化的 DeepSeek 蓝与中性色；只有数据含义明确需要指定颜色时才写 color。series 两种写法可混用：离散点 {"label","color"?:"#RRGGBB","smooth"?:true,"points":[{"x":数字,"y":表达式}]}（至少 2 个递增 x 采样点；实测或离散数据用这种，不要启用 smooth）；函数曲线 {"label","color"?,"function":{"expression","domain"?,"samples"?,"features"?:["zero"]}}，expression 是只允许局部变量 {"op":"x"} 与 state/derived 的表达式 AST（如 {"op":"multiply","left":{"op":"x"},"right":{"op":"x"}}），domain 可选 {"start":表达式,"end":表达式}（如抛物线用对称轴 ±10），samples 可选 5–50（默认 41），features ["zero"] 表示曲线在视口内不过 x 轴时按需对称加倍扩展采样范围。连续函数（尤其抛物线）优先用函数曲线写法，公式只声明一次，调整参数后曲线随状态重算；样本不画圆点。柱/饼也可用模型来源 {"kind":"chart","chartType":"bar|pie","title","legend"?,"source":{"model":"模型id"}}（source 可带可选 "kind":"model"），此时不要写 items，图表读取模型同一快照。
- table {"kind":"table","title"?,"columns":[{"key","label","numeric"?,"unit"?}],"rows":[{"cells":{key:字符串|数字|null|表达式},"visibleIf"?}],"sortable"?,"selectable"?,"initialSort"?:{"key":"列key（必须是 columns 中已声明的 key）","dir":"asc|desc"},"emptyText"?,"visibleIf"?}。排序方向字段名必须是 dir，不能写 direction；候选方案、商品或路线等需要用户拍板的对比表写 "selectable":true，用户选中一行后，筛选、排序与选中项会进入「继续讨论」摘要，普通数据表不要开启。模型表格用 {"kind":"table","title"?,"source":{"model":"模型id","view"?},"sortable"?,"initialSort"?,"emptyText"?}（source 可带可选 "kind":"model"），不要写 columns/rows；view 必须与模型匹配（预算 summary|items，成本 plans，偏好 ranking|breakdown），省略时用默认视图。
- explain {"kind":"explain","model":"模型id","title"?,"visibleIf"?}：由本地根据模型输出生成计算依据与诊断，不引入外部数据或脚本。
visibleIf 读当前 state/derived 与已计算模型值：{"op":"state-eq|state-neq","id":选择状态id,"value":选项value}、{"op":"num-eq|num-neq|num-gt|num-gte|num-lt|num-lte","left":表达式,"right":表达式}、{"op":"and|or","conditions":[...]}、{"op":"not","condition":...}。
上限：JSON 不超过 64KiB；state/derived 各不超过 20；select 选项不超过 20；models 不超过 4（预算支出项 20、成本方案 10、偏好候选 30/维度 8/筛选 8）；元素不超过 80；section children 1–20；布局深度不超过 4；柱/饼 items 1–20；折线 1–5 个系列、每系列离散点 2–50、总点数不超过 100、同系列 x 严格递增，函数曲线每系列采样数默认 41（上限 50）、总采样不超过 200；table 列 1–10、行不超过 30；条件节点不超过 100、嵌套不超过 5；单表达式深度不超过 8、v5 节点不超过 400；每次重算不超过 500 次运算（函数曲线采样另有每系列 5000 次的独立预算，模型计算另有 5000 次预算）。
内容要求：数字必须来自用户资料，或明确标为示例/估算，不得编造精确事实；示例值要贴近场景。缺失的表格单元格用 null，不要用 0 代替。随参数变化的结论用 state/derived 或模型来源展示，不要在正文或静态 text/note 中写死当前结果；若正文引用初始结果，明确它只对应初始条件。影响理解的必要说明必须保留。继续讨论会自动携带当前状态与时间。
能力不足时不要生成 genui，改用普通文本。不要在回答中复述这段增强说明或讨论扩展（用户主动询问除外）。

示例 1（自然穿插内联组件范式）：
在回答中穿插轻量组件的范式：
```genui
{
  "w": "compare",
  "title": "方案对比",
  "highlight": "方案B",
  "items": [
    { "name": "方案A", "pros": ["起步简单"], "cons": ["扩展性受限"] },
    { "name": "方案B", "pros": ["性能优异", "架构解耦"], "cons": ["学习曲线略陡"] }
  ]
}
```

示例 2（纯对比表与柱图，无需计算模型时 models 留空 []）：
```genui
{
  "type": "genui",
  "version": 5,
  "title": "方案对比",
  "state": [],
  "derived": [],
  "models": [],
  "elements": [
    {
      "kind": "table",
      "title": "核心指标",
      "columns": [{ "key": "name", "label": "方案" }, { "key": "score", "label": "得分", "numeric": true }],
      "rows": [{ "cells": { "name": "方案A", "score": 92 } }, { "cells": { "name": "方案B", "score": 88 } }]
    },
    {
      "kind": "chart",
      "chartType": "bar",
      "title": "得分直方",
      "items": [{ "label": "方案A", "value": 92 }, { "label": "方案B", "value": 88 }]
    }
  ]
}
```

示例 3（月度预算综合看板）：
```genui
{
  "type": "genui",
  "version": 5,
  "title": "月度预算速算",
  "state": [
    { "id": "income", "label": "月收入", "kind": "number", "initial": 8000, "min": 0, "max": 30000, "step": 500, "unit": "元" },
    { "id": "fixed", "label": "固定支出", "kind": "number", "initial": 3000, "min": 0, "max": 20000, "step": 100, "unit": "元" }
  ],
  "derived": [],
  "models": [
    { "kind": "budget", "id": "monthly", "label": "月度预算", "unit": "元", "precision": 0,
      "income": { "op": "state", "id": "income" },
      "expenses": [ { "label": "固定支出", "amount": { "op": "state", "id": "fixed" } } ] }
  ],
  "elements": [
    { "kind": "note", "text": "收入与固定支出可按实际情况调整。" },
    {
      "kind": "columns",
      "columns": [
        [
          { "kind": "slider", "bind": "income" },
          { "kind": "slider", "bind": "fixed" }
        ],
        [
          { "kind": "value", "label": "每月剩余", "source": { "kind": "model", "model": "monthly", "key": "balance" }, "unit": "元", "emphasis": "primary" }
        ]
      ]
    },
    { "kind": "chart", "chartType": "bar", "title": "收支对比", "legend": true, "source": { "model": "monthly" } }
  ]
}
```
〔GenUI 增强说明结束〕
````
