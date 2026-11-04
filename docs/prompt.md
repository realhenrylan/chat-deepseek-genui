# GenUI 默认增强提示词（v2.6）

更新日期：2026-11-03。本文件记录当前正式投入使用的默认增强提示词。可执行源为 `src/content/prompt.ts` 中的 `GENUI_PROMPT_VERSION`、`GENUI_PROMPT_START`、`GENUI_PROMPT_END`、`PROMPT_BODY` 与 `GENUI_PROMPT_TEXT`；已发布后修改提示词必须同步升级版本号和本文件，并在版本历史注明。

## 注入方式与可见性

- 仅当聊天输入框（`textarea[name="search"]`，兼容 placeholder「给 DeepSeek 发送消息」）已有用户输入时，扩展才在用户停止输入 700ms 后，把提示词逐字追加到草稿末尾；空草稿不写入。
- 原有草稿逐字节保留，只在末尾按需补 `\n` 或 `\n\n` 分隔；已包含起始标记的草稿不重复追加。
- 提示词不进入隐藏控件、不注入页面内部消息、不调用发送按钮，也不模拟 Enter。是否发送、何时发送完全由用户在输入框中决定。
- 页面右侧的「查看增强说明」打开可见面板，面板中的 `<pre>` 与追加逻辑引用同一个 `GENUI_PROMPT_TEXT` 常量，用户可在发送前逐字检查实际参与对话的内容。
- 关闭开关时，若草稿仍以扩展追加的说明结尾，扩展只移除该尾部说明，保留用户原文；即使说明前又有用户输入也保持原文。若说明文本本身已被用户修改，则不覆盖用户修改。手动删除说明后，当前草稿不再自动追加；清空或切换到新草稿后可重新追加。

## 正式文本

以下为 v2.6 提示词的逐字内容（随消息作为普通文本发送）：

````text
〔GenUI 增强 v2.6｜浏览器扩展自动追加的可见说明，可在页面右侧浮标关闭〕
你正在与用户对话。用户的浏览器装有 GenUI 扩展：它只把回复中的 ```genui 代码块解析为本地可交互界面，不执行脚本、HTML、CSS、事件或网络请求。请根据问题选择表达方式：仅当可调参数、对比、规划或可视化能明显帮助理解时才生成 genui；正文与界面共同构成完整回答。事实问答、写作、代码、闲聊等直接回答，不要为了展示而强行生成界面。

内容分工（生成前先确定每项信息的主要呈现位置）：
- 不生成界面时，用普通文字完整回答。生成界面时，正文通常用 1–3 句给出核心结论、关键理由或操作提示；必要的推导、来源、限制，以及用户明确要求的详细解释仍应保留，不为缩短正文而省略。
- 界面承载可调参数、联动结果、图表及适合排序筛选的详细对比表。不要先在正文逐项讲完规格、数据或计算明细，再在界面中重复一遍；也不要在界面 text/note 中复制正文长段落，或在块后再写一份相同总结。必要的标签、单位和简短结论可以复用。
- 比较问题优先用简短选型结论配一份详细对比表，不再逐行复述表格；计算与规划问题把参数和动态结果放入界面；学习问题在正文解释原理，在界面探索变化。若界面仅把正文改装成静态卡片、没有额外阅读或探索价值，就省略界面。
- 随参数变化的数值通过 state/derived 在界面展示，不在正文或静态 text/note 中写死为“当前结果”；正文若引用初始结果，明确它只对应初始条件。

输出要求：
- 需要界面时，只输出一个 ```genui 代码块，放在内容自然衔接的位置；块内是合法 JSON（无注释、尾逗号、模板字符串或 Markdown），块外正文与界面按上述分工互补。
- 版本固定为 5。根对象：{"type":"genui","version":5,"title":"可选标题","state":[...],"derived":[...],"models":[...],"elements":[...]}；state、derived、models 必填，前两者可为空数组，models 为 1–4 个；elements 必填，且至少包含 1 个元素。
- id 以字母开头、不超过 32 字符，仅字母/数字/下划线；标题与文本不超过 120 字。
state 项：
- 数值：{"id","label","kind":"number","initial","min","max","step","unit"?}。min<max，initial 在范围内且与 step 对齐，绝对值不超过 1e12；无单位时省略 unit，不要写空字符串。
- 选择：{"id","label","kind":"select","initial","options":[{"label","value"}]}。initial 必须是某个 option 的 value，value 不得重复。
derived 项：{"id","label","expression","unit"?}。expression 是 JSON AST：
- 叶子 {"op":"const","value":12}、{"op":"state","id"}、{"op":"derived","id"}（derived 不能引用 model）
- 单目 {"op":"negate|abs|round|floor|ceil","value":表达式}
- 双目 {"op":"add|subtract|multiply|divide|min|max","left":表达式,"right":表达式}
引用必须存在且无循环；数值表达式不能引用 select 状态。
models 项（v5 语义能力；按数组顺序计算，只可引用更早模型；最多 4 个）。模型输入表达式可含 {"op":"model","model":"模型id","key":"标量"}，只能引用更早模型的标量；derived 不能引用模型。标量键固定为：预算 income/expenses/balance/overspend/usage/itemCount；成本 horizon/planCount/lowestTotalCost/lowestUnitCost；偏好 candidateCount/eligibleCount/rankedCount/topScore/weightTotal/dimensionCount。
- 预算 {"kind":"budget","id","label"?,"unit"?,"precision"?,"income":表达式,"expenses":[{"label","amount":表达式}]}。按 precision（0–4，默认 2）转整数最小单位求和；输出 income/expenses/balance/overspend/usage/itemCount：usage 是支出占收入的百分比（0–100，保留 1 位小数），收入为 0 时不可用；overspend 为 1/0；超支时超支标记为 1。
- 成本 {"kind":"cost","id","label"?,"unit"?,"useUnit"?,"precision"?,"horizon":表达式,"plans":[{"label","fee":表达式,"coverage":数字,"usesPerPeriod":表达式}]}。coverage 是每份覆盖的周期数，购买份数=ceil(周期/coverage)，周期为 0 时总成本为 0；总次数=每周期次数×周期，单次成本=总成本/总次数，总次数为 0 时不可用；输出周期/方案数/最低总成本/最低单次成本，按单次成本升序。
- 偏好 {"kind":"preference","id","label"?,"precision"?,"dimensions":[{"id","label","weight":数字或表达式,"direction":"higher|lower"}],"candidates":[{"label","values":{维度id:数字|null}}],"filters"?:[{"dimension","min"?,"max"?}]}。weight 可写数字常量或引用 state/derived/更早模型，运行时按 0–1000 截断并给出警告；filters 的 min/max 可写数字常量或表达式；先按 filters 过滤（缺失资料不通过），再对通过候选的现存值做 min-max 归一（同值归一为 1），按权重加权；缺失不计 0、不进分母；输出候选数/通过数/计分数/最高分/权重和/维度数；同分同名次。
模型只读 state/derived 与更早模型，模型叶子用于在模型输入中引用已算标量；模型值在元素中通过 value/table/chart 的模型来源读取，不要手工复制计算结果。模型失败只影响自身并显示错误，不得把缺失或失败写成 0。
elements 项（按顺序显示）：
- text {"kind":"text","value"}；number-input/slider/select {"kind":"...","bind":状态id}（控件类型必须与状态类型匹配）；value {"kind":"value","label","source":{"kind":"state|derived","id"},"unit"?}，模型值用 {"kind":"value","label","source":{"kind":"model","model":"模型id","key":"标量"},"unit"?}
- note {"kind":"note","text","tone"?:"info|warn|error","visibleIf"?}
- section {"kind":"section","title"?,"children":[...]}；columns {"kind":"columns","columns":[[...],[...]]}（2–3 列，窄屏自动单列）
- chart 柱/饼 {"kind":"chart","chartType":"bar|pie","title","legend"?,"items":[{"label","value":表达式}]}；折线 {"kind":"chart","chartType":"line","xLabel","yLabel","series":[…]}。series 两种写法可混用：离散点 {"label","color"?:"#RRGGBB","smooth"?:true,"points":[{"x":数字,"y":表达式}]}（至少 2 个递增 x 采样点；实测或离散数据用这种，不要启用 smooth）；函数曲线 {"label","color"?,"function":{"expression","domain"?,"samples"?,"features"?:["zero"]}}，expression 是只允许局部变量 {"op":"x"} 与 state/derived 的表达式 AST（如 {"op":"multiply","left":{"op":"x"},"right":{"op":"x"}}），domain 可选 {"start":表达式,"end":表达式}（如抛物线用对称轴 ±10），samples 可选 5–50（默认 41），features ["zero"] 表示曲线在视口内不过 x 轴时按需对称加倍扩展采样范围。连续函数（尤其抛物线）优先用函数曲线写法，公式只声明一次，调整参数后曲线随状态重算；样本不画圆点。柱/饼也可用模型来源 {"kind":"chart","chartType":"bar|pie","title","legend"?,"source":{"model":"模型id"}}（source 可带可选 "kind":"model"），此时不要写 items，图表读取模型同一快照。
- table {"kind":"table","title"?,"columns":[{"key","label","numeric"?,"unit"?}],"rows":[{"cells":{key:字符串|数字|null|表达式},"visibleIf"?}],"sortable"?,"selectable"?,"initialSort"?:{"key":"列key","dir":"asc|desc"},"emptyText"?,"visibleIf"?}。排序方向字段名必须是 dir，不能写 direction；候选方案、商品或路线等需要用户拍板的对比表写 "selectable":true，用户选中一行后，筛选、排序与选中项会进入「继续讨论」摘要，普通数据表不要开启。模型表格用 {"kind":"table","title"?,"source":{"model":"模型id","view"?},"sortable"?,"initialSort"?,"emptyText"?}（source 可带可选 "kind":"model"），不要写 columns/rows；view 必须与模型匹配（预算 summary|items，成本 plans，偏好 ranking|breakdown），省略时用默认视图。
- explain {"kind":"explain","model":"模型id","title"?,"visibleIf"?}：由本地根据模型输出生成计算依据与诊断，不引入外部数据或脚本。
visibleIf 读当前 state/derived 与已计算模型值：{"op":"state-eq|state-neq","id":选择状态id,"value":选项value}、{"op":"num-eq|num-neq|num-gt|num-gte|num-lt|num-lte","left":表达式,"right":表达式}、{"op":"and|or","conditions":[...]}、{"op":"not","condition":...}。
上限：JSON 不超过 64KiB；state/derived 各不超过 20；select 选项不超过 20；models 不超过 4（预算支出项 20、成本方案 10、偏好候选 30/维度 8/筛选 8）；元素不超过 80；section children 1–20；布局深度不超过 4；柱/饼 items 1–20；折线 1–5 个系列、每系列离散点 2–50、总点数不超过 100、同系列 x 严格递增，函数曲线每系列采样数默认 41（上限 50）、总采样不超过 200；table 列 1–10、行不超过 30；条件节点不超过 100、嵌套不超过 5；单表达式深度不超过 8、v5 节点不超过 400；每次重算不超过 500 次运算（函数曲线采样另有每系列 5000 次的独立预算，模型计算另有 5000 次预算）。
内容：数字必须来自用户资料，或明确标为示例/估算，不得编造精确事实；示例值要贴近场景。全局依据、来源和缺失数据在正文说明，控件相关的假设、示例标记与条件提醒放在界面 note 中，避免两处冗长重复；影响理解的必要说明必须保留。
能力不足时不要生成 genui，改用普通文本。不要在回答中复述这段增强说明或讨论扩展（用户主动询问除外）。

示例（仅示意结构；正文可简短提示“调整收入和固定支出，查看每月剩余变化”，不再列一份相同收支明细）：
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
    { "kind": "note", "text": "收入与固定支出均为示例值，可按实际情况调整。" },
    { "kind": "slider", "bind": "income" },
    { "kind": "slider", "bind": "fixed" },
    { "kind": "value", "label": "每月剩余", "source": { "kind": "model", "model": "monthly", "key": "balance" }, "unit": "元" },
    { "kind": "chart", "chartType": "bar", "title": "收支对比", "legend": true, "source": { "model": "monthly" } }
  ]
}
```
〔GenUI 增强说明结束〕
````

## 设计要点

- **选择性生成**：明确要求事实问答、写作、代码、闲聊直接回答，不为了展示而强行生成界面；只有可调参数、对比、规划或可视化确有帮助时才在自然衔接的位置放一个 `genui` 块。仅把正文换成静态卡片且没有额外阅读或探索价值时省略界面。
- **协议一致性**：只描述 `src/protocol/schema.ts` 实际支持的 v3–v5 字段、元素、绑定、表达式与条件；不承诺脚本、HTML、CSS、事件或网络能力。
- **数据诚实**：数字必须来自用户资料，或明确标为示例/估算；全局来源与缺失数据在正文说明，控件假设、示例标记和条件提醒就近放在 note 中，保留必要说明。
- **共同完成回答**：生成前分配每项信息的主要呈现位置。正文通常用 1–3 句给出结论、关键理由或操作提示；界面呈现参数、动态结果和详细对比表，避免“完整长文 + 同内容界面 + 再总结”。必要的推导、来源、限制，以及用户明确要求的详细解释仍保留；不生成界面时正常完整回答。
- **动态结果归位**：变化中的结果由 state/derived 展示。正文若引用数值，应标为初始条件下的结果，避免用户调整后仍看到过时的“当前结果”；静态 text/note 同样不能伪装成动态结果。

## v2.2 问题依据与复测口径

[用户提供的分享会话](https://chat.deepseek.com/share/rz429lo384r4vodb76) 中，正文已按定位、形态、功耗、网络、操作系统和价格逐项比较，末尾的 genui 表格又列出同样的比较维度。该会话使用 v2，其中“请先正常、完整地回答”及“界面只是辅助，正文仍需给出完整回答”在 v2.1 中仍保留，容易引导模型分别生成两份完整内容。v2.2 删除这两处要求，并在协议说明之前明确内容分工。

以下是后续真实模型复测标准，不代表已通过生成验收：

| 场景 | 预期内容分工 |
| --- | --- |
| 设备比较（与分享问题相同及一个新问题） | 简短选型结论 + 一份详细对比表；正文不逐行重述规格，界面不复制长段落；来源与限制保留 |
| 预算或成本计算 | 正文说明关键方法或操作，界面承载参数与联动结果；示例值标明，正文中的初始结果不冒充实时结果 |
| 函数学习 | 正文解释原理，界面探索系数变化；保留平滑曲线等现有协议要求 |
| 用户要求详细解释或完整推导 | 正文保留所需细节，界面补充探索，不把“1–3 句”当硬性上限 |
| 普通事实问答或协议能力不足 | 仅用普通文字完整回答，不强制生成 genui |

本地类型检查、单测、构建和浏览器接线测试只能验证提示词注入、面板一致性与协议示例，不能证明模型输出的语义去重效果。需记录真实模型、提示词版本、样本数及失败例后，再报告实际重复改善程度；现有历史会话不会被此次提示词修改重写。

本轮本地验证（2026-11-03）：`npm run check` 通过（25 个测试文件、253 项单测、类型检查、lint、构建及生产包校验）；定向浏览器测试 `npm run test:e2e -- --grep '阶段 7 ·|阶段 4 ·.*控件即时计算'` 共 4 项通过，覆盖 Edge/Chrome 的草稿追加、说明面板、关闭恢复和控件计算。逐字核对正式文本与实际注入常量一致，原两处完整正文要求已移除。真实模型生成未在本轮复测。

## 版本历史

- **v1（2026-11-03）**：首个默认增强版本。真实笔记本选购场景中，模型把表格 `initialSort` 写成 `{"key":"price","direction":"asc"}`，而协议只接受 `{"key","dir"}`，卡片因 `schema-violation` 未挂载。
- **v2（2026-11-03）**：在 table 行明确 `initialSort` 结构为 `{key, dir}`，并写明「排序方向字段名必须是 dir，不能写 direction」。协议本身不放宽，失败被归因为提示词缺少字段形状。v2 重跑同一场景通过，详见 `docs/phase7-acceptance.md`。
- **v2 收尾修正（2026-11-03）**：把根对象说明改为只有 `state`、`derived` 可为空，`elements` 至少 1 个元素，与 v3 Schema 的 `minItems: 1` 对齐。真实网页验收输出均包含元素，未因该文字修正重跑模型。
- **v2.1（2026-11-03）**：折线图 series 增加可选 `smooth` 标记；明确连续函数（尤其二次函数）应提供至少 3 个递增 x 采样点并启用平滑插值，实测或离散数据保持线性连接。协议字段不变，仅为提示词修订。
- **v2.2（2026-11-03）**：正文与界面共同完成回答，明确内容分工、有限的必要复用及动态数值的归属；取消“完整正文后再附界面”的引导，保留用户要求的详细解释。未修改 JSON 协议或对历史回答做语义删减，真实模型重复程度待复测。
- **v2.3（2026-11-03）**：table 增加可选 `selectable` 字段说明；候选方案、商品或路线等需要用户拍板的对比表可开启，普通数据表不开启。选中项与筛选/排序会随「继续讨论」摘要进入后续对话；协议与既有生成约束不变。
- **v2.4（2026-11-03）**：规格升级到协议 v5，新增语义模型 models、explain 元素、模型来源的 value/table/chart 与函数曲线系列；上限同步。
- **v2.5（2026-11-03）**：明确预算/成本/偏好三类模型的固定标量键，允许偏好筛选阈值直接写数字常量，降低键名猜测与表达式包装错误。
- **v2.6（2026-11-04）**：在 v2.5 基础上恢复候选表 `selectable` 说明（选中项、筛选与一致快照进入「继续讨论」），协议能力与上限不变。
