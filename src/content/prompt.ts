/**
 * 智能界面默认增强提示词（v4.0）。
 *
 * v4.0 重大升级（智能界面自然穿插）：
 * - 引入 w1 轻量内联组件协议：单组件单块，无样板代码，随文字流式自然穿插（0–3 个）；
 * - 7 种原子内联组件：quiz（选择题）、card（概念卡）、compare（方案对比）、
 *   checklist（任务清单）、slider（快速滑块）、result（关键指标）、note（提示贴片）；
 * - 废弃“仅在末尾输出一个块”与“正文保持 1-3 句”的陈旧约束，正文可充分展开，组件就地配合；
 * - 复杂多变量连续联动、函数曲线与模型测算保留 v5 综合看板协议；
 * - 保持对历史版本（v3.2/v3.1/v3.0）草稿标记与文本的逐字兼容识别。
 */

export type GenuiPromptMode = 'auto' | 'tool' | 'plain';

export const GENUI_PROMPT_VERSION = '4.0';

export const GENUI_PROMPT_START =
  '〔GenUI 智能界面 v4.0｜浏览器扩展自动追加的可见说明，可在页面右侧浮标关闭〕';

export const GENUI_PROMPT_TOOL_START =
  '〔GenUI 本轮生成工具 v4.0｜浏览器扩展自动追加的可见说明，可在页面右侧浮标改回自动适配〕';

export const GENUI_PROMPT_END = '〔GenUI 增强说明结束〕';

/** 历史版本标记用于安全识别旧草稿，避免重复追加或模式切换时误改/误删。 */
export const GENUI_PROMPT_V32_START =
  '〔GenUI 增强 v3.2｜浏览器扩展自动追加的可见说明，可在页面右侧浮标关闭〕';
export const GENUI_PROMPT_TOOL_V32_START =
  '〔GenUI 本轮生成工具 v3.2｜浏览器扩展自动追加的可见说明，可在页面右侧浮标改回自动适配〕';
export const GENUI_TOOL_PROMPT_V32_START = GENUI_PROMPT_TOOL_V32_START;
export const GENUI_PROMPT_V31_START =
  '〔GenUI 增强 v3.1｜浏览器扩展自动追加的可见说明，可在页面右侧浮标关闭〕';
export const GENUI_PROMPT_TOOL_V31_START =
  '〔GenUI 本轮生成工具 v3.1｜浏览器扩展自动追加的可见说明，可在页面右侧浮标改回自动适配〕';
export const GENUI_PROMPT_V30_START =
  '〔GenUI 增强 v3.0｜浏览器扩展自动追加的可见说明，可在页面右侧浮标关闭〕';
export const GENUI_PROMPT_TOOL_V30_START =
  '〔GenUI 本轮生成工具 v3.0｜浏览器扩展自动追加的可见说明，可在页面右侧浮标改回自动适配〕';
export const GENUI_TOOL_PROMPT_V30_START = GENUI_PROMPT_TOOL_V30_START;

/** 原 v3.2 完整文本主体，用于保持历史版本哈希与未编辑草稿识别逐字一致。 */
const PROMPT_BODY_V32 = `你正在与用户对话。用户的浏览器装有 GenUI 扩展：它只把回复中的 \`\`\`genui 代码块解析为本地可交互界面，不执行脚本、HTML、CSS、事件或网络请求。请根据问题选择表达方式：仅当可调参数、对比、规划或可视化能明显帮助理解时才生成 genui；正文与界面共同构成完整回答。事实问答、写作、代码、闲聊等直接回答，不要为了展示而强行生成界面。

内容分工（生成前先确定每项信息的主要呈现位置）：
- 不生成界面时，用普通文字完整回答。生成界面时，正文通常用 1–3 句给出核心结论、关键理由或操作提示；必要的推导、限制，以及用户明确要求的详细解释仍应保留，不为缩短正文而省略。
- 界面承载可调参数、联动结果、图表及适合排序筛选的详细对比表。不要先在正文逐项讲完规格、数据或计算明细，再在界面中重复一遍；也不要在界面 text/note 中复制正文长段落，或在块后再写一份相同总结。必要的标签、单位和简短结论可以复用。
- 比较问题优先用简短选型结论配一份详细对比表，不再逐行复述表格；计算与规划问题把参数和动态结果放入界面；学习问题在正文解释原理，在界面探索变化。若界面仅把正文改装成静态卡片、没有额外阅读或探索价值，就省略界面。
- 随参数变化的数值通过 state/derived 在界面展示，不在正文或静态 text/note 中写死为“当前结果”；正文若引用初始结果，明确它只对应初始条件。

输出要求：
- 需要界面时，只输出一个 \`\`\`genui 代码块，放在内容自然衔接的位置；块内是合法 JSON（无注释、尾逗号、模板字符串或 Markdown），块外正文与界面按上述分工互补。
- 版本固定为 5。根对象：{"type":"genui","version":5,"title":"可选标题","state":[...],"derived":[...],"models":[...],"elements":[...]}；state、derived、models、elements 必填，前三者可为空数组，models 为 0–4 个；elements 必填，且至少包含 1 个元素。
- id 以字母开头、不超过 32 字符，仅字母/数字/下划线；标题与文本不超过 120 字。
state 项：
- 数值：{"id","label","kind":"number","initial","min","max","step","unit"?}。min<max，initial 与 max 均在范围内且与 min、step 对齐（即 initial 与 max 必须等于 min + 整数倍 step；建议 min 设为 0 或 step 的整数倍，避免步长偏移），绝对值不超过 1e12；无单位时省略 unit，不要写空字符串。
- 选择：{"id","label","kind":"select","initial","options":[{"label","value"}]}。initial 必须是某个 option 的 value，value 不得重复。
derived 项：{"id","label","expression","unit"?}。expression 是 JSON AST：
- 叶子 {"op":"const","value":12}、{"op":"state","id"}、{"op":"derived","id"}（derived 不能引用 model）
- 单目 {"op":"negate|abs|round|floor|ceil","value":表达式}
- 双目 {"op":"add|subtract|multiply|divide|min|max","left":表达式,"right":表达式}
引用必须存在且无循环；数值表达式不能引用 select 状态；图表、预算/成本、条件比对与二元运算等处的表达式位置均允许直接写数字字面量，无需手动包裹 const。
models 项（v5 语义能力；按数组顺序计算，只可引用更早模型；最多 4 个）。模型输入表达式可含 {"op":"model","model":"模型id","key":"标量"}，只能引用更早模型的标量；derived 不能引用模型。标量键固定为：预算 income/expenses/balance/overspend/usage/itemCount；成本 horizon/planCount/lowestTotalCost/lowestUnitCost；偏好 candidateCount/eligibleCount/rankedCount/topScore/weightTotal/dimensionCount。
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

示例（仅示意结构；正文可简短提示“调整收入和固定支出，查看每月剩余变化”，不再列一份相同收支明细）：
\`\`\`genui
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
\`\`\``;

/**
 * v4.0 提示词：全面支持自然穿插排版（w1 内联组件）与综合看板（v5 协议）。
 */
const PROMPT_BODY = `你正在与用户对话。用户的浏览器装有 GenUI 扩展：它会把回复中的 \`\`\`genui 代码块解析为本地可交互界面，不执行任意脚本、HTML、CSS 或网络请求。请根据问题自然融合交互元素：在文字讲解中自然穿插轻量小组件（如单选题、小卡片、方案对比、清单、滑块、关键结果、提示框），或在需要综合测算时使用完整看板。事实问答、写作、代码、闲聊等直接用普通文字回答，不要为了展示而强行生成界面。

内容分工与穿插排版：
- 自然穿插（推荐）：单次回答可根据内容逻辑穿插 0 到 3 个轻量小组件。在概念解释后配 card 或 compare；在步骤指引后配 checklist；在测试理解时配 quiz；在参数测算时配 slider 或 result；在注意事项处配 note。小组件紧密嵌入在自然段落之间，正文无需为了压缩而刻意变成简短几句，可正常展开详实解释与推导。
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
\`\`\`genui
{
  "w": "compare",
  "title": "方案对比",
  "highlight": "方案B",
  "items": [
    { "name": "方案A", "pros": ["起步简单"], "cons": ["扩展性受限"] },
    { "name": "方案B", "pros": ["性能优异", "架构解耦"], "cons": ["学习曲线略陡"] }
  ]
}
\`\`\`

示例 2（纯对比表与柱图，无需计算模型时 models 留空 []）：
\`\`\`genui
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
\`\`\`

示例 3（月度预算综合看板）：
\`\`\`genui
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
\`\`\``;

/** tool 变体首段：能力说明加本轮明确生成意图；其后与 auto 共享同一协议主体。 */
const TOOL_LEAD = '你正在与用户对话。用户的浏览器装有 GenUI 扩展：它会把回复中的 ```genui 代码块解析为本地可交互界面，不执行任意脚本、HTML、CSS 或网络请求。用户已在浮标中明确选择本轮回答工具：优先用 ```genui 代码块把本轮任务表达为可交互界面（可穿插使用轻量组件或综合看板），正文与界面按下方分工互补。纯事实问答、闲聊或过短的请求仍可直接用普通文字回答；现有协议能力确实无法表达任务时不要硬造界面，改用普通文字回答，并简短说明未能生成界面的原因。';

/** 共享协议主体：从 auto 正文截取「内容分工」起至示例结束围栏，保证逐字节一致。 */
const PROTOCOL_BODY = PROMPT_BODY.slice(PROMPT_BODY.indexOf('内容分工与穿插排版'));

/**
 * v3.1 协议主体：用于精确识别旧草稿末尾的未编辑说明。
 */
const SECTION_COLUMNS_V31 =
  '- section {"kind":"section","title"?,"children":[...]}（通过标题与留白组织逻辑分组，避免无意义的多层嵌套）；columns {"kind":"columns","columns":[[...],[...]]}（2–3 列，按卡片容器实际可用宽度自动切换，宽时并列、窄栏自动上下单列；推荐将可调参数与核心结果放入 2 列 columns 并列对照，左列参数控件、右列核心 value 与紧邻状态提醒，图表、对比表与 explain 计算依据按阅读层级排在下方，关键说明、警告和假设保持直接可见）';

const SECTION_COLUMNS_V30 =
  '- section {"kind":"section","title"?,"children":[...]}；columns {"kind":"columns","columns":[[...],[...]]}（2–3 列，窄屏自动单列）';

const BUDGET_COLUMNS_REGEX =
  / {4}\{\r?\n {6}"kind": "columns",\r?\n {6}"columns": \[\r?\n {8}\[\r?\n {10}\{ "kind": "slider", "bind": "income" \},\r?\n {10}\{ "kind": "slider", "bind": "fixed" \}\r?\n {8}\],\r?\n {8}\[\r?\n {10}\{ "kind": "value", "label": "每月剩余", "source": \{ "kind": "model", "model": "monthly", "key": "balance" \}, "unit": "元", "emphasis": "primary" \}\r?\n {8}\]\r?\n {6}\]\r?\n {4}\},/;

const BUDGET_COLUMNS_V30 = [
  '    { "kind": "slider", "bind": "income" },',
  '    { "kind": "slider", "bind": "fixed" },',
  '    { "kind": "value", "label": "每月剩余", "source": { "kind": "model", "model": "monthly", "key": "balance" }, "unit": "元", "emphasis": "primary" },',
].join('\n');

const TOOL_LEAD_V3X = '你正在与用户对话。用户的浏览器装有 GenUI 扩展：它只把回复中的 ```genui 代码块解析为本地可交互界面，不执行脚本、HTML、CSS、事件或网络请求。用户已在浮标中明确选择本轮回答工具：优先用 ```genui 代码块把本轮任务表达为可交互界面，正文与界面按下方分工互补。纯事实问答、闲聊或过短的请求仍可直接用普通文字回答；现有协议能力确实无法表达任务时不要硬造界面，改用普通文字回答，并简短说明未能生成界面的原因。';

const PROMPT_BODY_V31 = PROMPT_BODY_V32
  .replace('默认省略 color，使用随亮暗主题变化的 DeepSeek 蓝与中性色；只有数据含义明确需要指定颜色时才写 color。', '')
  .replace('前三者可为空数组，models 为 0–4 个；', '前两者可为空数组，models 为 1–4 个；')
  .replace('initial 与 max 均在范围内且与 min、step 对齐（即 initial 与 max 必须等于 min + 整数倍 step；建议 min 设为 0 或 step 的整数倍，避免步长偏移）', 'initial 在范围内且与 step 对齐')
  .replace('；图表、预算/成本、条件比对与二元运算等处的表达式位置均允许直接写数字字面量，无需手动包裹 const', '')
  .replace('weight 可写数字常量（0–1000）或引用 state/derived/更早模型；', 'weight 可写数字常量或引用 state/derived/更早模型，运行时按 0–1000 截断并给出警告；')
  .replace('"initialSort"?:{"key":"列key（必须是 columns 中已声明的 key）","dir":"asc|desc"}', '"initialSort"?:{"key":"列key","dir":"asc|desc"}');
const PROTOCOL_BODY_V31 = PROMPT_BODY_V31.slice(PROMPT_BODY_V31.indexOf('内容分工'));
export const GENUI_PROMPT_V31_TEXT = `${GENUI_PROMPT_V31_START}\n${PROMPT_BODY_V31}\n${GENUI_PROMPT_END}`;
export const GENUI_TOOL_PROMPT_V31_TEXT = `${GENUI_PROMPT_TOOL_V31_START}\n${TOOL_LEAD_V3X}\n\n${PROTOCOL_BODY_V31}\n${GENUI_PROMPT_END}`;

const PROMPT_BODY_V30 = PROMPT_BODY_V31
  .replace(SECTION_COLUMNS_V31, SECTION_COLUMNS_V30)
  .replace(BUDGET_COLUMNS_REGEX, BUDGET_COLUMNS_V30);

const PROTOCOL_BODY_V30 = PROMPT_BODY_V30.slice(PROMPT_BODY_V30.indexOf('内容分工'));

export const GENUI_PROMPT_V30_TEXT = `${GENUI_PROMPT_V30_START}\n${PROMPT_BODY_V30}\n${GENUI_PROMPT_END}`;
export const GENUI_TOOL_PROMPT_V30_TEXT = `${GENUI_PROMPT_TOOL_V30_START}\n${TOOL_LEAD_V3X}\n\n${PROTOCOL_BODY_V30}\n${GENUI_PROMPT_END}`;

export const GENUI_PROMPT_V32_TEXT = `${GENUI_PROMPT_V32_START}\n${PROMPT_BODY_V32}\n${GENUI_PROMPT_END}`;
export const GENUI_TOOL_PROMPT_V32_TEXT = `${GENUI_PROMPT_TOOL_V32_START}\n${TOOL_LEAD_V3X}\n\n${PROMPT_BODY_V32.slice(PROMPT_BODY_V32.indexOf('内容分工'))}\n${GENUI_PROMPT_END}`;

/** 完整、逐字可见的默认增强文本。UI 面板与追加逻辑必须引用同一常量。 */
export const GENUI_PROMPT_TEXT = `${GENUI_PROMPT_START}\n${PROMPT_BODY}\n${GENUI_PROMPT_END}`;

/** tool 模式的完整增强文本。UI 面板与追加逻辑必须引用同一常量。 */
export const GENUI_TOOL_PROMPT_TEXT = `${GENUI_PROMPT_TOOL_START}\n${TOOL_LEAD}\n\n${PROTOCOL_BODY}\n${GENUI_PROMPT_END}`;

/** plain 模式不追加任何文本；浮标面板用这段说明代替逐字内容展示。 */
export const GENUI_PLAIN_PROMPT_NOTE =
  '本轮选择「普通回答」：发送消息时不会在后台附加 GenUI 增强协议。';

/** 修复请求的短触发文本：只写入输入框，完整诊断详情由拦截器在发送时静默附加。 */
export const SHORT_REPAIR_TRIGGER_TEXT = '请修复上一条回答中的 GenUI 界面代码块格式错误。';

/** 静默修复详情的边界标记：随用户消息进入历史，但会由响应剥离与 DOM 兜底移除。 */
export const GENUI_REPAIR_DETAIL_START = '〔GenUI 修复请求详情｜仅模型可见〕';
export const GENUI_REPAIR_DETAIL_END = '〔GenUI 修复请求结束〕';

/** 修复详情正文的自校验标记：只有扩展拼装的详情块才带有匹配的校验码。 */
const REPAIR_CHECKSUM_PREFIX = '〔GenUI 修复详情校验：';
/** 比较时忽略空白差异（渲染后的 Markdown 会折叠换行）。 */
function normalizeBlockText(value: string): string {
  return value.replace(/\s+/g, '');
}

/** 去空白后的校验标记：正文先归一化再查找时必须使用这个形式。 */
const NORMALIZED_REPAIR_CHECKSUM_PREFIX = normalizeBlockText(REPAIR_CHECKSUM_PREFIX);

/**
 * 修复详情正文的校验码（FNV-1a 32 位，按去空白后的正文计算）。
 *
 * 目的不是防篡改，而是把「扩展拼装的块」与「用户自己写的同形文字」区分开：
 * 用户引用首尾标记或模仿固定开头时不会带出正确校验码，历史清洗因此保留原文。
 */
function repairDetailsChecksum(normalized: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

interface GenuiProtocolBlock {
  start: string;
  end: string;
  text: string;
  normalized: string;
}

/**
 * 所有已知版本的协议全文。
 *
 * 注入使用这些常量，因此历史清洗可以按「完整文本」校验：
 * 只有尾部块与某个已知版本逐字相等（或仅空白差异）时才删除。
 * 用户可以放心引用标记文本而不担心自己的消息被截断。
 */
const GENUI_PROTOCOL_BLOCKS: ReadonlyArray<GenuiProtocolBlock> = [
  GENUI_PROMPT_TEXT,
  GENUI_TOOL_PROMPT_TEXT,
  GENUI_PROMPT_V32_TEXT,
  GENUI_TOOL_PROMPT_V32_TEXT,
  GENUI_PROMPT_V31_TEXT,
  GENUI_TOOL_PROMPT_V31_TEXT,
  GENUI_PROMPT_V30_TEXT,
  GENUI_TOOL_PROMPT_V30_TEXT,
].map((text) => ({
  start: text.slice(0, text.indexOf('\n')),
  end: GENUI_PROMPT_END,
  text,
  normalized: normalizeBlockText(text),
}));

export interface StripGenuiPromptResult {
  text: string;
  stripped: boolean;
}

export interface StripGenuiPromptOptions {
  /**
   * 放宽「块起点必须位于行首」的约束。
   *
   * 仅用于 DOM 兜底：渲染后的 Markdown 段落边界不会反映在 `textContent` 里，
   * 用户原文与块起点之间可能没有换行。网络层与文本场景仍使用严格模式。
   */
  relaxedBoundary?: boolean;
}

function isLineBoundary(tail: string, index: number, relaxed: boolean): boolean {
  if (relaxed) return true;
  const before = index > 0 ? tail[index - 1] : '\n';
  return before === '\n' || before === '\r' || before === ' ' || before === '\t';
}

function isVerifiedProtocolBlock(candidate: string, block: GenuiProtocolBlock): boolean {
  if (candidate === block.text) return true;
  return normalizeBlockText(candidate) === block.normalized;
}

/**
 * 校验标记之间确实是一份由扩展拼装的修复详情。
 *
 * 详情块末尾带有按正文计算的校验码；用户只引用首尾标记、或模仿固定开头时
 * 校验码对不上，清洗会保留原文。
 */
function isVerifiedRepairDetails(content: string): boolean {
  const normalized = normalizeBlockText(content);
  // 正文在比较前已去掉空白，标记本身也要按去空白后的形式查找。
  const checksumIndex = normalized.lastIndexOf(NORMALIZED_REPAIR_CHECKSUM_PREFIX);
  if (checksumIndex <= 0 || !normalized.endsWith('〕')) return false;
  const declared = normalized.slice(checksumIndex + NORMALIZED_REPAIR_CHECKSUM_PREFIX.length, -1);
  if (declared === '' || !/^[0-9a-z]+$/.test(declared)) return false;
  const body = normalized.slice(0, checksumIndex);
  if (body === '') return false;
  return repairDetailsChecksum(body) === declared;
}

/** 找到尾部可验证的扩展块起点；找不到返回 -1。 */
function findVerifiedTailStart(tail: string, relaxed: boolean): number {
  let bestStart = -1;

  for (const block of GENUI_PROTOCOL_BLOCKS) {
    if (!tail.endsWith(block.end)) continue;
    let index = tail.lastIndexOf(block.start);
    while (index >= 0) {
      if (
        isLineBoundary(tail, index, relaxed) &&
        isVerifiedProtocolBlock(tail.slice(index), block)
      ) {
        if (index > bestStart) bestStart = index;
        break;
      }
      index = index > 0 ? tail.lastIndexOf(block.start, index - 1) : -1;
    }
  }

  if (tail.endsWith(GENUI_REPAIR_DETAIL_END)) {
    const contentEnd = tail.length - GENUI_REPAIR_DETAIL_END.length;
    let index = tail.lastIndexOf(GENUI_REPAIR_DETAIL_START);
    while (index >= 0) {
      if (index < contentEnd) {
        const content = tail.slice(index + GENUI_REPAIR_DETAIL_START.length, contentEnd);
        if (isLineBoundary(tail, index, relaxed) && isVerifiedRepairDetails(content)) {
          if (index > bestStart) bestStart = index;
          break;
        }
      }
      index = index > 0 ? tail.lastIndexOf(GENUI_REPAIR_DETAIL_START, index - 1) : -1;
    }
  }

  return bestStart;
}

/**
 * 从消息文本末尾移除扩展附加的 GenUI 协议块或修复详情块。
 *
 * 只有尾部块与某个已知版本的完整文本逐字相等（允许空白差异）时才删除协议块；
 * 修复详情块要求首尾标记完整且校验码与正文一致。用户引用首尾标记、模仿固定
 * 开头时校验码对不上，原文会被保留。连续相邻的多个块（如修复详情 + 协议说明）
 * 会被逐个移除；对已清洗文本再次调用是幂等的。
 *
 * 已知取舍：「用户把完整的 3500 字协议、或一段带合法校验码的修复块逐字粘贴在
 * 消息最末尾」属于极端假想场景，不为此引入消息身份索引；这类文本会被视为
 * 扩展追加内容而剥离。
 */
export function stripGenuiPrompt(
  value: string,
  options: StripGenuiPromptOptions = {},
): StripGenuiPromptResult {
  if (typeof value !== 'string' || value === '') {
    return { text: value, stripped: false };
  }
  const relaxed = options.relaxedBoundary === true;
  let current = value;
  let stripped = false;
  for (;;) {
    const tail = current.replace(/[ \t\r\n]+$/, '');
    const index = findVerifiedTailStart(tail, relaxed);
    if (index < 0) break;
    current = tail.slice(0, index).replace(/[ \t\r\n]+$/, '');
    stripped = true;
  }
  return stripped ? { text: current, stripped: true } : { text: value, stripped: false };
}

/**
 * 用边界标记包裹修复详情，并附带按正文计算的校验码。
 *
 * 校验码让响应剥离与 DOM 兜底能确认「这段文字确实是扩展拼装的」，
 * 而不是用户自己引用标记或模仿固定开头写出来的同形内容。
 */
export function wrapRepairDetails(details: string): string {
  const body = details.replace(/\s+$/, '');
  const checksum = repairDetailsChecksum(normalizeBlockText(body));
  return `${GENUI_REPAIR_DETAIL_START}\n${body}\n${REPAIR_CHECKSUM_PREFIX}${checksum}〕\n${GENUI_REPAIR_DETAIL_END}`;
}

/** 发送时把暂存的修复详情合并到短触发文本之后；已包含详情时不重复追加。 */
export function mergeRepairDetails(prompt: string, details: string | null | undefined): string {
  if (!details || details.trim() === '') return prompt;
  if (!prompt.includes(SHORT_REPAIR_TRIGGER_TEXT)) return prompt;
  if (prompt.includes(GENUI_REPAIR_DETAIL_START)) return prompt;
  const separator = prompt.endsWith('\n\n') ? '' : prompt.endsWith('\n') ? '\n' : '\n\n';
  return `${prompt}${separator}${wrapRepairDetails(details)}`;
}

/** 读取某个本轮模式对应的完整说明文本；plain 不追加，返回 null。 */
export function getGenuiPromptTextForMode(mode: GenuiPromptMode): string | null {
  if (mode === 'tool') return GENUI_TOOL_PROMPT_TEXT;
  if (mode === 'plain') return null;
  return GENUI_PROMPT_TEXT;
}

export interface AppendPromptResult {
  value: string;
  inserted: boolean;
  userLength: number;
}

export function appendGenuiPrompt(value: string, mode: GenuiPromptMode = 'auto'): AppendPromptResult {
  const text = getGenuiPromptTextForMode(mode);
  if (text === null || value.trim() === '' || hasGenuiPrompt(value)) {
    return { value, inserted: false, userLength: value.length };
  }
  const separator = value.endsWith('\n\n') ? '' : value.endsWith('\n') ? '\n' : '\n\n';
  return { value: value + separator + text, inserted: true, userLength: value.length };
}

export function hasGenuiPrompt(value: string): boolean {
  if (typeof value !== 'string') return false;
  return (
    value.includes(GENUI_PROMPT_START) ||
    value.includes(GENUI_PROMPT_TOOL_START) ||
    value.includes(GENUI_PROMPT_V32_START) ||
    value.includes(GENUI_PROMPT_TOOL_V32_START) ||
    value.includes(GENUI_PROMPT_V31_START) ||
    value.includes(GENUI_PROMPT_TOOL_V31_START) ||
    value.includes(GENUI_PROMPT_V30_START) ||
    value.includes(GENUI_PROMPT_TOOL_V30_START)
  );
}

export interface GenuiDraftPromptInfo {
  kind: 'none' | 'intact' | 'edited';
  suffix?: string;
  start?: string;
}

export function describeGenuiDraftPrompt(value: string): GenuiDraftPromptInfo {
  const candidateStarts = [
    GENUI_PROMPT_START,
    GENUI_PROMPT_TOOL_START,
    GENUI_PROMPT_V32_START,
    GENUI_PROMPT_TOOL_V32_START,
    GENUI_PROMPT_V31_START,
    GENUI_PROMPT_TOOL_V31_START,
    GENUI_PROMPT_V30_START,
    GENUI_PROMPT_TOOL_V30_START,
  ];
  let startIndex = -1;
  let matchingStart: string | undefined;

  for (const s of candidateStarts) {
    const idx = value.lastIndexOf(s);
    if (idx > startIndex) {
      startIndex = idx;
      matchingStart = s;
    }
  }

  if (startIndex < 0 || matchingStart === undefined) return { kind: 'none' };

  if (value.endsWith(GENUI_PROMPT_TEXT) && startIndex === value.length - GENUI_PROMPT_TEXT.length) {
    return { kind: 'intact', suffix: GENUI_PROMPT_TEXT, start: GENUI_PROMPT_START };
  }
  if (value.endsWith(GENUI_TOOL_PROMPT_TEXT) && startIndex === value.length - GENUI_TOOL_PROMPT_TEXT.length) {
    return { kind: 'intact', suffix: GENUI_TOOL_PROMPT_TEXT, start: GENUI_PROMPT_TOOL_START };
  }

  if (value.endsWith(GENUI_PROMPT_V32_TEXT) && startIndex === value.length - GENUI_PROMPT_V32_TEXT.length) {
    return { kind: 'intact', suffix: GENUI_PROMPT_V32_TEXT, start: GENUI_PROMPT_V32_START };
  }
  if (value.endsWith(GENUI_TOOL_PROMPT_V32_TEXT) && startIndex === value.length - GENUI_TOOL_PROMPT_V32_TEXT.length) {
    return { kind: 'intact', suffix: GENUI_TOOL_PROMPT_V32_TEXT, start: GENUI_TOOL_PROMPT_V32_START };
  }

  if (value.endsWith(GENUI_PROMPT_V31_TEXT) && startIndex === value.length - GENUI_PROMPT_V31_TEXT.length) {
    return { kind: 'intact', suffix: GENUI_PROMPT_V31_TEXT, start: GENUI_PROMPT_V31_START };
  }
  if (value.endsWith(GENUI_TOOL_PROMPT_V31_TEXT) && startIndex === value.length - GENUI_TOOL_PROMPT_V31_TEXT.length) {
    return { kind: 'intact', suffix: GENUI_TOOL_PROMPT_V31_TEXT, start: GENUI_PROMPT_TOOL_V31_START };
  }

  if (value.endsWith(GENUI_PROMPT_V30_TEXT) && startIndex === value.length - GENUI_PROMPT_V30_TEXT.length) {
    return { kind: 'intact', suffix: GENUI_PROMPT_V30_TEXT, start: GENUI_PROMPT_V30_START };
  }
  if (value.endsWith(GENUI_TOOL_PROMPT_V30_TEXT) && startIndex === value.length - GENUI_TOOL_PROMPT_V30_TEXT.length) {
    return { kind: 'intact', suffix: GENUI_TOOL_PROMPT_V30_TEXT, start: GENUI_TOOL_PROMPT_V30_START };
  }

  return {
    kind: 'edited',
    start: matchingStart,
  };
}
