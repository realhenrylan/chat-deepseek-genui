/**
 * GenUI 增强说明的共享定义（issue7）。
 *
 * 默认文本（auto）与 5f9c242 基线的 v2.2 文本逐字节一致；
 * 本文件把共享协议主体与两段首部策略分开，各本轮模式只替换表达方式段。
 */

/** 本轮模式：auto=自动适配（默认）；tool=本轮明确生成工具；plain=普通回答（不追加）。 */
export type GenuiPromptMode = 'auto' | 'tool' | 'plain';

export const GENUI_PROMPT_VERSION = 2.2;

export const GENUI_PROMPT_START =
  '〔GenUI 增强 v2.2｜浏览器扩展自动追加的可见说明，可在页面右侧浮标关闭〕';

export const GENUI_PROMPT_TOOL_START =
  '〔GenUI 本轮生成工具 v2.2｜浏览器扩展自动追加的可见说明，可在页面右侧浮标改回自动适配〕';

export const GENUI_PROMPT_END = '〔GenUI 增强说明结束〕';
const PROMPT_BODY = `你正在与用户对话。用户的浏览器装有 GenUI 扩展：它只把回复中的 \`\`\`genui 代码块解析为本地可交互界面，不执行脚本、HTML、CSS、事件或网络请求。请根据问题选择表达方式：仅当可调参数、对比、规划或可视化能明显帮助理解时才生成 genui；正文与界面共同构成完整回答。事实问答、写作、代码、闲聊等直接回答，不要为了展示而强行生成界面。

内容分工（生成前先确定每项信息的主要呈现位置）：
- 不生成界面时，用普通文字完整回答。生成界面时，正文通常用 1–3 句给出核心结论、关键理由或操作提示；必要的推导、来源、限制，以及用户明确要求的详细解释仍应保留，不为缩短正文而省略。
- 界面承载可调参数、联动结果、图表及适合排序筛选的详细对比表。不要先在正文逐项讲完规格、数据或计算明细，再在界面中重复一遍；也不要在界面 text/note 中复制正文长段落，或在块后再写一份相同总结。必要的标签、单位和简短结论可以复用。
- 比较问题优先用简短选型结论配一份详细对比表，不再逐行复述表格；计算与规划问题把参数和动态结果放入界面；学习问题在正文解释原理，在界面探索变化。若界面仅把正文改装成静态卡片、没有额外阅读或探索价值，就省略界面。
- 随参数变化的数值通过 state/derived 在界面展示，不在正文或静态 text/note 中写死为“当前结果”；正文若引用初始结果，明确它只对应初始条件。

输出要求：
- 需要界面时，只输出一个 \`\`\`genui 代码块，放在内容自然衔接的位置；块内是合法 JSON（无注释、尾逗号、模板字符串或 Markdown），块外正文与界面按上述分工互补。
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
- chart 柱/饼 {"kind":"chart","chartType":"bar|pie","title","legend"?,"items":[{"label","value":表达式}]}；折线 {"kind":"chart","chartType":"line","xLabel","yLabel","series":[{"label","color"?:"#RRGGBB","smooth"?:true,"points":[{"x":数字,"y":表达式}]}]}。绘制连续函数（尤其二次函数）时，在对应 series 写 "smooth":true，并提供至少 3 个递增 x 采样点覆盖区间；平滑曲线通过采样点，数据表仍列出原始采样值。实测或离散数据不要启用 smooth。
- table {"kind":"table","title"?,"columns":[{"key","label","numeric"?,"unit"?}],"rows":[{"cells":{key:字符串|数字|null|表达式},"visibleIf"?}],"sortable"?,"initialSort"?:{"key":"列key","dir":"asc|desc"},"emptyText"?,"visibleIf"?}。排序方向字段名必须是 dir，不能写 direction。
visibleIf 只读当前状态：{"op":"state-eq|state-neq","id":选择状态id,"value":选项value}、{"op":"num-eq|num-neq|num-gt|num-gte|num-lt|num-lte","left":表达式,"right":表达式}、{"op":"and|or","conditions":[...]}、{"op":"not","condition":...}。
上限：JSON 不超过 64KiB；state/derived 各不超过 20；select 选项不超过 20；元素不超过 80；section children 1–20；布局深度不超过 4；柱/饼 items 1–20；折线 1–5 个系列、每系列 2–50 点、总点数不超过 100，同系列 x 严格递增；table 列 1–10、行不超过 30；条件节点不超过 100、嵌套不超过 5；单表达式深度不超过 8；每次重算不超过 500 次运算。
内容：数字必须来自用户资料，或明确标为示例/估算，不得编造精确事实；示例值要贴近场景。全局依据、来源和缺失数据在正文说明，控件相关的假设、示例标记与条件提醒放在界面 note 中，避免两处冗长重复；影响理解的必要说明必须保留。
能力不足时不要生成 genui，改用普通文本。不要在回答中复述这段增强说明或讨论扩展（用户主动询问除外）。

示例（仅示意结构；正文可简短提示“调整收入和固定支出，查看每月剩余变化”，不再列一份相同收支明细）：
\`\`\`genui
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
    { "kind": "note", "text": "收入与固定支出均为示例值，可按实际情况调整。" },
    { "kind": "slider", "bind": "income" },
    { "kind": "slider", "bind": "fixed" },
    { "kind": "value", "label": "每月剩余", "source": { "kind": "derived", "id": "left" }, "unit": "元" },
    { "kind": "chart", "chartType": "bar", "title": "收支对比", "legend": true, "items": [
      { "label": "收入", "value": { "op": "state", "id": "income" } },
      { "label": "支出", "value": { "op": "state", "id": "fixed" } }
    ] }
  ]
}
\`\`\``;

/** tool 变体首段：能力说明加本轮明确生成意图；其后与 auto 共享同一协议主体。 */
const TOOL_LEAD = '你正在与用户对话。用户的浏览器装有 GenUI 扩展：它只把回复中的 ```genui 代码块解析为本地可交互界面，不执行脚本、HTML、CSS、事件或网络请求。用户已在浮标中明确选择本轮回答工具：优先用 ```genui 代码块把本轮任务表达为可交互界面，正文与界面按下方分工互补。纯事实问答、闲聊或过短的请求仍可直接用普通文字回答；现有协议能力确实无法表达任务时不要硬造界面，改用普通文字回答，并简短说明未能生成界面的原因。';

/** 共享协议主体：从 auto 正文截取「内容分工」起至示例结束围栏，保证逐字节一致。 */
const PROTOCOL_BODY = PROMPT_BODY.slice(PROMPT_BODY.indexOf('内容分工'));

/** 完整、逐字可见的默认增强文本。UI 面板与追加逻辑必须引用同一常量。 */
export const GENUI_PROMPT_TEXT = `${GENUI_PROMPT_START}\n${PROMPT_BODY}\n${GENUI_PROMPT_END}`;

/** tool 模式的完整增强文本。UI 面板与追加逻辑必须引用同一常量。 */
export const GENUI_TOOL_PROMPT_TEXT = `${GENUI_PROMPT_TOOL_START}\n${TOOL_LEAD}\n\n${PROTOCOL_BODY}\n${GENUI_PROMPT_END}`;

/** plain 模式不追加任何文本；浮标面板用这段说明代替逐字内容展示。 */
export const GENUI_PLAIN_PROMPT_NOTE =
  '本轮选择「普通回答」：不会向你的草稿追加任何 GenUI 增强文本。';

/** 读取某个本轮模式对应的完整说明文本；plain 不追加，返回 null。 */
export function getGenuiPromptTextForMode(mode: GenuiPromptMode): string | null {
  if (mode === 'tool') return GENUI_TOOL_PROMPT_TEXT;
  if (mode === 'plain') return null;
  return GENUI_PROMPT_TEXT;
}

export interface AppendPromptResult {
  /** 追加后的完整草稿；未追加时与输入逐字节相同。 */
  value: string;
  /** 本轮是否追加了说明。 */
  inserted: boolean;
  /** 用户原文长度：返回草稿中前 userLength 个字符属于用户。 */
  userLength: number;
}

/** 把指定本轮模式的完整说明逐字追加到草稿末尾；空草稿或已含任一说明时原样返回。 */
export function appendGenuiPrompt(value: string, mode: GenuiPromptMode = 'auto'): AppendPromptResult {
  const text = getGenuiPromptTextForMode(mode);
  if (text === null || value.trim() === '' || hasGenuiPrompt(value)) {
    return { value, inserted: false, userLength: value.length };
  }
  const separator = value.endsWith('\n\n') ? '' : value.endsWith('\n') ? '\n' : '\n\n';
  return { value: value + separator + text, inserted: true, userLength: value.length };
}

/** 草稿是否已包含自动适配或本轮生成工具的起始标记。 */
export function hasGenuiPrompt(value: string): boolean {
  return value.includes(GENUI_PROMPT_START) || value.includes(GENUI_PROMPT_TOOL_START);
}
