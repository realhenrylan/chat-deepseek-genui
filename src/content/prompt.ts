/**
 * 阶段 7：默认增强提示词（v2.5）。
 *
 * v2.5 修订：明确三类模型的固定标量键，并允许偏好筛选阈值直接写数字常量，
 * 降低真实模型首轮输出中的键名猜测与表达式包装错误。
 * v2.4 修订：规格升级到协议 v5——新增本地语义模型 models（预算、成本、偏好），
 * 模型来源的 value/table/chart 与 explain 解释元素，边界语义与上限同步；
 * 其余约定沿用 v2.3。
 * v2.3 修订：规格升级到协议 v4——折线新增函数曲线系列（受限表达式 y=f(x)、
 * 可选定义域与零点覆盖采样），上限与示例同步；其余约定沿用 v2.2。
 * v2.2 修订：正文与界面共同完成回答，按内容分工，避免完整正文后再附一份重复界面；
 * 动态结果留在界面中，正文保留结论、必要解释与来源。
 *
 * 设计约束（docs/development-task.md 阶段 7、docs/compatibility-investigation.md §6）：
 * - 提示词对用户完全可见：它作为普通文本追加在输入框草稿末尾，发送前可逐字检查，
 *   不写入隐藏输入、不注入页面内部消息、不自动发送；
 * - 只描述真实存在的 v5 协议能力（src/protocol/schema.ts + validate.ts），
 *   不承诺脚本、HTML、CSS、事件或网络能力；
 * - 引导模型「适合时才生成界面」，普通问题正常回答；
 * - 与用户已有草稿逐字节隔离：本模块只负责纯字符串追加，绝不裁剪或覆盖原草稿。
 */

export const GENUI_PROMPT_VERSION = 2.5;

/** 用于识别、去重和关闭恢复的稳定标记；修改提示词时同步升级版本号。 */
export const GENUI_PROMPT_START =
  '〔GenUI 增强 v2.5｜浏览器扩展自动追加的可见说明，可在页面右侧浮标关闭〕';
export const GENUI_PROMPT_END = '〔GenUI 增强说明结束〕';

const PROMPT_BODY = `你正在与用户对话。用户的浏览器装有 GenUI 扩展：它只把回复中的 \`\`\`genui 代码块解析为本地可交互界面，不执行脚本、HTML、CSS、事件或网络请求。请根据问题选择表达方式：仅当可调参数、对比、规划或可视化能明显帮助理解时才生成 genui；正文与界面共同构成完整回答。事实问答、写作、代码、闲聊等直接回答，不要为了展示而强行生成界面。

内容分工（生成前先确定每项信息的主要呈现位置）：
- 不生成界面时，用普通文字完整回答。生成界面时，正文通常用 1–3 句给出核心结论、关键理由或操作提示；必要的推导、来源、限制，以及用户明确要求的详细解释仍应保留，不为缩短正文而省略。
- 界面承载可调参数、联动结果、图表及适合排序筛选的详细对比表。不要先在正文逐项讲完规格、数据或计算明细，再在界面中重复一遍；也不要在界面 text/note 中复制正文长段落，或在块后再写一份相同总结。必要的标签、单位和简短结论可以复用。
- 比较问题优先用简短选型结论配一份详细对比表，不再逐行复述表格；计算与规划问题把参数和动态结果放入界面；学习问题在正文解释原理，在界面探索变化。若界面仅把正文改装成静态卡片、没有额外阅读或探索价值，就省略界面。
- 随参数变化的数值通过 state/derived 在界面展示，不在正文或静态 text/note 中写死为“当前结果”；正文若引用初始结果，明确它只对应初始条件。

输出要求：
- 需要界面时，只输出一个 \`\`\`genui 代码块，放在内容自然衔接的位置；块内是合法 JSON（无注释、尾逗号、模板字符串或 Markdown），块外正文与界面按上述分工互补。
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
- table {"kind":"table","title"?,"columns":[{"key","label","numeric"?,"unit"?}],"rows":[{"cells":{key:字符串|数字|null|表达式},"visibleIf"?}],"sortable"?,"initialSort"?:{"key":"列key","dir":"asc|desc"},"emptyText"?,"visibleIf"?}。排序方向字段名必须是 dir，不能写 direction。模型表格用 {"kind":"table","title"?,"source":{"model":"模型id","view"?},"sortable"?,"initialSort"?,"emptyText"?}（source 可带可选 "kind":"model"），不要写 columns/rows；view 必须与模型匹配（预算 summary|items，成本 plans，偏好 ranking|breakdown），省略时用默认视图。
- explain {"kind":"explain","model":"模型id","title"?,"visibleIf"?}：由本地根据模型输出生成计算依据与诊断，不引入外部数据或脚本。
visibleIf 读当前 state/derived 与已计算模型值：{"op":"state-eq|state-neq","id":选择状态id,"value":选项value}、{"op":"num-eq|num-neq|num-gt|num-gte|num-lt|num-lte","left":表达式,"right":表达式}、{"op":"and|or","conditions":[...]}、{"op":"not","condition":...}。
上限：JSON 不超过 64KiB；state/derived 各不超过 20；select 选项不超过 20；models 不超过 4（预算支出项 20、成本方案 10、偏好候选 30/维度 8/筛选 8）；元素不超过 80；section children 1–20；布局深度不超过 4；柱/饼 items 1–20；折线 1–5 个系列、每系列离散点 2–50、总点数不超过 100、同系列 x 严格递增，函数曲线每系列采样数默认 41（上限 50）、总采样不超过 200；table 列 1–10、行不超过 30；条件节点不超过 100、嵌套不超过 5；单表达式深度不超过 8、v5 节点不超过 400；每次重算不超过 500 次运算（函数曲线采样另有每系列 5000 次的独立预算，模型计算另有 5000 次预算）。
内容：数字必须来自用户资料，或明确标为示例/估算，不得编造精确事实；示例值要贴近场景。全局依据、来源和缺失数据在正文说明，控件相关的假设、示例标记与条件提醒放在界面 note 中，避免两处冗长重复；影响理解的必要说明必须保留。
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
    { "kind": "note", "text": "收入与固定支出均为示例值，可按实际情况调整。" },
    { "kind": "slider", "bind": "income" },
    { "kind": "slider", "bind": "fixed" },
    { "kind": "value", "label": "每月剩余", "source": { "kind": "model", "model": "monthly", "key": "balance" }, "unit": "元" },
    { "kind": "chart", "chartType": "bar", "title": "收支对比", "legend": true, "source": { "model": "monthly" } }
  ]
}
\`\`\``;

/** 完整、逐字可见的默认增强文本。UI 面板与追加逻辑必须引用同一常量。 */
export const GENUI_PROMPT_TEXT = `${GENUI_PROMPT_START}\n${PROMPT_BODY}\n${GENUI_PROMPT_END}`;

export interface AppendPromptResult {
  /** 追加后的完整草稿；未追加时与输入逐字节相同。 */
  value: string;
  /** 是否实际追加（空草稿或已包含提示词时为 false）。 */
  inserted: boolean;
  /** 用户原始内容的长度，用于把光标停在增强说明之前。 */
  userLength: number;
}

/**
 * 把提示词追加到草稿末尾。
 * - 空草稿不追加，避免用户尚未输入时就被写入内容；
 * - 已包含标记时视为已追加，不重复；
 * - 原有草稿逐字节保留，仅在末尾按需补换行分隔。
 */
export function appendGenuiPrompt(value: string): AppendPromptResult {
  if (value.trim() === '' || value.includes(GENUI_PROMPT_START)) {
    return { value, inserted: false, userLength: value.length };
  }
  const separator = value.endsWith('\n\n') ? '' : value.endsWith('\n') ? '\n' : '\n\n';
  return {
    value: value + separator + GENUI_PROMPT_TEXT,
    inserted: true,
    userLength: value.length,
  };
}

export function hasGenuiPrompt(value: string): boolean {
  return value.includes(GENUI_PROMPT_START);
}
