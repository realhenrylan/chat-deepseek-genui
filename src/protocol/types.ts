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

/** 最新协议版本；仍兼容静态 v1、交互 v2 与组合 v3 文档。 */
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
  /** v4 依据（provenance）上限。 */
  maxSources: 20,
  maxSourceLabelLength: 120,
  maxSourceUrlLength: 2048,
  maxSourceNoteLength: 500,
  maxPublisherLength: 120,
  maxBasisNoteLength: 300,
  /** ISO 日期或日期时间的字符串长度上限。 */
  maxProvenanceDateLength: 40,
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

export type ChartElement =
  | {
      kind: 'chart';
      chartType: 'bar' | 'pie';
      title?: string;
      legend?: boolean;
      items: ChartItem[];
    }
  | {
      kind: 'chart';
      chartType: 'line';
      title?: string;
      xLabel?: string;
      yLabel?: string;
      legend?: boolean;
      series: ChartSeries[];
    };

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
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  emptyText?: string;
  visibleIf?: Condition;
}

export interface SectionElement {
  kind: 'section';
  title?: string;
  children: GenuiV3Element[];
}

export interface ColumnsElement {
  kind: 'columns';
  columns: GenuiV3Element[][];
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
  | SectionElement
  | ColumnsElement;

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

/**
 * v4：给数据附加可保存、可查看的来源与适用范围。
 *
 * 依据分四类「实际输入」和两类「派生/未知」：
 * - user：用户在本对话中提供；
 * - example：示例数据，不代表真实情况；
 * - estimate：有说明的估算；
 * - reference：模型引用的外部资料，插件不会访问网络核验；
 * - computed：由前几类数据计算得出；
 * - unknown：没有可用依据，界面必须诚实显示未知，不能当成已核验。
 *
 * 缺少 basis 时与 unknown 同义；v1–v3 文档没有本结构，界面按旧协议渲染。
 */
export const BASIS_KINDS = ['user', 'example', 'estimate', 'reference', 'computed', 'unknown'] as const;

export type GenuiBasisKind = (typeof BASIS_KINDS)[number];

/** 模型声称的资料，不是插件核验过的事实；URL 只作为不可信文本展示。 */
export interface GenuiSource {
  id: string;
  label: string;
  /** 仅接受 https URL；插件从不发起请求，也不把链接标为已验证。 */
  url?: string;
  publisher?: string;
  /** 资料自身的时间（例如数据所属月份），ISO 日期或日期时间。 */
  publishedAt?: string;
  /** 模型声称的获取时间，插件无法核验。 */
  retrievedAt?: string;
  note?: string;
}

/** 附加在一项数据上的依据说明。 */
export interface GenuiBasis {
  kind: GenuiBasisKind;
  /** 仅 kind=reference 时必填，指向 sources 中声明的来源。 */
  sourceId?: string;
  note?: string;
  /** 该数据适用的时点（例如“按 2025 年均价”）。 */
  asOf?: string;
  /** 有效期截止；过期后界面必须提示已过期。 */
  validUntil?: string;
}

export type GenuiV4StateVariable =
  | (NumberStateVariable & { basis?: GenuiBasis })
  | (SelectStateVariable & { basis?: GenuiBasis });

export type GenuiV4DerivedValue = DerivedValue & { basis?: GenuiBasis };

export interface GenuiV4TableColumn extends TableColumn {
  basis?: GenuiBasis;
}

export interface GenuiV4TableRow extends TableRow {
  basis?: GenuiBasis;
}

export interface GenuiV4TableElement {
  kind: 'table';
  title?: string;
  columns: GenuiV4TableColumn[];
  rows: GenuiV4TableRow[];
  sortable?: boolean;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  emptyText?: string;
  visibleIf?: Condition;
  basis?: GenuiBasis;
}

export interface GenuiV4ChartItem extends ChartItem {
  basis?: GenuiBasis;
}

export interface GenuiV4ChartSeries extends ChartSeries {
  basis?: GenuiBasis;
}

export type GenuiV4ChartElement =
  | {
      kind: 'chart';
      chartType: 'bar' | 'pie';
      title?: string;
      legend?: boolean;
      items: GenuiV4ChartItem[];
      basis?: GenuiBasis;
    }
  | {
      kind: 'chart';
      chartType: 'line';
      title?: string;
      xLabel?: string;
      yLabel?: string;
      legend?: boolean;
      series: GenuiV4ChartSeries[];
      basis?: GenuiBasis;
    };

export interface GenuiV4ValueElement {
  kind: 'value';
  label: string;
  source: { kind: 'state' | 'derived'; id: string };
  unit?: string;
  basis?: GenuiBasis;
}

export type GenuiV4InteractiveElement =
  | TextElement
  | { kind: 'number-input'; bind: string }
  | { kind: 'slider'; bind: string }
  | { kind: 'select'; bind: string }
  | GenuiV4ValueElement;

export interface GenuiV4SectionElement {
  kind: 'section';
  title?: string;
  children: GenuiV4Element[];
}

export interface GenuiV4ColumnsElement {
  kind: 'columns';
  columns: GenuiV4Element[][];
}

export type GenuiV4Element =
  | GenuiV4InteractiveElement
  | NoteElement
  | GenuiV4ChartElement
  | GenuiV4TableElement
  | GenuiV4SectionElement
  | GenuiV4ColumnsElement;

/** v4 组合文档：v3 元素 + 全局 sources 与逐项 basis。 */
export interface GenuiV4Document {
  type: 'genui';
  version: 4;
  title?: string;
  sources?: GenuiSource[];
  state: GenuiV4StateVariable[];
  derived: GenuiV4DerivedValue[];
  elements: GenuiV4Element[];
}

/** 经 parseGenui 校验后可安全交给渲染器的版本化文档。 */
export type GenuiDocument = GenuiV1Document | GenuiV2Document | GenuiV3Document | GenuiV4Document;

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
  | { ok: false; code: GenuiFailureCode; detail: string };
