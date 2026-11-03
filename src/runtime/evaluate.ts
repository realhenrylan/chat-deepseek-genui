import {
  LIMITS,
  type ChartFunctionDefinition,
  type Condition,
  type DerivedCalculation,
  type FunctionExpression,
  type GenuiV2Document,
  type GenuiV3Document,
  type GenuiV3Element,
  type GenuiV4Document,
  type GenuiV4Element,
  type InteractiveStateValues,
  type NumericExpression,
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

type StatefulDocument = GenuiV2Document | GenuiV3Document | GenuiV4Document;

/** 运行时只需要状态与派生定义；v2/v3/v4 文档都满足该结构。 */
interface StatefulDocumentLike {
  state: StatefulDocument['state'];
  derived: StatefulDocument['derived'];
}

export type ExpressionResult = { ok: true; value: number } | { ok: false; error: string };
export type ConditionResult = { ok: true; value: boolean } | { ok: false; error: string };

/** v3/v4 文档一次状态更新后的完整求值快照。 */
export interface CompositeEvaluation {
  derived: DerivedCalculation;
  expressions: Map<NumericExpression, ExpressionResult>;
  conditions: Map<Condition, ConditionResult>;
  /** v4 函数曲线系列的采样结果，按 function 定义对象身份索引。 */
  functions: Map<ChartFunctionDefinition, FunctionSeriesResult>;
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
  /** 是否触发过零点覆盖的 ×2 重采样。 */
  expanded: boolean;
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
  operations = 0;

  constructor(
    private readonly document: StatefulDocumentLike,
    private readonly state: InteractiveStateValues,
    private readonly operationCap: number = LIMITS.maxEvaluationOperations,
  ) {}

  /** 单条表达式求值，失败以结果形式返回，不向调用方抛出。 */
  evaluate(expression: FunctionExpression): ExpressionResult {
    try {
      return { ok: true, value: this.node(expression) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
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

  private node(expression: FunctionExpression): number {
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

/** v2/v3/v4 本地状态的初始快照；每张卡片各自持有一个对象。 */
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
 * v3/v4 组合文档求值：派生值、图表/表格内联表达式、条件说明谓词与 v4 函数
 * 曲线采样在一次 `useMemo` 内全部算完。失败被限制在单个表达式、条件或函数
 * 系列上，不阻断整张卡片。
 */
export function evaluateComposite(
  document: GenuiV3Document | GenuiV4Document,
  state: InteractiveStateValues,
): CompositeEvaluation {
  const engine = new EvaluationEngine(document, state);
  const derived = engine.snapshotDerived();

  const expressions = new Map<NumericExpression, ExpressionResult>();
  const conditions = new Map<Condition, ConditionResult>();
  const functions = new Map<ChartFunctionDefinition, FunctionSeriesResult>();

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
   * 静默回退默认域，不向用户显示错误。features=['zero'] 触发对称倍增重采样。
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
      for (let index = 0; index < samples; index += 1) {
        const x = domain.start + ((domain.end - domain.start) * index) / (samples - 1);
        xs.push(x);
        const result = samplingEngine.evaluateAt(definition.expression, x);
        if (result.ok) {
          ys.push(result.value);
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
      return { xs, ys, dropped, zeroCovered };
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
        fallbackDomain,
      };
    }

    const wantsZero = definition.features?.includes('zero') ?? false;
    let pass = runPass(domain, samples);
    if (outOfBudget()) return { ok: false, error: budgetError };
    let expanded = false;
    if (wantsZero && !pass.zeroCovered) {
      for (let round = 0; round < LIMITS.maxFunctionExpandRounds; round += 1) {
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
        expanded = true;
        pass = runPass(domain, samples);
        if (outOfBudget()) return { ok: false, error: budgetError };
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
      fallbackDomain,
    };
  };

  const walk = (elements: Array<GenuiV3Element | GenuiV4Element>): void => {
    for (const element of elements) {
      switch (element.kind) {
        case 'text':
        case 'note':
          if (element.visibleIf) conditionOf(element.visibleIf);
          break;
        case 'chart':
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
  return { derived, expressions, conditions, functions, operations: engine.operations };
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
