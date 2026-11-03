/**
 * 阶段 7：默认增强提示词（v2.2）。
 *
 * v2.2 修订：正文与界面共同完成回答，按内容分工，避免完整正文后再附一份重复界面；
 * 动态结果留在界面中，正文保留结论、必要解释与来源。
 *
 * 设计约束（docs/development-task.md 阶段 7、docs/compatibility-investigation.md §6）：
 * - 提示词对用户完全可见：它作为普通文本追加在输入框草稿末尾，发送前可逐字检查，
 *   不写入隐藏输入、不注入页面内部消息、不自动发送；
 * - 只描述真实存在的 v3 协议能力（src/protocol/schema.ts + validate.ts），
 *   不承诺脚本、HTML、CSS、事件或网络能力；
 * - 引导模型「适合时才生成界面」，普通问题正常回答；
 * - 与用户已有草稿逐字节隔离：本模块只负责纯字符串追加，绝不裁剪或覆盖原草稿。
 */

export const GENUI_PROMPT_VERSION = 2.2;

/** 用于识别、去重和关闭恢复的稳定标记；修改提示词时同步升级版本号。 */
export const GENUI_PROMPT_START =
  '〔GenUI 增强 v2.2｜浏览器扩展自动追加的可见说明，可在页面右侧浮标关闭〕';
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
