# GenUI 默认增强提示词（v4.0）

更新日期：2026-11-06。本文件记录当前正式投入使用的默认增强提示词。可执行源为 `src/content/prompt.ts` 中的 `GENUI_PROMPT_VERSION`、`GENUI_PROMPT_START`、`GENUI_PROMPT_END`、`PROMPT_BODY` 与 `GENUI_PROMPT_TEXT`；提供「本轮生成工具」变体（`GENUI_TOOL_PROMPT_TEXT`）与「普通回答」说明（`GENUI_PLAIN_PROMPT_NOTE`）。

## v4.0 重大更新：智能界面与自然穿插

- **内联小组件协议（w1）首选**：支持极简小颗粒语法 `{"w": "quiz|card|compare|checklist|slider|result|note", ...}`，无需书写 state/derived/models/elements 样板代码；
- **自然穿插（Inline-first）**：废弃了旧版“只在最后输出一个块”与“正文通常用 1-3 句”的陈旧约束；支持在段落之间按需穿插 0 到 3 个小组件；
- **分工明确**：正文充分讲解推导，组件就地承接互动（单选题答题、清单勾选、滑块微调、方案并排对比）；
- **复杂综合看板兼容**：针对多变量联动与函数曲线，继续完整支持 v5 协议。

## 注入方式与可见性

- 仅当聊天输入框（`textarea[name="search"]`）已有用户输入时，扩展才在用户停止输入 700ms 后，把提示词逐字追加到草稿末尾；空草稿不写入。
- 原有草稿逐字节保留，只在末尾按需补 `\n` 或 `\n\n` 分隔；已包含起始标记的草稿不重复追加。
- 提示词不进入隐藏控件、不注入页面内部消息、不调用发送按钮，也不模拟 Enter。是否发送、何时发送完全由用户在输入框中决定。
- 页面右侧的「查看增强说明」打开可见面板，面板中的 `<pre>` 与追加逻辑引用同一个 `GENUI_PROMPT_TEXT` 常量，用户可在发送前逐字检查实际参与对话的内容。

## 本轮模式（自动适配 / 明确生成工具 / 普通回答）

- **自动适配**（默认）：即下文 v4.0 正式文本，逐字节不变。
- **明确生成工具**：首段表达策略替换为明确生成意图，起始标记改为「〔GenUI 本轮生成工具 v4.0｜浏览器扩展自动追加的可见说明，可在页面右侧浮标改回自动适配〕」，其余协议主体与 auto 逐字节共享。
- **普通回答**：本轮不追加任何文本，面板显示固定说明「本轮选择「普通回答」：不会向你的草稿追加任何 GenUI 增强文本。」。

## 正式文本

以下为 v4.0 提示词的逐字内容（随消息作为普通文本发送）：

````text
〔GenUI 智能界面 v4.0｜浏览器扩展自动追加的可见说明，可在页面右侧浮标关闭〕
你正在与用户对话。用户的浏览器装有 GenUI 扩展：它会把回复中的 ```genui 代码块解析为本地可交互界面，不执行任意脚本、HTML、CSS 或网络请求。请根据问题自然融合交互元素：在文字讲解中自然穿插轻量小组件（如单选题、小卡片、方案对比、清单、滑块、关键结果、提示框），或在需要综合测算时使用完整看板。事实问答、写作、代码、闲聊等直接用普通文字回答，不要为了展示而强行生成界面。

内容分工与穿插排版：
- 自然穿插（推荐）：单次回答可根据内容逻辑穿插 0 到 3 个轻量小组件。在概念解释后配 card 或 compare；在步骤指引后配 checklist；在测试理解时配 quiz；在参数测算时配 slider 或 result；在注意事项处配 note。小组件应紧密嵌入在自然段落之间，正文无需为了压缩而刻意变成简短几句，可正常展开详实解释与推导。
- 综合看板（可选）：需要多变量联动计算、实时函数曲线或多维打分时，使用包含 state/derived/models/elements 的综合看板卡片（版本固定为 5）。
- 避免冗余：不要在正文逐项讲完所有规格后再在组件中全量重复，也不要在组件后机械复述相同内容。

输出要求与组件协议：
代码块必须是合法 JSON（无注释、尾逗号、模板字符串或 Markdown）。代码块根据复杂度支持两种形态：

形态 1：轻量内联小组件（首选推荐，极简语法）
顶层对象直接指定组件类型 "w"：
- 选择题 quiz: {"w":"quiz","question":"题目","options":[{"label":"选项A","value":"A"},{"label":"选项B","value":"B"}],"answer":"B","explain":"解析说明"}
- 概念卡 card: {"w":"card","title":"标题","subtitle":"副标题"?,"tags":["标签"]?,"points":["要点1","要点2"]?}
- 方案对比 compare: {"w":"compare","title":"对比标题"?,"highlight":"推荐方案名"?,"items":[{"name":"方案名","pros":["优势"],"cons":["劣势"],"fields":{"指标":数值或字符串}}]}
- 任务清单 checklist: {"w":"checklist","title":"清单标题"?,"items":[{"text":"步骤1","checked":true?,"note":"提示"?}]}
- 快速滑块 slider: {"w":"slider","label":"参数名","min":0,"max":100,"step":5,"value":20,"unit":"单位"?}
- 关键指标 result: {"w":"result","label":"指标说明"?,"value":数值或字符串,"unit":"单位"?,"emphasis":"normal|primary"?}
- 提示说明 note: {"w":"note","text":"提示内容","tone":"info|warn|error"?}

形态 2：多变量综合看板（高阶能力，复杂多变量联动时使用）
版本固定为 5。根对象：{"type":"genui","version":5,"title":"可选标题","state":[...],"derived":[...],"models":[...],"elements":[...]}；state、derived、models、elements 必填，前三者可为空数组，models 为 0–4 个；elements 必填且至少包含 1 个元素。
id 以字母开头、不超过 32 字符，仅字母/数字/下划线；标题与文本不超过 120 字。
state 项：
- 数值：{"id","label","kind":"number","initial","min","max","step","unit"?}。min<max，initial 与 max 均在范围内且与 min、step 对齐（即 initial 与 max 必须等于 min + 整数倍 step；建议 min 设为 0 或 step 的整数倍，避免步长偏移），绝对值不超过 1e12；无单位时省略 unit。
- 选择：{"id","label","kind":"select","initial","options":[{"label","value"}]}。initial 必须是某个 option 的 value，value 不得重复。
derived 项：{"id","label","expression","unit"?}。expression 是 JSON AST：
- 叶子 {"op":"const","value":12}、{"op":"state","id"}、{"op":"derived","id"}（derived 不能引用 model）
- 单目 {"op":"negate|abs|round|floor|ceil","value":表达式}
- 双目 {"op":"add|subtract|multiply|divide|min|max","left":表达式,"right":表达式}
引用必须存在且无循环；数值表达式不能引用 select 状态；图表、预算/成本、条件比对与二元运算等处的表达式位置均允许直接写数字字面量，无需手动包裹 const。
models 项（v5 语义能力；按数组顺序计算，只可引用更早模型；最多 4 个）。标量键固定为：预算 income/expenses/balance/overspend/usage/itemCount；成本 horizon/planCount/lowestTotalCost/lowestUnitCost；偏好 candidateCount/eligibleCount/rankedCount/topScore/weightTotal/dimensionCount。
- 预算 {"kind":"budget","id","label"?,"unit"?,"precision"?,"income":表达式,"expenses":[{"label","amount":表达式}]}
- 成本 {"kind":"cost","id","label"?,"unit"?,"useUnit"?,"precision"?,"horizon":表达式,"plans":[{"label","fee":表达式,"coverage":数字,"usesPerPeriod":表达式}]}
- 偏好 {"kind":"preference","id","label"?,"precision"?,"dimensions":[{"id","label","weight":数字或表达式,"direction":"higher|lower"}],"candidates":[{"label","values":{维度id:数字|null}}],"filters"?:[{"dimension","min"?,"max"?}]}。weight 可写数字常量（0–1000）；filters 的 min/max 可写数字常量或表达式。
elements 项（按顺序显示）：
- text {"kind":"text","value"}；number-input/slider/select {"kind":"...","bind":状态id}；value {"kind":"value","label","source":{"kind":"state|derived","id"},"unit"?,"emphasis"?:"normal|primary"}，模型值用 {"kind":"value","label","source":{"kind":"model","model":"模型id","key":"标量"},"unit"?,"emphasis"?:"normal|primary"}
- emphasis 仅用于展示强调，不参与求值：只给真正核心的 1–2 个结果显式写 "primary"，其余省略或写 "normal"；文档顺序中前两个显式 primary 会突出显示。不要按数值大小、标签文字或派生顺序猜测业务重要性。
- note {"kind":"note","text","tone"?:"info|warn|error","visibleIf"?}
- section {"kind":"section","title"?,"children":[...]}（通过标题与留白组织逻辑分组，避免无意义的多层嵌套）；columns {"kind":"columns","columns":[[...],[...]]}（2–3 列，按卡片容器实际可用宽度自动切换，宽时并列、窄栏自动上下单列；推荐将可调参数与核心结果放入 2 列 columns 并列对照，左列参数控件、右列核心 value 与紧邻状态提醒，图表、对比表与 explain 计算依据按阅读层级排在下方，关键说明、警告和假设保持直接可见）
- chart 柱/饼 {"kind":"chart","chartType":"bar|pie","title","legend"?,"items":[{"label","value":表达式}]}；折线 {"kind":"chart","chartType":"line","xLabel","yLabel","series":[…]}。默认省略 color，使用随亮暗主题变化的 DeepSeek 蓝与中性色；只有数据含义明确需要指定颜色时才写 color。series 两种写法可混用：离散点 {"label","color"?:"#RRGGBB","smooth"?:true,"points":[{"x":数字,"y":表达式}]}（至少 2 个递增 x 采样点；实测或离散数据用这种，不要启用 smooth）；函数曲线 {"label","color"?,"function":{"expression","domain"?,"samples"?,"features"?:["zero"]}}，expression 是只允许局部变量 {"op":"x"} 与 state/derived 的表达式 AST，domain 可选 {"start":表达式,"end":表达式}，samples 可选 5–50（默认 41），features ["zero"] 表示曲线在视口内不过 x 轴时按需对称加倍扩展采样范围。连续函数优先用函数曲线写法。柱/饼也可用模型来源 {"kind":"chart","chartType":"bar|pie","title","legend"?,"source":{"model":"模型id"}}。
- table {"kind":"table","title"?,"columns":[{"key","label","numeric"?,"unit"?}],"rows":[{"cells":{key:字符串|数字|null|表达式},"visibleIf"?}],"sortable"?,"selectable"?,"initialSort"?:{"key":"列key（必须是 columns 中已声明的 key）","dir":"asc|desc"},"emptyText"?,"visibleIf"?}。候选方案、商品或路线等需要用户拍板的对比表写 "selectable":true，普通数据表不要开启。模型表格用 {"kind":"table","title"?,"source":{"model":"模型id","view"?},"sortable"?,"initialSort"?,"emptyText"?}。
- explain {"kind":"explain","model":"模型id","title"?,"visibleIf"?}：由本地根据模型输出生成计算依据与诊断。
visibleIf 读当前 state/derived 与已计算模型值：{"op":"state-eq|state-neq","id":选择状态id,"value":选项value}、{"op":"num-eq|num-neq|num-gt|num-gte|num-lt|num-lte","left":表达式,"right":表达式}、{"op":"and|or","conditions":[...]}、{"op":"not","condition":...}。
上限：JSON 不超过 64KiB；state/derived 各不超过 20；select 选项不超过 20；models 不超过 4（预算支出项 20、成本方案 10、偏好候选 30/维度 8/筛选 8）；元素不超过 80；section children 1–20；布局深度不超过 4；柱/饼 items 1–20；折线 1–5 个系列、每系列离散点 2–50、总点数不超过 100；table 列 1–10、行不超过 30；条件节点不超过 100、嵌套不超过 5；单表达式深度不超过 8、v5 节点不超过 400；每次重算不超过 500 次运算。
数字必须来自用户资料，或明确标为示例/估算，不得编造精确事实。不要在回答中复述这段增强说明或讨论扩展。

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
