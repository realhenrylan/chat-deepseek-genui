import {
  DEFAULT_MODEL_PRECISION,
  DEFAULT_MODEL_VIEW,
  LIMITS,
  type ChartFunctionDefinition,
  type Condition,
  type CostModel,
  type DerivedCalculation,
  type FunctionExpression,
  type GenuiV2Document,
  type GenuiV3Document,
  type GenuiV3Element,
  type GenuiV4Document,
  type GenuiV4Element,
  type GenuiV5Document,
  type GenuiV5Element,
  type InteractiveStateValues,
  type ModelKind,
  type NumericExpression,
  type PreferenceModel,
  type SemanticModel,
  type BudgetModel,
} from '../protocol/types';

/**
 * 受限本地计算运行时（v2 派生值 + v3/v4 内联表达式与条件 + v4 函数曲线采样）。
 *
 * 所有计算都只解释协议白名单内的数值 AST，不接受代码、属性路径或动态函数名。
 * v2 的派生值按需缓存；v3 在进入渲染前一次性求值图表、表格与条件中的内联
 * 表达式，渲染阶段只读结果，避免渲染副作用与重复计费。
 * v4 的函数曲线系列使用每系列独立的采样引擎与专用运算预算：
 * 逐 x 采样的成本不挤占共享求值池，超预算只影响该系列。
 */

type StatefulDocument = GenuiV2Document | GenuiV3Document | GenuiV4Document | GenuiV5Document;

/** 运行时只需要状态与派生定义；v2–v5 文档都满足该结构。 */
interface StatefulDocumentLike {
  state: StatefulDocument['state'];
  derived: StatefulDocument['derived'];
}

export type ExpressionResult = { ok: true; value: number } | { ok: false; error: string };
export type ConditionResult = { ok: true; value: boolean } | { ok: false; error: string };

/** v3/v4/v5 文档一次状态更新后的完整求值快照。 */
export interface CompositeEvaluation {
  derived: DerivedCalculation;
  expressions: Map<NumericExpression, ExpressionResult>;
  conditions: Map<Condition, ConditionResult>;
  /** v4 函数曲线系列的采样结果，按 function 定义对象身份索引。 */
  functions: Map<ChartFunctionDefinition, FunctionSeriesResult>;
  /** v5 语义模型的完整结果；失败也只影响对应模型。 */
  models: Map<string, ModelResult>;
  operations: number;
}

export type ModelDiagnosticLevel = 'warn' | 'info';

export interface ModelDiagnostic {
  level: ModelDiagnosticLevel;
  message: string;
}

export interface ModelBasis {
  label: string;
  value: string;
}

export interface ModelTableColumn {
  key: string;
  label: string;
  numeric?: boolean;
  unit?: string;
}

export type ModelTableCell = string | number | null;

export interface ModelTable {
  columns: ModelTableColumn[];
  rows: Array<Record<string, ModelTableCell>>;
  emptyText?: string;
}

export interface ModelChartItem {
  label: string;
  value: number;
}

/**
 * v5 语义模型结果。scalars 保存可被表达式读取的标量；null 表示该标量
 * 在当前数据下不可用（例如收入为 0 时的占比），引用它的表达式会得到
 * 明确错误，而不是把缺失当作 0。
 */
export interface ModelResult {
  ok: boolean;
  id: string;
  kind: ModelKind;
  label: string;
  error?: string;
  scalars: Record<string, number | null>;
  tables: Record<string, ModelTable>;
  chartItems: ModelChartItem[];
  diagnostics: ModelDiagnostic[];
  basis: ModelBasis[];
  formula: string;
  operations: number;
}

/**
 * v4 函数曲线采样结果。ys 与 xs 一一对应；null 的样本表示该位置求值失败
 * （渲染为折线断裂），不计作整系列错误。fallbackDomain 表示 domain 表达式
 * 求值失败后按设计静默回退默认域（例如 a=0 时的顶点除零），不向用户显示错误。
 */
export interface FunctionSeriesEvaluation {
  ok: true;
  domain: { start: number; end: number };
  xs: number[];
  ys: Array<number | null>;
  dropped: number;
  /** 是否接受了零点覆盖的 ×2 重采样（扩展无益时撤销并保留原视口）。 */
  expanded: boolean;
  /**
   * zero 特征最终是否满足：请求了 features:["zero"] 却未能覆盖（无实根、
   * 相切零点或达上限）时为 false，渲染层据此提示「未找到零点」；
   * 未请求 zero 特征的曲线恒为 true，不提示。
   */
  zeroFound: boolean;
  fallbackDomain: boolean;
}

export type FunctionSeriesResult = FunctionSeriesEvaluation | { ok: false; error: string };

function calculationError(message: string): Error {
  return new Error(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundedResult(value: number): number {
  if (!Number.isFinite(value)) {
    throw calculationError('结果超出可计算范围');
  }
  // 对未舍入的结果严格检查；toPrecision(12) 只用于显示（阶段 4 收尾修正）。
  if (Math.abs(value) > LIMITS.maxNumberMagnitude) {
    throw calculationError('结果超出可计算范围');
  }
  return value;
}

/** 白名单解释器：同一实例共享运算预算与派生值缓存。 */
class EvaluationEngine {
  private readonly values = new Map<string, number>();
  private readonly errors = new Map<string, string>();
  private readonly calculating = new Set<string>();
  /** 函数曲线采样时注入的当前 x；null 表示未经采样入口。 */
  private xSample: number | null = null;
  /** v5 模型标量，按 `${modelId}.${key}` 索引；只保存有限数字。 */
  private readonly modelValues = new Map<string, number>();
  operations = 0;

  constructor(
    private readonly document: StatefulDocumentLike,
    private readonly state: InteractiveStateValues,
    private readonly operationCap: number = LIMITS.maxEvaluationOperations,
  ) {}

  /** 单条表达式求值，失败以结果形式返回，不向调用方抛出。 */
  evaluate(expression: NumericExpression | FunctionExpression): ExpressionResult {
    try {
      return { ok: true, value: this.node(expression) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  /** 把已成功计算的模型标量注入共享引擎，供后续模型/元素表达式读取。 */
  setModelScalars(modelId: string, scalars: Record<string, number | null>): void {
    for (const [key, value] of Object.entries(scalars)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        this.modelValues.set(`${modelId}.${key}`, value);
      }
    }
  }

  /** 函数曲线采样：在给定 x 处求值（x 由本调用临时注入，不跨调用残留）。 */
  evaluateAt(expression: FunctionExpression, x: number): ExpressionResult {
    const previous = this.xSample;
    this.xSample = x;
    try {
      return this.evaluate(expression);
    } finally {
      this.xSample = previous;
    }
  }

  /** 按需计算派生值；同名派生结果与错误都会缓存。 */
  resolveDerived(id: string): ExpressionResult {
    const cached = this.values.get(id);
    if (cached !== undefined) return { ok: true, value: cached };
    const cachedError = this.errors.get(id);
    if (cachedError !== undefined) return { ok: false, error: cachedError };
    const definition = this.document.derived.find((item) => item.id === id);
    if (!definition) return { ok: false, error: '派生值不存在' };
    if (this.calculating.has(id)) return { ok: false, error: '检测到循环依赖' };

    this.calculating.add(id);
    try {
      const value = this.node(definition.expression);
      this.values.set(id, value);
      return { ok: true, value };
    } catch (error) {
      const message = errorMessage(error);
      this.errors.set(id, message);
      return { ok: false, error: message };
    } finally {
      this.calculating.delete(id);
    }
  }

  /** 依次求值全部派生值并返回快照。 */
  snapshotDerived(): DerivedCalculation {
    for (const definition of this.document.derived) this.resolveDerived(definition.id);
    return {
      values: Object.fromEntries(this.values),
      errors: Object.fromEntries(this.errors),
      operations: this.operations,
    };
  }

  private node(expression: NumericExpression | FunctionExpression): number {
    this.operations += 1;
    if (this.operations > this.operationCap) {
      throw calculationError('计算量超过单次更新上限');
    }

    switch (expression.op) {
      case 'x': {
        if (this.xSample === null) throw calculationError('变量 x 仅可用于函数曲线表达式');
        return boundedResult(this.xSample);
      }
      case 'const':
        return boundedResult(expression.value);
      case 'state': {
        if (!Object.hasOwn(this.state, expression.id)) {
          throw calculationError(`数值状态 ${expression.id} 不可用`);
        }
        const value = this.state[expression.id];
        if (typeof value !== 'number') {
          throw calculationError(`数值状态 ${expression.id} 不可用`);
        }
        return boundedResult(value);
      }
      case 'derived': {
        const resolved = this.resolveDerived(expression.id);
        if (!resolved.ok) throw calculationError(`依赖项 ${expression.id} 无法计算：${resolved.error}`);
        return resolved.value;
      }
      case 'model': {
        const key = `${expression.model}.${expression.key}`;
        const value = this.modelValues.get(key);
        if (value === undefined) {
          throw calculationError(`模型值 ${key} 不可用`);
        }
        return boundedResult(value);
      }
      case 'negate':
        return boundedResult(-this.node(expression.value));
      case 'abs':
        return boundedResult(Math.abs(this.node(expression.value)));
      case 'round':
        return boundedResult(Math.round(this.node(expression.value)));
      case 'floor':
        return boundedResult(Math.floor(this.node(expression.value)));
      case 'ceil':
        return boundedResult(Math.ceil(this.node(expression.value)));
      case 'add':
        return boundedResult(this.node(expression.left) + this.node(expression.right));
      case 'subtract':
        return boundedResult(this.node(expression.left) - this.node(expression.right));
      case 'multiply':
        return boundedResult(this.node(expression.left) * this.node(expression.right));
      case 'divide': {
        const numerator = this.node(expression.left);
        const denominator = this.node(expression.right);
        if (denominator === 0) throw calculationError('除数不能为 0');
        return boundedResult(numerator / denominator);
      }
      case 'min':
        return boundedResult(Math.min(this.node(expression.left), this.node(expression.right)));
      case 'max':
        return boundedResult(Math.max(this.node(expression.left), this.node(expression.right)));
      default: {
        const exhaustive: never = expression;
        throw calculationError(`不支持的运算：${String(exhaustive)}`);
      }
    }
  }
}

/** v2–v5 本地状态的初始快照；每张卡片各自持有一个对象。 */
export function createInitialState(document: StatefulDocument): InteractiveStateValues {
  return Object.fromEntries(document.state.map((variable) => [variable.id, variable.initial]));
}

/** v2 派生值计算；保留原有 API 供渲染器与测试使用。 */
export function calculateDerived(
  document: StatefulDocument,
  state: InteractiveStateValues,
): DerivedCalculation {
  return new EvaluationEngine(document, state).snapshotDerived();
}

function isNumericExpression(cell: unknown): cell is NumericExpression {
  return typeof cell === 'object' && cell !== null && 'op' in cell;
}

const DEFAULT_MODEL_LABEL: Record<ModelKind, string> = {
  budget: '预算',
  cost: '成本比较',
  preference: '偏好比较',
};

type ModelCore = Omit<ModelResult, 'operations'>;

function readModelNumber(
  engine: EvaluationEngine,
  expression: NumericExpression,
  label: string,
): number {
  const result = engine.evaluate(expression);
  if (!result.ok) throw calculationError(`${label}无法计算：${result.error}`);
  if (!Number.isFinite(result.value)) throw calculationError(`${label}不是有限数字`);
  return result.value;
}

/** 筛选阈值既可是常量，也可是表达式；两种写法走同一数值边界检查。 */
function readFilterBound(
  engine: EvaluationEngine,
  value: NumericExpression | number,
  label: string,
): number {
  const result = typeof value === 'number' ? value : readModelNumber(engine, value, label);
  if (!Number.isFinite(result)) throw calculationError(`${label}不是有限数字`);
  if (Math.abs(result) > LIMITS.maxNumberMagnitude) {
    throw calculationError(`${label}超出可计算范围`);
  }
  return result;
}

/** 权重既可是常量，也可是表达式；非负且不超过权重上限。 */
function readModelWeight(
  engine: EvaluationEngine,
  value: NumericExpression | number,
  label: string,
  diagnostics: ModelDiagnostic[],
): number {
  const raw = typeof value === 'number' ? value : readModelNumber(engine, value, label);
  if (!Number.isFinite(raw)) throw calculationError(`${label}不是有限数字`);
  if (raw < 0) {
    diagnostics.push({ level: 'warn', message: `${label}为负数，按 0 计算` });
    return 0;
  }
  if (raw > LIMITS.maxPreferenceWeight) {
    diagnostics.push({
      level: 'warn',
      message: `${label}超过上限 ${LIMITS.maxPreferenceWeight}，按上限计算`,
    });
    return LIMITS.maxPreferenceWeight;
  }
  return raw;
}

function clampModelAmount(
  value: number,
  label: string,
  diagnostics: ModelDiagnostic[],
): number {
  if (value < 0) {
    diagnostics.push({ level: 'warn', message: `${label}为负数，按 0 计算` });
    return 0;
  }
  if (Math.abs(value) > LIMITS.maxModelAmount) {
    throw calculationError(`${label}超过模型金额上限 ${LIMITS.maxModelAmount}`);
  }
  return value;
}

function clampModelNonNegative(
  value: number,
  label: string,
  diagnostics: ModelDiagnostic[],
): number {
  if (value < 0) {
    diagnostics.push({ level: 'warn', message: `${label}为负数，按 0 计算` });
    return 0;
  }
  return value;
}

function toMinor(value: number, precision: number): number {
  const factor = 10 ** precision;
  const minor = Math.round(Math.abs(value) * factor + 1e-9);
  return value < 0 ? -minor : minor;
}

function fromMinor(minor: number, precision: number): number {
  const value = minor / 10 ** precision;
  return Object.is(value, -0) ? 0 : value;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * 购买份数向上取整。十进制输入经二进制浮点除法后可能略高于整数
 * （例如 0.07 / 0.01 = 7.000000000000001），先用相对容差吸收这种误差，
 * 避免把恰好整除的周期误算成多买一份。
 */
function ceilPurchases(horizon: number, coverage: number): number {
  const ratio = horizon / coverage;
  const nearest = Math.round(ratio);
  const tolerance = 1e-9 * Math.max(1, Math.abs(ratio));
  if (nearest >= 1 && Math.abs(ratio - nearest) <= tolerance) {
    return nearest;
  }
  return Math.ceil(ratio);
}

function formatFixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return text === '-0' || /^-0\.0+$/.test(text) ? text.slice(1) : text;
}

function formatModelMoney(value: number, precision: number, unit: string): string {
  return `${formatFixed(value, precision)}${unit ? ` ${unit}` : ''}`;
}

/** 预算模型：收入与支出先转整数最小单位，再求和/求比例，避免浮点累计误差。 */
function computeBudgetModel(engine: EvaluationEngine, model: BudgetModel): ModelCore {
  const diagnostics: ModelDiagnostic[] = [];
  const precision = model.precision ?? DEFAULT_MODEL_PRECISION;
  const unit = model.unit ?? '';
  const income = clampModelAmount(
    readModelNumber(engine, model.income, '收入'),
    '收入',
    diagnostics,
  );
  const expenses = model.expenses.map((expense, index) => {
    const amount = clampModelAmount(
      readModelNumber(engine, expense.amount, `支出「${expense.label}」`),
      `支出「${expense.label}」`,
      diagnostics,
    );
    return {
      label: expense.label || `支出 ${index + 1}`,
      amount,
      minor: toMinor(amount, precision),
    };
  });

  const incomeMinor = toMinor(income, precision);
  let expensesMinor = 0;
  for (const expense of expenses) {
    expensesMinor += expense.minor;
    if (!Number.isSafeInteger(expensesMinor)) {
      throw calculationError('支出合计超出可计算范围');
    }
  }

  const incomeValue = fromMinor(incomeMinor, precision);
  const expensesValue = fromMinor(expensesMinor, precision);
  const balance = fromMinor(incomeMinor - expensesMinor, precision);
  const usage = incomeMinor > 0 ? roundTo((expensesMinor / incomeMinor) * 100, 1) : null;
  const overspend = expensesMinor > incomeMinor ? 1 : 0;

  const summary: ModelTable = {
    columns: [
      { key: 'item', label: '项目' },
      { key: 'amount', label: '金额', numeric: true, unit },
      { key: 'share', label: '支出占比', numeric: true, unit: '%' },
    ],
    rows: [
      { item: '收入', amount: incomeValue, share: null },
      { item: '支出', amount: expensesValue, share: usage },
      { item: '余额', amount: balance, share: null },
    ],
  };
  const items: ModelTable = {
    columns: [
      { key: 'item', label: '支出项' },
      { key: 'amount', label: '金额', numeric: true, unit },
      { key: 'share', label: '占支出', numeric: true, unit: '%' },
    ],
    rows: expenses.map((expense) => ({
      item: expense.label,
      amount: fromMinor(expense.minor, precision),
      share:
        expensesMinor > 0 ? roundTo((expense.minor / expensesMinor) * 100, 1) : null,
    })),
    emptyText: '暂无支出项',
  };

  if (income === 0) {
    diagnostics.push({ level: 'info', message: '收入为 0，支出占比不可用' });
  }
  if (expenses.length === 0) {
    diagnostics.push({ level: 'info', message: '没有支出项，支出合计为 0' });
  }
  if (overspend === 1) {
    diagnostics.push({ level: 'warn', message: '支出超过收入，余额为负' });
  }

  return {
    ok: true,
    id: model.id,
    kind: 'budget',
    label: model.label ?? DEFAULT_MODEL_LABEL.budget,
    scalars: {
      income: incomeValue,
      expenses: expensesValue,
      balance,
      overspend,
      usage,
      itemCount: expenses.length,
    },
    tables: { summary, items },
    chartItems: [
      { label: '收入', value: incomeValue },
      { label: '支出', value: expensesValue },
    ],
    diagnostics,
    basis: [
      { label: '收入', value: formatModelMoney(incomeValue, precision, unit) },
      { label: '支出', value: formatModelMoney(expensesValue, precision, unit) },
      { label: '余额', value: formatModelMoney(balance, precision, unit) },
      { label: '支出占比', value: usage === null ? '不可用' : `${formatFixed(usage, 1)}%` },
      { label: '超支', value: overspend === 1 ? '是' : '否' },
    ],
    formula: '金额按精度转整数最小单位求和：收入 − 支出 = 余额；支出 ÷ 收入 = 支出占比。',
  };
}

/** 成本模型：按整份购买计算总成本，再用实际总次数得到单次成本。 */
function computeCostModel(engine: EvaluationEngine, model: CostModel): ModelCore {
  const diagnostics: ModelDiagnostic[] = [];
  const precision = model.precision ?? DEFAULT_MODEL_PRECISION;
  const unit = model.unit ?? '';
  const useUnit = model.useUnit ?? '次';
  const horizon = clampModelNonNegative(
    readModelNumber(engine, model.horizon, '周期'),
    '周期',
    diagnostics,
  );

  const plans = model.plans.map((plan, index) => {
    const fee = clampModelAmount(
      readModelNumber(engine, plan.fee, `方案「${plan.label}」固定费用`),
      `方案「${plan.label}」固定费用`,
      diagnostics,
    );
    const usesPerPeriod = clampModelNonNegative(
      readModelNumber(engine, plan.usesPerPeriod, `方案「${plan.label}」每周期使用次数`),
      `方案「${plan.label}」每周期使用次数`,
      diagnostics,
    );
    const coverage = plan.coverage;
    if (!Number.isFinite(coverage) || coverage <= 0) {
      throw calculationError(`方案「${plan.label}」的覆盖周期必须大于 0`);
    }
    const purchases = horizon > 0 ? ceilPurchases(horizon, coverage) : 0;
    if (!Number.isFinite(purchases)) {
      throw calculationError(`方案「${plan.label}」购买份数超出可计算范围`);
    }
    const totalCostMinor = toMinor(fee, precision) * purchases;
    if (!Number.isSafeInteger(totalCostMinor)) {
      throw calculationError(`方案「${plan.label}」总成本超出可计算范围`);
    }
    const totalCost = fromMinor(totalCostMinor, precision);
    if (Math.abs(totalCost) > LIMITS.maxNumberMagnitude) {
      throw calculationError(`方案「${plan.label}」总成本超出可计算范围`);
    }
    const totalUses = usesPerPeriod * horizon;
    if (!Number.isFinite(totalUses) || totalUses > LIMITS.maxNumberMagnitude) {
      throw calculationError(`方案「${plan.label}」总次数超出可计算范围`);
    }
    const unitCost = totalUses > 0 ? totalCost / totalUses : null;
    return {
      label: plan.label || `方案 ${index + 1}`,
      index,
      purchases,
      coverage,
      totalCost,
      totalUses,
      unitCost,
    };
  });

  const sorted = [...plans].sort((left, right) => {
    if (left.unitCost === null && right.unitCost === null) return left.index - right.index;
    if (left.unitCost === null) return 1;
    if (right.unitCost === null) return -1;
    if (left.unitCost !== right.unitCost) return left.unitCost - right.unitCost;
    if (left.totalCost !== right.totalCost) return left.totalCost - right.totalCost;
    return left.index - right.index;
  });

  let lowestTotalCost: number | null = null;
  let lowestUnitCost: number | null = null;
  for (const plan of plans) {
    if (lowestTotalCost === null || plan.totalCost < lowestTotalCost) {
      lowestTotalCost = plan.totalCost;
    }
    if (
      plan.unitCost !== null &&
      (lowestUnitCost === null || plan.unitCost < lowestUnitCost)
    ) {
      lowestUnitCost = plan.unitCost;
    }
  }

  const table: ModelTable = {
    columns: [
      { key: 'plan', label: '方案' },
      { key: 'purchases', label: '购买份数', numeric: true },
      { key: 'coverage', label: '覆盖周期', numeric: true },
      { key: 'totalCost', label: '总成本', numeric: true, unit },
      { key: 'totalUses', label: '总次数', numeric: true, unit: useUnit },
      { key: 'unitCost', label: '单次成本', numeric: true, unit },
    ],
    rows: sorted.map((plan) => ({
      plan: plan.label,
      purchases: plan.purchases,
      coverage: plan.coverage,
      totalCost: plan.totalCost,
      totalUses: plan.totalUses,
      unitCost: plan.unitCost,
    })),
  };

  if (horizon === 0) {
    diagnostics.push({ level: 'info', message: '周期为 0，不购买任何方案，总成本与次数为 0' });
  }
  if (horizon > 0 && plans.every((plan) => plan.totalUses === 0)) {
    diagnostics.push({ level: 'info', message: '总次数为 0，单次成本不可用' });
  }
  for (const plan of plans) {
    if (plan.purchases > 0 && plan.purchases * plan.coverage > horizon + 1e-9) {
      diagnostics.push({
        level: 'info',
        message: `方案「${plan.label}」按整份购买，实际覆盖 ${formatFixed(plan.purchases * plan.coverage, 2)} 个周期`,
      });
    }
  }

  return {
    ok: true,
    id: model.id,
    kind: 'cost',
    label: model.label ?? DEFAULT_MODEL_LABEL.cost,
    scalars: {
      horizon: roundTo(horizon, 2),
      planCount: plans.length,
      lowestTotalCost,
      lowestUnitCost,
    },
    tables: { plans: table },
    chartItems: sorted.map((plan) => ({ label: plan.label, value: plan.totalCost })),
    diagnostics,
    basis: [
      { label: '周期', value: formatFixed(horizon, 2) },
      { label: '方案数', value: String(plans.length) },
      {
        label: '最低总成本',
        value:
          lowestTotalCost === null
            ? '不可用'
            : formatModelMoney(lowestTotalCost, precision, unit),
      },
      {
        label: '最低单次成本',
        value:
          lowestUnitCost === null
            ? '不可用'
            : formatModelMoney(lowestUnitCost, precision, unit),
      },
    ],
    formula:
      '总成本 = 固定费用 × 购买份数；购买份数 = ⌈周期 ÷ 每份覆盖周期⌉；单次成本 = 总成本 ÷ 总次数。',
  };
}

type PreferenceCandidateResult = {
  label: string;
  index: number;
  values: Map<string, number | null>;
  normal: Map<string, number | null>;
  eligible: boolean;
  missing: number;
  score: number | null;
  rank: number | null;
};

/** 偏好模型：先筛选，再对维度做 min-max 归一，缺失维度不按 0、不进分母。 */
function computePreferenceModel(
  engine: EvaluationEngine,
  model: PreferenceModel,
): ModelCore {
  const diagnostics: ModelDiagnostic[] = [];
  const precision = model.precision ?? 1;
  const dimensions = model.dimensions;
  const weights = new Map<string, number>();
  let weightTotal = 0;
  for (const dimension of dimensions) {
    const weight = readModelWeight(
      engine,
      dimension.weight,
      `偏好维度「${dimension.label}」权重`,
      diagnostics,
    );
    weights.set(dimension.id, weight);
    weightTotal += weight;
  }
  if (weightTotal <= 0) {
    diagnostics.push({ level: 'info', message: '权重合计为 0，得分不可用' });
  }

  const filters = (model.filters ?? []).map((filter) => {
    const min =
      filter.min === undefined
        ? null
        : readFilterBound(engine, filter.min, `筛选维度「${filter.dimension}」下限`);
    const max =
      filter.max === undefined
        ? null
        : readFilterBound(engine, filter.max, `筛选维度「${filter.dimension}」上限`);
    if (min !== null && max !== null && min > max) {
      diagnostics.push({
        level: 'warn',
        message: `筛选维度「${filter.dimension}」的下限大于上限，没有候选能通过`,
      });
    }
    return { dimension: filter.dimension, min, max };
  });

  const candidates: PreferenceCandidateResult[] = model.candidates.map(
    (candidate, index) => {
      const values = new Map<string, number | null>();
      for (const dimension of dimensions) {
        const raw = Object.hasOwn(candidate.values, dimension.id)
          ? candidate.values[dimension.id]
          : null;
        values.set(
          dimension.id,
          typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
        );
      }
      const eligible = filters.every((filter) => {
        const value = values.get(filter.dimension);
        if (value === null || value === undefined) return false;
        if (filter.min !== null && value < filter.min) return false;
        if (filter.max !== null && value > filter.max) return false;
        return true;
      });
      return {
        label: candidate.label,
        index,
        values,
        normal: new Map<string, number | null>(),
        eligible,
        missing: 0,
        score: null,
        rank: null,
      };
    },
  );

  const eligible = candidates.filter((candidate) => candidate.eligible);
  const stats = new Map<string, { min: number; max: number }>();
  for (const dimension of dimensions) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let count = 0;
    for (const candidate of eligible) {
      const value = candidate.values.get(dimension.id);
      if (value === null || value === undefined) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
      count += 1;
    }
    if (count > 0) stats.set(dimension.id, { min, max });
  }

  for (const candidate of eligible) {
    let weighted = 0;
    let presentWeight = 0;
    let missing = 0;
    for (const dimension of dimensions) {
      const weight = weights.get(dimension.id) ?? 0;
      const value = candidate.values.get(dimension.id);
      const range = stats.get(dimension.id);
      if (value === null || value === undefined || !range) {
        if (weight > 0) missing += 1;
        candidate.normal.set(dimension.id, null);
        continue;
      }
      if (weight <= 0) {
        candidate.normal.set(dimension.id, null);
        continue;
      }
      const normalized =
        range.max === range.min ? 1 : (value - range.min) / (range.max - range.min);
      // 维度没有区分度时，所有现存值同等计为最优；否则 lower 方向会
      // 把唯一的候选从 1 翻成 0，等于用一个不存在的差距惩罚它。
      const oriented =
        range.max === range.min
          ? 1
          : dimension.direction === 'lower'
            ? 1 - normalized
            : normalized;
      candidate.normal.set(dimension.id, roundTo(oriented * 100, 1));
      weighted += oriented * weight;
      presentWeight += weight;
    }
    candidate.missing = missing;
    candidate.score =
      presentWeight > 0 ? roundTo((weighted / presentWeight) * 100, precision) : null;
  }

  const ranked = eligible
    .filter((candidate) => candidate.score !== null)
    .sort((left, right) => {
      const diff = (right.score as number) - (left.score as number);
      if (diff !== 0) return diff;
      if (left.missing !== right.missing) return left.missing - right.missing;
      return left.index - right.index;
    });
  let previousScore: number | null = null;
  let previousRank = 0;
  ranked.forEach((candidate, index) => {
    if (previousScore === null || candidate.score !== previousScore) {
      previousRank = index + 1;
      previousScore = candidate.score;
    }
    candidate.rank = previousRank;
  });
  const unscored = eligible.filter((candidate) => candidate.score === null);
  const ordered = [...ranked, ...unscored];
  const topScore = ranked.length > 0 ? ranked[0].score : null;

  const ranking: ModelTable = {
    columns: [
      { key: 'rank', label: '排名', numeric: true },
      { key: 'candidate', label: '候选' },
      { key: 'score', label: '得分', numeric: true },
      { key: 'missing', label: '缺失维度', numeric: true },
    ],
    rows: ordered.map((candidate) => ({
      rank: candidate.rank,
      candidate: candidate.label,
      score: candidate.score,
      missing: candidate.missing,
    })),
    emptyText:
      model.candidates.length === 0
        ? '没有候选资料'
        : '没有候选通过筛选',
  };

  const breakdown: ModelTable = {
    columns: [
      { key: 'candidate', label: '候选' },
      { key: 'score', label: '得分', numeric: true },
      ...dimensions.map((dimension) => ({
        key: `d_${dimension.id}`,
        label: dimension.label,
        numeric: true,
        unit: '%',
      })),
    ],
    rows: ordered.map((candidate) => {
      const row: Record<string, ModelTableCell> = {
        candidate: candidate.label,
        score: candidate.score,
      };
      for (const dimension of dimensions) {
        row[`d_${dimension.id}`] = candidate.normal.get(dimension.id) ?? null;
      }
      return row;
    }),
    emptyText:
      model.candidates.length === 0
        ? '没有候选资料'
        : '没有候选通过筛选',
  };

  if (model.candidates.length === 0) {
    diagnostics.push({ level: 'warn', message: '没有候选资料，无法比较' });
  } else if (eligible.length === 0) {
    diagnostics.push({ level: 'warn', message: '没有候选通过筛选，无法比较' });
  }
  const filteredOut = model.candidates.length - eligible.length;
  if (filteredOut > 0) {
    diagnostics.push({
      level: 'info',
      message: `${filteredOut} 个候选未通过筛选或缺少筛选维度`,
    });
  }
  if (unscored.length > 0) {
    diagnostics.push({
      level: 'info',
      message: `${unscored.length} 个候选没有可计权维度，未参与排名`,
    });
  }
  if (eligible.some((candidate) => candidate.missing > 0)) {
    diagnostics.push({
      level: 'info',
      message: '缺失维度不按 0 计，也不进入得分分母',
    });
  }

  return {
    ok: true,
    id: model.id,
    kind: 'preference',
    label: model.label ?? DEFAULT_MODEL_LABEL.preference,
    scalars: {
      candidateCount: model.candidates.length,
      eligibleCount: eligible.length,
      rankedCount: ranked.length,
      topScore,
      weightTotal: roundTo(weightTotal, 2),
      dimensionCount: dimensions.length,
    },
    tables: { ranking, breakdown },
    chartItems: ranked.map((candidate) => ({
      label: candidate.label,
      value: candidate.score as number,
    })),
    diagnostics,
    basis: [
      { label: '候选数', value: String(model.candidates.length) },
      { label: '通过筛选', value: String(eligible.length) },
      { label: '参与排名', value: String(ranked.length) },
      { label: '最高得分', value: topScore === null ? '不可用' : formatFixed(topScore, precision) },
      { label: '权重合计', value: formatFixed(weightTotal, 2) },
    ],
    formula:
      '得分 = Σ(维度归一值 × 权重) ÷ Σ权重 × 100；缺失维度不按 0 计，也不进入分母。',
  };
}

function evaluateSemanticModel(engine: EvaluationEngine, model: SemanticModel): ModelCore {
  switch (model.kind) {
    case 'budget':
      return computeBudgetModel(engine, model);
    case 'cost':
      return computeCostModel(engine, model);
    case 'preference':
      return computePreferenceModel(engine, model);
    default: {
      const exhaustive: never = model;
      throw calculationError(`不支持的模型类型：${String(exhaustive)}`);
    }
  }
}

function failedModel(model: SemanticModel, error: string, operations: number): ModelResult {
  return {
    ok: false,
    id: model.id,
    kind: model.kind,
    label: model.label ?? DEFAULT_MODEL_LABEL[model.kind],
    error,
    scalars: {},
    tables: {},
    chartItems: [],
    diagnostics: [],
    basis: [],
    formula: '',
    operations,
  };
}

/** 结构扫描：表达式是否引用局部变量 x（常量函数无需零点覆盖扩展）。 */
function expressionUsesX(expression: FunctionExpression): boolean {
  switch (expression.op) {
    case 'x':
      return true;
    case 'const':
    case 'state':
    case 'derived':
      return false;
    case 'negate':
    case 'abs':
    case 'round':
    case 'floor':
    case 'ceil':
      return expressionUsesX(expression.value);
    default:
      return expressionUsesX(expression.left) || expressionUsesX(expression.right);
  }
}

/**
 * v3/v4/v5 组合文档求值：派生值、语义模型、图表/表格内联表达式、条件说明
 * 谓词与 v4 函数曲线采样在一次 `useMemo` 内全部算完。失败被限制在单个
 * 表达式、条件、函数系列或模型上，不阻断整张卡片。
 */
export function evaluateComposite(
  document: GenuiV3Document | GenuiV4Document | GenuiV5Document,
  state: InteractiveStateValues,
): CompositeEvaluation {
  const engine = new EvaluationEngine(document, state);
  const derived = engine.snapshotDerived();

  const expressions = new Map<NumericExpression, ExpressionResult>();
  const conditions = new Map<Condition, ConditionResult>();
  const functions = new Map<ChartFunctionDefinition, FunctionSeriesResult>();
  const models = new Map<string, ModelResult>();

  if (document.version === 5) {
    for (const model of document.models) {
      // 每个模型使用独立引擎与独立预算：模型输入可读 state/derived 和更早
      // 模型的标量，但不会占用元素/条件的共享 500 次池，也不会把失败扩散
      // 到其他模型。
      const modelEngine = new EvaluationEngine(document, state, LIMITS.maxModelWork);
      for (const [earlierId, earlier] of models) {
        if (earlier.ok) modelEngine.setModelScalars(earlierId, earlier.scalars);
      }
      try {
        const core = evaluateSemanticModel(modelEngine, model);
        models.set(model.id, { ...core, operations: modelEngine.operations });
        engine.setModelScalars(model.id, core.scalars);
      } catch (error) {
        models.set(
          model.id,
          failedModel(model, errorMessage(error), modelEngine.operations),
        );
      }
    }
  }

  const valueOf = (expression: NumericExpression): ExpressionResult => {
    const cached = expressions.get(expression);
    if (cached) return cached;
    const result = engine.evaluate(expression);
    expressions.set(expression, result);
    return result;
  };

  const compare = (op: Condition['op'], left: number, right: number): boolean => {
    switch (op) {
      case 'num-eq':
        return left === right;
      case 'num-neq':
        return left !== right;
      case 'num-gt':
        return left > right;
      case 'num-gte':
        return left >= right;
      case 'num-lt':
        return left < right;
      case 'num-lte':
        return left <= right;
      default:
        throw calculationError(`不支持的条件运算：${op}`);
    }
  };

  const evaluateCondition = (condition: Condition, depth: number): ConditionResult => {
    try {
      if (depth > LIMITS.maxConditionDepth) {
        throw calculationError('条件嵌套超过上限');
      }
      if (condition.op === 'state-eq' || condition.op === 'state-neq') {
        if (!Object.hasOwn(state, condition.id)) {
          throw calculationError(`条件引用的状态 ${condition.id} 不存在`);
        }
        const value = state[condition.id];
        if (typeof value !== 'string') {
          throw calculationError(`条件引用的状态 ${condition.id} 不是选择状态`);
        }
        const equal = value === condition.value;
        return { ok: true, value: condition.op === 'state-eq' ? equal : !equal };
      }
      if (condition.op === 'and' || condition.op === 'or') {
        for (const child of condition.conditions) {
          const result = evaluateCondition(child, depth + 1);
          if (!result.ok) return result;
          if (condition.op === 'and' && !result.value) return { ok: true, value: false };
          if (condition.op === 'or' && result.value) return { ok: true, value: true };
        }
        return { ok: true, value: condition.op === 'and' };
      }
      if (condition.op === 'not') {
        const result = evaluateCondition(condition.condition, depth + 1);
        return result.ok ? { ok: true, value: !result.value } : result;
      }

      if (!('left' in condition) || !('right' in condition)) {
        throw calculationError(`不支持的条件运算：${String(condition.op)}`);
      }
      const left = valueOf(condition.left);
      if (!left.ok) return { ok: false, error: left.error };
      const right = valueOf(condition.right);
      if (!right.ok) return { ok: false, error: right.error };
      return { ok: true, value: compare(condition.op, left.value, right.value) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  };

  const conditionOf = (condition: Condition): ConditionResult => {
    const cached = conditions.get(condition);
    if (cached) return cached;
    const result = evaluateCondition(condition, 1);
    conditions.set(condition, result);
    return result;
  };

  /**
   * v4 函数曲线采样：每系列独立引擎与专用运算预算（不占用共享池）。
   * 可选 domain 表达式在共享池求值；失败（例如 a=0 时的顶点除零）按设计
   * 静默回退默认域，不向用户显示错误。features=['zero'] 触发对称倍增重采样：
   * 仅当扩展后零点覆盖更近时保留，否则撤销扩展（无实根/相切零点不会把
   * 视口扩到不可辨认），最终未覆盖时 zeroFound=false 由渲染层提示「未找到零点」。
   */
  const sampleFunctionSeries = (definition: ChartFunctionDefinition): FunctionSeriesResult => {
    const samplingEngine = new EvaluationEngine(
      document,
      state,
      LIMITS.maxFunctionSampleOperations,
    );
    const budgetError = '函数曲线采样运算量超过上限';
    const outOfBudget = (): boolean =>
      samplingEngine.operations > LIMITS.maxFunctionSampleOperations;

    /** 一轮完整采样：samples 个等分位置逐点求 y，失败样本记为 null。 */
    const runPass = (domain: { start: number; end: number }, samples: number) => {
      const xs: number[] = [];
      const ys: Array<number | null> = [];
      let dropped = 0;
      let minAbsY = Number.POSITIVE_INFINITY;
      for (let index = 0; index < samples; index += 1) {
        const x = domain.start + ((domain.end - domain.start) * index) / (samples - 1);
        xs.push(x);
        const result = samplingEngine.evaluateAt(definition.expression, x);
        if (result.ok) {
          ys.push(result.value);
          minAbsY = Math.min(minAbsY, Math.abs(result.value));
        } else {
          ys.push(null);
          dropped += 1;
        }
      }
      // 零点覆盖判定：任一样本精确为 0，或最近两个非空样本符号相反。
      let zeroCovered = false;
      let previousIndex = -1;
      for (let index = 0; index < xs.length; index += 1) {
        const y = ys[index];
        if (y === null) continue;
        if (y === 0) {
          zeroCovered = true;
          break;
        }
        if (previousIndex >= 0 && (ys[previousIndex] as number) * y < 0) {
          zeroCovered = true;
          break;
        }
        previousIndex = index;
      }
      return { xs, ys, dropped, minAbsY, zeroCovered };
    };

    let domain: { start: number; end: number } = {
      start: -LIMITS.defaultFunctionDomainHalfWidth,
      end: LIMITS.defaultFunctionDomainHalfWidth,
    };
    let fallbackDomain = false;
    if (definition.domain) {
      const start = valueOf(definition.domain.start);
      const end = valueOf(definition.domain.end);
      if (
        start.ok &&
        end.ok &&
        Number.isFinite(start.value) &&
        Number.isFinite(end.value) &&
        end.value > start.value
      ) {
        domain = { start: start.value, end: end.value };
      } else {
        fallbackDomain = true;
      }
    }

    const samples = Math.min(
      LIMITS.maxFunctionSamples,
      Math.max(5, definition.samples ?? LIMITS.defaultFunctionSamples),
    );

    const wantsZero = definition.features?.includes('zero') ?? false;

    if (!expressionUsesX(definition.expression)) {
      // 常量函数不随 x 变化，采样一轮即可，无需零点覆盖扩展。
      const pass = runPass(domain, samples);
      if (outOfBudget()) return { ok: false, error: budgetError };
      return {
        ok: true,
        domain,
        xs: pass.xs,
        ys: pass.ys,
        dropped: pass.dropped,
        expanded: false,
        zeroFound: wantsZero ? pass.zeroCovered : true,
        fallbackDomain,
      };
    }

    let pass = runPass(domain, samples);
    if (outOfBudget()) return { ok: false, error: budgetError };
    let expanded = false;
    if (wantsZero && !pass.zeroCovered) {
      for (let round = 0; round < LIMITS.maxFunctionExpandRounds; round += 1) {
        const previousPass = pass;
        const previousDomain = { ...domain };
        const center = (domain.start + domain.end) / 2;
        const halfWidth = domain.end - domain.start;
        const nextStart = center - halfWidth;
        const nextEnd = center + halfWidth;
        if (
          !Number.isFinite(nextStart) ||
          !Number.isFinite(nextEnd) ||
          Math.abs(nextStart) > LIMITS.maxNumberMagnitude ||
          Math.abs(nextEnd) > LIMITS.maxNumberMagnitude
        ) {
          break; // 幅值超限提前停
        }
        domain = { start: nextStart, end: nextEnd };
        const nextPass = runPass(domain, samples);
        if (outOfBudget()) return { ok: false, error: budgetError };
        if (!nextPass.zeroCovered && nextPass.minAbsY >= previousPass.minAbsY) {
          // 扩展无益（等距采样下 0 距离没有更近，例如无实根或相切零点）：
          // 撤销本轮，保留上一个视口与采样，避免视口被持续放大。
          domain = previousDomain;
          pass = previousPass;
          break;
        }
        expanded = true;
        pass = nextPass;
        if (pass.zeroCovered) break;
      }
    }

    return {
      ok: true,
      domain,
      xs: pass.xs,
      ys: pass.ys,
      dropped: pass.dropped,
      expanded,
      zeroFound: wantsZero ? pass.zeroCovered : true,
      fallbackDomain,
    };
  };

  const walk = (
    elements: Array<GenuiV3Element | GenuiV4Element | GenuiV5Element>,
  ): void => {
    for (const element of elements) {
      switch (element.kind) {
        case 'text':
        case 'note':
          if (element.visibleIf) conditionOf(element.visibleIf);
          break;
        case 'explain':
          if (element.visibleIf) conditionOf(element.visibleIf);
          break;
        case 'chart':
          if ('source' in element) break;
          if (element.chartType === 'line') {
            for (const series of element.series) {
              if ('function' in series) {
                if (!functions.has(series.function)) {
                  functions.set(series.function, sampleFunctionSeries(series.function));
                }
                continue;
              }
              for (const point of series.points) valueOf(point.y);
            }
          } else {
            for (const item of element.items) valueOf(item.value);
          }
          break;
        case 'table':
          if (element.visibleIf) conditionOf(element.visibleIf);
          if ('source' in element) break;
          for (const row of element.rows) {
            if (row.visibleIf) conditionOf(row.visibleIf);
            for (const cell of Object.values(row.cells)) {
              if (isNumericExpression(cell)) valueOf(cell);
            }
          }
          break;
        case 'section':
          walk(element.children);
          break;
        case 'columns':
          for (const column of element.columns) walk(column);
          break;
        default:
          break;
      }
    }
  };

  walk(document.elements);

  derived.operations = engine.operations;
  return { derived, expressions, conditions, functions, models, operations: engine.operations };
}

/** 渲染阶段读取已求值的内联表达式；缺失视为未求值而不是现场计算。 */
export function lookupExpression(
  evaluation: CompositeEvaluation,
  expression: NumericExpression,
): ExpressionResult {
  return evaluation.expressions.get(expression) ?? { ok: false, error: '表达式未求值' };
}

/** 渲染阶段读取已求值的条件。 */
export function lookupCondition(
  evaluation: CompositeEvaluation,
  condition: Condition,
): ConditionResult {
  return evaluation.conditions.get(condition) ?? { ok: false, error: '条件未求值' };
}

/** 渲染阶段读取已求值的函数曲线系列；缺失视为未求值而不是现场计算。 */
export function lookupFunctionSeries(
  evaluation: CompositeEvaluation,
  definition: ChartFunctionDefinition,
): FunctionSeriesResult {
  return evaluation.functions.get(definition) ?? { ok: false, error: '函数曲线未求值' };
}

/** 渲染阶段读取已求值模型；缺失返回 null，由调用方显示明确错误。 */
export function lookupModel(
  evaluation: CompositeEvaluation,
  modelId: string,
): ModelResult | null {
  return evaluation.models.get(modelId) ?? null;
}

/** 读取模型标量；模型失败或标量为 null 时返回错误而不是伪造 0。 */
export function lookupModelScalar(
  evaluation: CompositeEvaluation,
  modelId: string,
  key: string,
): ExpressionResult {
  const model = evaluation.models.get(modelId);
  if (!model) return { ok: false, error: '模型未求值' };
  if (!model.ok) return { ok: false, error: model.error ?? '模型计算失败' };
  if (!Object.hasOwn(model.scalars, key)) return { ok: false, error: '模型标量不存在' };
  const value = model.scalars[key];
  if (value === null) return { ok: false, error: '该模型值在当前数据下不可用' };
  return { ok: true, value };
}

/** 读取模型表格视图；view 省略时按模型类型取默认视图。 */
export function modelTable(result: ModelResult, view?: string): ModelTable | null {
  if (!result.ok) return null;
  const key = view ?? DEFAULT_MODEL_VIEW[result.kind];
  return result.tables[key] ?? null;
}
