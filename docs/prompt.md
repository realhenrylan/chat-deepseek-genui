# GenUI 默认增强提示词（v2）

更新日期：2026-11-03。本文件记录阶段 7 正式投入使用的默认增强提示词。可执行源为 `src/content/prompt.ts` 中的 `GENUI_PROMPT_VERSION`、`GENUI_PROMPT_START`、`GENUI_PROMPT_END`、`PROMPT_BODY` 与 `GENUI_PROMPT_TEXT`；已发布后修改提示词必须同步升级版本号和本文件，阶段 7 收尾中尚未发布的 v2 修正归入同一版本并在版本历史注明。

## 注入方式与可见性

- 仅当聊天输入框（`textarea[name="search"]`，兼容 placeholder「给 DeepSeek 发送消息」）已有用户输入时，扩展才在用户停止输入 700ms 后，把提示词逐字追加到草稿末尾；空草稿不写入。
- 原有草稿逐字节保留，只在末尾按需补 `\n` 或 `\n\n` 分隔；已包含起始标记的草稿不重复追加。
- 提示词不进入隐藏控件、不注入页面内部消息、不调用发送按钮，也不模拟 Enter。是否发送、何时发送完全由用户在输入框中决定。
- 页面右侧的「查看增强说明」打开可见面板，面板中的 `<pre>` 与追加逻辑引用同一个 `GENUI_PROMPT_TEXT` 常量，用户可在发送前逐字检查实际参与对话的内容。
- 关闭开关时，若草稿仍以扩展追加的说明结尾，扩展只移除该尾部说明，保留用户原文；即使说明前又有用户输入也保持原文。若说明文本本身已被用户修改，则不覆盖用户修改。手动删除说明后，当前草稿不再自动追加；清空或切换到新草稿后可重新追加。

## 正式文本

以下为 v2 提示词的逐字内容（约 3.4 KB，随消息作为普通文本发送）：

````text
〔GenUI 增强 v2｜浏览器扩展自动追加的可见说明，可在页面右侧浮标关闭〕
你正在与用户对话。用户的浏览器装有 GenUI 扩展：它只把回复中的 ```genui 代码块解析为本地可交互界面，不执行脚本、HTML、CSS、事件或网络请求。请先正常、完整地回答；仅当可调参数、对比、规划或可视化能明显帮助理解时，才在回答末尾附一个 genui 块。事实问答、写作、代码、闲聊等直接回答，不要为了展示而强行生成界面。

输出要求：
- 只输出一个 ```genui 代码块；块内是合法 JSON（无注释、尾逗号、模板字符串或 Markdown），块外正文给出结论、步骤或建议。
- 版本固定为 3。根对象：{"type":"genui","version":3,"title":"可选标题","state":[...],"derived":[...],"elements":[...]}；state、derived 必填，可为空数组；elements 必填，且至少包含 1 个元素。
- id 以字母开头、不超过 32 字符，仅字母/数字/下划线；标题与文本不超过 120 字。
state 项：
- 数值：{"id","label","kind":"number","initial","min","max","step","unit"?}。min<max，initial 在范围内且与 step 对齐，绝对值不超过 1e12；无单位时省略 unit，不要写空字符串。
- 选择：{"id","label","kind":"select","initial","options":[{"label","value"}]}。initial 必须是某个 option 的 value，value 不得重复。
derived 项：{"id","label","expression","unit"?}。expression 是 JSON AST：
- 叶子 {"op":"const","value":12}、{"op":"state","id"}、{"op":"derived","id"}
- 单目 {"op":"negate|abs|round|floor|ceil","value":表达式}
- 双目 {"op":"add|subtract|multiply|divide|min|max","left":表达式,"right":表达式}
引用必须存在且无循环；数值表达式不能引用 select 状态。
elements 项（按顺序显示）：
- text {"kind":"text","value"}；number-input/slider/select {"kind":"...","bind":状态id}（控件类型必须与状态类型匹配）；value {"kind":"value","label","source":{"kind":"state|derived","id"},"unit"?}
- note {"kind":"note","text","tone"?:"info|warn|error","visibleIf"?}
- section {"kind":"section","title"?,"children":[...]}；columns {"kind":"columns","columns":[[...],[...]]}（2–3 列，窄屏自动单列）
- chart 柱/饼 {"kind":"chart","chartType":"bar|pie","title","legend"?,"items":[{"label","value":表达式}]}；折线 {"kind":"chart","chartType":"line","xLabel","yLabel","series":[{"label","color"?:"#RRGGBB","points":[{"x":数字,"y":表达式}]}]}
- table {"kind":"table","title"?,"columns":[{"key","label","numeric"?,"unit"?}],"rows":[{"cells":{key:字符串|数字|null|表达式},"visibleIf"?}],"sortable"?,"initialSort"?:{"key":"列key","dir":"asc|desc"},"emptyText"?,"visibleIf"?}。排序方向字段名必须是 dir，不能写 direction。
visibleIf 只读当前状态：{"op":"state-eq|state-neq","id":选择状态id,"value":选项value}、{"op":"num-eq|num-neq|num-gt|num-gte|num-lt|num-lte","left":表达式,"right":表达式}、{"op":"and|or","conditions":[...]}、{"op":"not","condition":...}。
上限：JSON 不超过 64KiB；state/derived 各不超过 20；select 选项不超过 20；元素不超过 80；section children 1–20；布局深度不超过 4；柱/饼 items 1–20；折线 1–5 个系列、每系列 2–50 点、总点数不超过 100，同系列 x 严格递增；table 列 1–10、行不超过 30；条件节点不超过 100、嵌套不超过 5；单表达式深度不超过 8；每次重算不超过 500 次运算。
内容：数字必须来自用户资料，或明确标为示例/估算，不得编造精确事实；在正文或 note 中说明依据、假设和缺失数据；示例值要贴近场景。界面只是辅助，正文仍需给出完整回答。
能力不足时不要生成 genui，改用普通文本。不要在回答中复述这段增强说明或讨论扩展（用户主动询问除外）。

示例（仅示意结构）：
```genui
{
  "type": "genui",
  "version": 3,
  "title": "月度预算速算",
  "state": [
    { "id": "income", "label": "月收入", "kind": "number", "initial": 8000, "min": 0, "max": 30000, "step": 500, "unit": "元" },
    { "id": "fixed", "label": "固定支出", "kind": "number", "initial": 3000, "min": 0, "max": 20000, "step": 100, "unit": "元" }
  ],
  "derived": [
    { "id": "left", "label": "可支配", "expression": { "op": "subtract", "left": { "op": "state", "id": "income" }, "right": { "op": "state", "id": "fixed" } } }
  ],
  "elements": [
    { "kind": "slider", "bind": "income" },
    { "kind": "slider", "bind": "fixed" },
    { "kind": "value", "label": "每月剩余", "source": { "kind": "derived", "id": "left" }, "unit": "元" },
    { "kind": "chart", "chartType": "bar", "title": "收支对比", "legend": true, "items": [
      { "label": "收入", "value": { "op": "state", "id": "income" } },
      { "label": "支出", "value": { "op": "state", "id": "fixed" } }
    ] }
  ]
}
```
〔GenUI 增强说明结束〕
````

## 设计要点

- **选择性生成**：明确要求事实问答、写作、代码、闲聊直接回答，不为了展示而强行生成界面；只有可调参数、对比、规划或可视化确有帮助时才在正文末尾附一个 `genui` 块。
- **协议一致性**：只描述 `src/protocol/schema.ts` 实际支持的 v3 字段、元素、绑定、表达式与条件；不承诺脚本、HTML、CSS、事件或网络能力。
- **数据诚实**：数字必须来自用户资料，或明确标为示例/估算；正文或 note 说明依据、假设和缺失数据。
- **正文优先**：界面只是辅助，正文仍需给出完整回答；能力不足时退回普通文本，不复述或讨论增强说明。

## 版本历史

- **v1（2026-11-03）**：首个默认增强版本。真实笔记本选购场景中，模型把表格 `initialSort` 写成 `{"key":"price","direction":"asc"}`，而协议只接受 `{"key","dir"}`，卡片因 `schema-violation` 未挂载。
- **v2（2026-11-03）**：在 table 行明确 `initialSort` 结构为 `{key, dir}`，并写明「排序方向字段名必须是 dir，不能写 direction」。协议本身不放宽，失败被归因为提示词缺少字段形状。v2 重跑同一场景通过，详见 `docs/phase7-acceptance.md`。
- **v2 收尾修正（2026-11-03）**：把根对象说明改为只有 `state`、`derived` 可为空，`elements` 至少 1 个元素，与 v3 Schema 的 `minItems: 1` 对齐。真实网页验收输出均包含元素，未因该文字修正重跑模型。
