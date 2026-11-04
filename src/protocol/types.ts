/**
 * genui v1 协议类型与常量（阶段 2）。
 *
 * 协议定位：模型输出中 `genui` 代码块的最小可渲染文档。设计原则见
 * docs/development-task.md 阶段 2：
 * - 显式版本号，未知版本拒绝渲染而不是猜测；
 * - 所有字段白名单（schema additionalProperties: false），防止模型输出
 *   夹带宿主无法安全处理的字段；
 * - 所有字符串长度与集合规模有上限，防止超大文档拖垮渲染。
 *
 * 失败码按「守卫顺序」排列：长度 → 深度 → JSON 解析 → 结构校验 → 版本。
 */

/** 最新协议版本；仍向后兼容静态 v1、交互 v2 与组合 v3 文档。 */
export const PROTOCOL_VERSION = 4;

/** 规模限制（与 schema 保持一致，validate 的长度守卫复用同一份常量）。 */
export const LIMITS = {
  /** 原始代码块文本长度上限（字符）。 */
  maxRawLength: 64 * 1024,
  /** JSON 嵌套深度上限（字符串感知的括号计数）。 */
  maxDepth: 16,
  /** elements 元素数量上限。 */
  maxElements: 50,
  /** title 长度上限。 */
  maxTitleLength: 120,
  /** 单个文本元素 value 长度上限。 */
  maxTextLength: 2000,
  /** 控件、派生值和界面项的上限。 */
  maxStateVariables: 20,
  maxDerivedValues: 20,
  maxSelectOptions: 20,
  maxElementsV2: 50,
  /** 一个文档内所有派生表达式共享的节点预算。 */
  maxExpressionNodes: 100,
  /** 每条派生表达式 AST 的最大递归深度。 */
  maxExpressionDepth: 8,
  /** 一次状态更新所允许执行的数值运算上限。 */
  maxEvaluationOperations: 500,
  /** 限制极端数量级与溢出传播。 */
  maxNumberMagnitude: 1_000_000_000_000,
  maxIdLength: 32,
  maxLabelLength: 120,
  maxUnitLength: 20,
  /** v3 组合元素的规模上限（展平后的元素总数，含 section/columns 嵌套）。 */
  maxElementsV3: 80,
  /** section/columns 嵌套深度上限（顶层 elements 为第 1 层）。 */
  maxNestingDepth: 4,
  /** columns 布局的列数范围。 */
  minColumns: 2,
  maxColumnsLayout: 3,
  /** 图表上限：系列数、柱/饼条目数、折线点数。 */
  maxChartSeries: 5,
  maxChartItems: 20,
  maxChartPointsPerSeries: 50,
  maxChartPointsTotal: 100,
  /** 表格上限：列数与行数。 */
  maxTableColumns: 10,
  maxTableRows: 30,
  /** 条件上限：单个文档内所有 visibleIf 的条件节点总数与单条深度。 */
  maxConditionNodes: 100,
  maxConditionDepth: 5,
  /** v3 文档内所有数值表达式（派生 + 图表/表格/条件内联）共享的节点预算。 */
  maxExpressionNodesV3: 300,
  /** v4 函数曲线：单系列采样点数与全文档采样点总数上限。 */
  maxFunctionSamples: 50,
  maxFunctionSamplesTotal: 200,
  /** v4 函数曲线：单次更新内单系列采样的专用运算预算（不占用共享求值池）。 */
  maxFunctionSampleOperations: 5_000,
  /** v4 零点覆盖：对称倍增重采样的最大轮数。 */
  maxFunctionExpandRounds: 4,
  /** v4 函数曲线默认采样数（奇数，含域端点）；默认定义域为 [-defaultFunctionDomainHalfWidth, +…] */
  defaultFunctionSamples: 41,
  defaultFunctionDomainHalfWidth: 10,
} as const;

/** v1 与 v2 均支持的纯文本元素；v3 允许按条件显示。 */
export interface TextElement {
  kind: 'text';
  value: string;
  visibleIf?: Condition;
}

export type GenuiElement = TextElement | InteractiveElement;

export interface GenuiV1Document {
  type: 'genui';
  version: 1;
  title?: string;
  elements: TextElement[];
}

export interface NumberStateVariable {
  id: string;
  label: string;
  kind: 'number';
  initial: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface SelectStateVariable {
  id: string;
  label: string;
  kind: 'select';
  initial: string;
  options: Array<{ label: string; value: string }>;
}

export type StateVariable = NumberStateVariable | SelectStateVariable;

export type NumericExpression =
  | { op: 'const'; value: number }
  | { op: 'state'; id: string }
  | { op: 'derived'; id: string }
  | { op: 'negate' | 'abs' | 'round' | 'floor' | 'ceil'; value: NumericExpression }
  | {
      op: 'add' | 'subtract' | 'multiply' | 'divide' | 'min' | 'max';
      left: NumericExpression;
      right: NumericExpression;
    };

export interface DerivedValue {
  id: string;
  label: string;
  unit?: string;
  expression: NumericExpression;
}

/** v3 条件说明的白名单谓词：只引用已声明的状态与数值表达式。 */
export type Condition =
  | { op: 'state-eq' | 'state-neq'; id: string; value: string }
  | {
      op: 'num-eq' | 'num-neq' | 'num-gt' | 'num-gte' | 'num-lt' | 'num-lte';
      left: NumericExpression;
      right: NumericExpression;
    }
  | { op: 'and' | 'or'; conditions: Condition[] }
  | { op: 'not'; condition: Condition };

/** 条件说明元素：按 tone 着色，可按 visibleIf 显示/隐藏。 */
export interface NoteElement {
  kind: 'note';
  text: string;
  tone?: 'info' | 'warn' | 'error';
  visibleIf?: Condition;
}

export interface ChartItem {
  label: string;
  value: NumericExpression;
}

export interface ChartSeriesPoint {
  x: number;
  y: NumericExpression;
}

export interface ChartSeries {
  label: string;
  color?: string;
  /** 对连续函数曲线使用三次插值；普通趋势数据仍按折线绘制。 */
  smooth?: boolean;
  points: ChartSeriesPoint[];
}

/**
 * v4 函数曲线表达式：在数值表达式白名单上增加局部变量 `x`。
 * 与 NumericExpression 的区别是操作数自身允许是含 `x` 的子树，
 * 因此 `multiply(x, x)` 这类一次声明即可建模；`x` 只在函数曲线的
 * y=f(x) 表达式内可见，derived/state/图表点/条件里出现会被拒绝
 * （schema 与语义层双重把关）。
 */
export type FunctionExpression =
  | { op: 'x' }
  | { op: 'const'; value: number }
  | { op: 'state'; id: string }
  | { op: 'derived'; id: string }
  | { op: 'negate' | 'abs' | 'round' | 'floor' | 'ceil'; value: FunctionExpression }
  | {
      op: 'add' | 'subtract' | 'multiply' | 'divide' | 'min' | 'max';
      left: FunctionExpression;
      right: FunctionExpression;
    };

/** v4 函数曲线定义域边界（求值失败时静默回退默认域，不显示错误）。 */
export interface ChartFunctionDomain {
  start: NumericExpression;
  end: NumericExpression;
}

/** v4 函数曲线定义：一次声明 y=f(x)，采样与视口覆盖由运行时按状态完成。 */
export interface ChartFunctionDefinition {
  expression: FunctionExpression;
  /** 采样范围；缺省为 [-defaultFunctionDomainHalfWidth, +defaultFunctionDomainHalfWidth]。 */
  domain?: ChartFunctionDomain;
  /** 采样点数（含域端点），默认 41；范围 5..maxFunctionSamples。 */
  samples?: number;
  /** 关键特征覆盖；目前只支持 'zero'（在视口内就近放大以覆盖零点）。 */
  features?: Array<'zero'>;
}

/** v4 函数曲线系列：与离散折线系列可在同一 series 数组内混用。 */
export interface ChartFunctionSeries {
  label: string;
  color?: string;
  function: ChartFunctionDefinition;
}

export interface ChartBarPieElement {
  kind: 'chart';
  chartType: 'bar' | 'pie';
  title?: string;
  legend?: boolean;
  items: ChartItem[];
}

export interface ChartLineElement<S = ChartSeries> {
  kind: 'chart';
  chartType: 'line';
  title?: string;
  xLabel?: string;
  yLabel?: string;
  legend?: boolean;
  series: S[];
}

/** v3 机械白名单内的折线图：series 只能是离散点系列。 */
export type ChartElement = ChartBarPieElement | ChartLineElement<ChartSeries>;

/** v4 折线图：离散点系列与函数曲线系列（y=f(x)）可混用。 */
export type ChartElementV4 =
  | ChartBarPieElement
  | ChartLineElement<ChartSeries | ChartFunctionSeries>;

/** 表格单元格：静态字符串/数值/缺失，或内联数值表达式（引用 state/derived/const 运算）。 */
export type TableCell = string | number | null | NumericExpression;

export interface TableColumn {
  key: string;
  label: string;
  numeric?: boolean;
  unit?: string;
}

export interface TableRow {
  cells: Record<string, TableCell>;
  visibleIf?: Condition;
}

export interface TableElement {
  kind: 'table';
  title?: string;
  columns: TableColumn[];
  rows: TableRow[];
  sortable?: boolean;
  /** 允许用户选中一行作为候选项；选中项会进入「继续讨论」摘要。 */
  selectable?: boolean;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  emptyText?: string;
  visibleIf?: Condition;
}

export interface SectionElement<C = GenuiV3Element> {
  kind: 'section';
  title?: string;
  children: C[];
}

export interface ColumnsElement<C = GenuiV3Element> {
  kind: 'columns';
  columns: C[][];
}

export type InteractiveElement =
  | TextElement
  | { kind: 'number-input'; bind: string }
  | { kind: 'slider'; bind: string }
  | { kind: 'select'; bind: string }
  | {
      kind: 'value';
      label: string;
      source: { kind: 'state' | 'derived'; id: string };
      unit?: string;
    };

/** v3 组合元素：v2 叶子 + 条件说明 + 图表 + 表格 + 布局容器（可嵌套）。 */
export type GenuiV3Element =
  | InteractiveElement
  | NoteElement
  | ChartElement
  | TableElement
  | SectionElement<GenuiV3Element>
  | ColumnsElement<GenuiV3Element>;

/** v4 组合元素：与 v3 相同的元素集合，折线图允许函数曲线系列。 */
export type GenuiV4Element =
  | InteractiveElement
  | NoteElement
  | ChartElementV4
  | TableElement
  | SectionElement<GenuiV4Element>
  | ColumnsElement<GenuiV4Element>;

/** v2 文档只含声明式数据；派生计算被限制在 NumericExpression 白名单内。 */
export interface GenuiV2Document {
  type: 'genui';
  version: 2;
  title?: string;
  state: StateVariable[];
  derived: DerivedValue[];
  elements: InteractiveElement[];
}

/** v3 组合文档：同一份 state/derived 驱动控件、数值、条件说明、图表与表格。 */
export interface GenuiV3Document {
  type: 'genui';
  version: 3;
  title?: string;
  state: StateVariable[];
  derived: DerivedValue[];
  elements: GenuiV3Element[];
}

/** v4 组合文档：v3 全部能力 + 函数曲线系列（y=f(x) 受限表达式驱动）。 */
export interface GenuiV4Document {
  type: 'genui';
  version: 4;
  title?: string;
  state: StateVariable[];
  derived: DerivedValue[];
  elements: GenuiV4Element[];
}

/** 经 parseGenui 校验后可安全交给渲染器的版本化文档。 */
export type GenuiDocument =
  | GenuiV1Document
  | GenuiV2Document
  | GenuiV3Document
  | GenuiV4Document;

export type InteractiveStateValues = Record<string, number | string>;

export interface DerivedCalculation {
  values: Record<string, number>;
  errors: Record<string, string>;
  operations: number;
}

/** 解析失败码；顺序即守卫执行顺序。 */
export type GenuiFailureCode =
  | 'too-large'
  | 'too-deep'
  | 'invalid-json'
  | 'schema-violation'
  | 'unsupported-version'
  | 'semantic-violation'
  | 'invalid-reference'
  | 'dependency-cycle'
  | 'too-complex';

export type ParseGenuiResult =
  | { ok: true; document: GenuiDocument }
  | {
      ok: false;
      code: GenuiFailureCode;
      detail: string;
      /** 结构校验中筛掉 oneOf 分支噪音后的具体问题（可选）。 */
      issues?: GenuiSchemaIssue[];
      /** JSON.parse 失败时的字符位置（可选）。 */
      position?: number;
    };

/** 一条面向修复的结构问题：路径、关键字与可读预期。 */
export interface GenuiSchemaIssue {
  /** 原始 JSON Pointer，例如 `/elements/3/initialSort`。 */
  pointer: string;
  /** 用户可读路径，例如 `elements[3].initialSort`。 */
  path: string;
  keyword: string;
  message: string;
  expected?: string;
  actual?: string;
}
