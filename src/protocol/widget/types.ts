/**
 * w1 内联组件协议类型定义（M2 阶段）。
 *
 * 与 v1-v5 根文档的区别：
 * - 顶层字段为 {"w": "组件类型", ...}，由 parseGenui 在入口分流；
 * - 单组件单代码块，无多余 state/derived/models/elements 样板；
 * - 面向对话与自然阅读场景，小颗粒度；
 * - 运行时仍保持绝对安全边界：纯文本与受控 UI 渲染，不执行任意脚本或外部请求。
 */

export type WidgetKind =
  | 'slider'
  | 'result'
  | 'note'
  | 'quiz'
  | 'card'
  | 'compare'
  | 'checklist'
  | 'timeline'
  | 'spoiler'
  | 'poll'
  | 'form'
  | 'copy'
  | 'flow';

export interface BaseWidget {
  w: WidgetKind;
  id?: string;
  [key: string]: unknown;
}

/** 滑块随数值变化的状态解释（R-I3） */
export interface SliderStateHint {
  min?: number;
  max?: number;
  text: string;
}

/** 滑块组件：轻量可调参数 */
export interface SliderWidget extends BaseWidget {
  w: 'slider';
  id?: string;
  label?: string;
  min: number;
  max: number;
  step?: number;
  value?: number;
  unit?: string;
  /** P1-a (R-I2)：两端语义刻度，如「-2（向下开口）」「+2（向上开口）」 */
  minLabel?: string;
  maxLabel?: string;
  /** P1-a (R-I3)：静态或随状态区段变化的解释文案 */
  hint?: string;
  hints?: SliderStateHint[];
  /** P1-a (R-I1)：显式展示「本地计算」徽标，默认 true */
  localBadge?: boolean;
}

/** 结果展示组件：可显示静态数值、纯文本结果或随滑块联动的 LaTeX 公式 */
export interface ResultWidget extends BaseWidget {
  w: 'result';
  id?: string;
  label?: string;
  value: number | string;
  bind?: string;
  unit?: string;
  emphasis?: 'normal' | 'primary';
  /** P1-b：可随总线状态实时改写的 LaTeX 公式模板（如 `y = {a}x^2`） */
  formula?: string;
  /** 可选图注/说明 */
  caption?: string;
}

/** 提示说明组件 */
export interface NoteWidget extends BaseWidget {
  w: 'note';
  text: string;
  tone?: 'info' | 'warn' | 'error';
}

/** 选择题组件 */
export interface QuizOption {
  label: string;
  value: string;
}

export interface QuizQuestionItem {
  id?: string;
  question: string;
  options: QuizOption[];
}

export interface QuizWidget extends BaseWidget {
  w: 'quiz';
  id?: string;
  question: string;
  options: QuizOption[];
  answer?: string;
  explain?: string;
  /** P0-c: 'local' 本地即时判分（默认）；'model' 提交答案与可选理由交由模型批改。 */
  grade?: 'local' | 'model';
  /** P0-c: 支持同一卡片内包含多道单选题（grade:'model' 场景）。 */
  questions?: QuizQuestionItem[];
  /** P0-c: 模型批改模式下是否显示可选理由文本框（默认 true）。 */
  reason?: boolean;
  reasonLabel?: string;
  submit?: {
    label?: string;
    prompt?: string;
  };
}

/** 概念/条件卡的行式条目（P1-a，S2 / R-V2） */
export interface CardRowItem {
  icon?: string;
  title: string;
  detail?: string;
  /** 可选块级或行内 LaTeX 公式（如 `0 \in W`） */
  math?: string;
}

/** 概念/信息卡组件 */
export interface CardWidget extends BaseWidget {
  w: 'card';
  title: string;
  subtitle?: string;
  points?: string[];
  /** P1-a：分隔线行式布局（左图标 + 粗体标题 + 次要说明/公式） */
  items?: CardRowItem[];
  tags?: string[];
  /** 可选底部图注（R-L3） */
  caption?: string;
}

/** 方案对比卡组件 */
export interface CompareItem {
  name: string;
  pros?: string[];
  cons?: string[];
  fields?: Record<string, string | number>;
}

export interface CompareWidget extends BaseWidget {
  w: 'compare';
  title?: string;
  items: CompareItem[];
  highlight?: string;
  /**
   * 各列是否为可采纳的候选方案（显示「采用此方案继续细化」回流按钮）。
   * 省略时按是否给出 `highlight` 推断：有推荐项视为选型对比，否则视为纯概念/信息对比，不显示采纳按钮。
   */
  selectable?: boolean;
}

/** 清单步骤组件 */
export interface ChecklistItem {
  text: string;
  note?: string;
  checked?: boolean;
}

export interface ChecklistWidget extends BaseWidget {
  w: 'checklist';
  title?: string;
  items: ChecklistItem[];
}

/** 时间线组件：阶段/时间脉络 */
export interface TimelineItem {
  time: string;
  title: string;
  desc?: string;
  highlight?: boolean;
}

export interface TimelineWidget extends BaseWidget {
  w: 'timeline';
  title?: string;
  items: TimelineItem[];
}

/** 折叠思考块组件：先给摘要，展开后看推导细节 */
export interface SpoilerWidget extends BaseWidget {
  w: 'spoiler';
  summary: string;
  hint?: string;
  content: string;
}

/** 观点倾向投票组件 */
export interface PollOption {
  id: string;
  label: string;
  ratio: number;
}

export interface PollWidget extends BaseWidget {
  w: 'poll';
  question: string;
  options: PollOption[];
}

/** 回流表单组件（P0-b） */
export type FormFieldType = 'radio' | 'choice' | 'checkbox' | 'text';

export interface FormOption {
  label: string;
  value: string;
}

export interface FormChoiceField {
  id: string;
  type: 'radio' | 'choice';
  label: string;
  options: FormOption[];
  default?: string;
  layout?: 'vertical' | 'inline';
  optional?: boolean;
}

export interface FormCheckboxField {
  id: string;
  type: 'checkbox';
  label: string;
  options: FormOption[];
  default?: string[];
  layout?: 'vertical' | 'inline';
  optional?: boolean;
}

export interface FormTextField {
  id: string;
  type: 'text';
  label: string;
  placeholder?: string;
  default?: string;
  optional?: boolean;
  maxLength?: number;
}

export type FormField = FormChoiceField | FormCheckboxField | FormTextField;

export interface FormSubmitConfig {
  label: string;
  prompt: string;
}

export interface FormWidget extends BaseWidget {
  w: 'form';
  id?: string;
  title: string;
  subtitle?: string;
  intent?: 'clarify' | 'quiz';
  fields: FormField[];
  submit: FormSubmitConfig;
}

/** 可复制话术/模板组件（P1-a，S10 / R-A1） */
export interface CopyWidget extends BaseWidget {
  w: 'copy';
  title?: string;
  text: string;
  /** 复制按钮文案，默认「复制内容」，可如「复制询问话术」 */
  label?: string;
  /** 可选底部辅助说明 */
  note?: string;
}

/** 流程图/架构图节点（P2，S3 / S9） */
export type FlowTone = 'default' | 'accent' | 'info' | 'warn';

export interface FlowStep {
  id?: string;
  icon?: string;
  step?: string;
  title: string;
  desc?: string;
  highlight?: boolean;
  tone?: FlowTone;
  /** 指向下一个节点箭头上的标签文字（S9） */
  arrowLabel?: string;
  arrowDirection?: 'down' | 'both';
}

/** 流程图底部分栏（S3：如「本地交互」vs「模型交互」） */
export interface FlowBranch {
  icon?: string;
  title: string;
  desc?: string;
  badge?: string;
  direction?: 'down' | 'both';
  tone?: FlowTone;
}

/** 架构图底部能力格（S9：2×2 图标+名称网格） */
export interface FlowCapability {
  icon?: string;
  title: string;
  desc?: string;
}

/** 流程图与嵌套架构图组件（P2，S3 / S9） */
export interface FlowWidget extends BaseWidget {
  w: 'flow';
  title?: string;
  subtitle?: string;
  steps: FlowStep[];
  branches?: FlowBranch[];
  capabilities?: FlowCapability[];
  caption?: string;
}

export type GenuiWidget =
  | SliderWidget
  | ResultWidget
  | NoteWidget
  | QuizWidget
  | CardWidget
  | CompareWidget
  | ChecklistWidget
  | TimelineWidget
  | SpoilerWidget
  | PollWidget
  | FormWidget
  | CopyWidget
  | FlowWidget;

export interface NormalizedWidgetResult {
  ok: true;
  widget: GenuiWidget;
  warnings?: string[];
}

export interface WidgetParseFailure {
  ok: false;
  code: 'schema-violation' | 'semantic-violation';
  detail: string;
}

export type ParseWidgetResult = NormalizedWidgetResult | WidgetParseFailure;
