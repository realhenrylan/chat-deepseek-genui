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
  | 'poll';

export interface BaseWidget {
  w: WidgetKind;
  id?: string;
  [key: string]: unknown;
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
}

/** 结果展示组件：可显示静态数值或纯文本结果 */
export interface ResultWidget extends BaseWidget {
  w: 'result';
  id?: string;
  label?: string;
  value: number | string;
  bind?: string;
  unit?: string;
  emphasis?: 'normal' | 'primary';
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

export interface QuizWidget extends BaseWidget {
  w: 'quiz';
  id?: string;
  question: string;
  options: QuizOption[];
  answer?: string;
  explain?: string;
}

/** 概念/信息卡组件 */
export interface CardWidget extends BaseWidget {
  w: 'card';
  title: string;
  subtitle?: string;
  points?: string[];
  tags?: string[];
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
  | PollWidget;

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
