import type { ErrorObject } from 'ajv';
import genuiValidate from './genui-validator.generated';
import { isStepAligned } from './step';
import {
  LIMITS,
  MODEL_SCALAR_KEYS,
  MODEL_TABLE_VIEWS,
  PROTOCOL_VERSION,
  type ChartFunctionSeries,
  type Condition,
  type DerivedValue,
  type FunctionExpression,
  type GenuiDocument,
  type GenuiV2Document,
  type GenuiV3Document,
  type GenuiV3Element,
  type GenuiV4Document,
  type GenuiV4Element,
  type GenuiV5Document,
  type GenuiV5Element,
  type InteractiveElement,
  type ModelValueElement,
  type NumericExpression,
  type ParseGenuiResult,
  type SemanticModel,
  type StateVariable,
} from './types';

/**
 * genui 协议解析与验证（v1 静态 / v2 交互 / v3-v4 组合；v4 新增函数曲线系列）。
 *
 * 守卫顺序（每一步先于解析成本更高的步骤）：
 * 1. too-large          原始长度上限；
 * 2. too-deep           字符串感知的嵌套深度扫描（先于 JSON.parse 拦截病态输入）；
 * 3. invalid-json       JSON.parse 失败；
 * 4. schema-violation   结构校验（Ajv allErrors，构建期代码生成，见下）；
 * 5. 语义检查            引用、依赖、初始状态、组合布局与资源预算。
 *
 * 失败 detail 面向日志与测试断言，不面向用户；用户看到的是原始代码块回退。
 */

/**
 * 构建期生成的校验器（scripts/gen-validator.ts → genui-validator.generated.ts）。
 * 调用后 .errors 与 Ajv ErrorObject 形状一致，formatErrors 复用同一格式。
 * MV3 内容脚本 CSP 禁止 'unsafe-eval'，Ajv 运行时编译会抛 EvalError
 * （e2e 在 Edge/Chrome 实测），因此运行时只消费构建期生成的纯函数。
 */
interface GeneratedValidator {
  (data: unknown): boolean;
  errors: ErrorObject[] | null;
}

const validate = genuiValidate as unknown as GeneratedValidator;

/**
 * 字符串感知的括号深度扫描：引号内的 { } [ ] 不计入深度，
 * 反斜杠转义只在字符串内部生效。返回 true 表示超过 maxDepth。
 */
function exceedsDepth(raw: string, maxDepth: number): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of raw) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      depth += 1;
      if (depth > maxDepth) {
        return true;
      }
    } else if (char === '}' || char === ']') {
      depth -= 1;
    }
  }
  return false;
}

/** 把 Ajv 错误数组压成单行 detail：路径 + 消息，最多保留 5 条。 */
function formatErrors(errors: ErrorObject[]): string {
  const parts = errors.slice(0, 5).map((error) => {
    const path = error.instancePath || '/';
    if (error.keyword === 'additionalProperties') {
      const extra =
        typeof error.params.additionalProperty === 'string'
          ? error.params.additionalProperty
          : '?';
      return `${path}[/${extra}] ${error.message ?? '不合法'}`;
    }
    return `${path} ${error.message ?? '不合法'}`;
  });
  return parts.join('; ');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type SemanticFailure = Extract<ParseGenuiResult, { ok: false }>;

function semanticFailure(code: SemanticFailure['code'], detail: string): SemanticFailure {
  return { ok: false, code, detail };
}

interface SemanticContext {
  stateById: Map<string, StateVariable>;
  derivedById: Map<string, DerivedValue>;
  modelsById: Map<string, SemanticModel>;
  modelOrder: string[];
  dependencies: Map<string, Set<string>>;
  expressionNodes: number;
  expressionBudget: number;
  conditionNodes: number;
}

function createContext(
  document: GenuiV2Document | GenuiV3Document | GenuiV4Document | GenuiV5Document,
): SemanticContext {
  const models = document.version === 5 ? document.models : [];
  return {
    stateById: new Map(document.state.map((variable) => [variable.id, variable])),
    derivedById: new Map(document.derived.map((value) => [value.id, value])),
    modelsById: new Map(models.map((model) => [model.id, model])),
    modelOrder: models.map((model) => model.id),
    dependencies: new Map(),
    expressionNodes: 0,
    expressionBudget:
      document.version >= 5
        ? LIMITS.maxExpressionNodesV5
        : document.version >= 3
          ? LIMITS.maxExpressionNodesV3
          : LIMITS.maxExpressionNodes,
    conditionNodes: 0,
  };
}

/** 对象字段是否恰好是给定集合（排序后比较），用于白名单运算的键校验。 */
function hasExactKeys(record: Record<string, unknown>, ...keys: string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** 检查一条数值表达式的白名单字段、引用与规模，并记录派生依赖。 */
function inspectExpression(
  context: SemanticContext,
  expression: NumericExpression | FunctionExpression,
  depth: number,
  allowX = false,
  allowedModels?: ReadonlySet<string>,
): SemanticFailure | null {
  context.expressionNodes += 1;
  if (context.expressionNodes > context.expressionBudget || depth > LIMITS.maxExpressionDepth) {
    return semanticFailure('too-complex', '表达式超过节点数或嵌套深度上限');
  }

  const record = expression as unknown as Record<string, unknown>;
  switch (expression.op) {
    case 'const': {
      if (!hasExactKeys(record, 'op', 'value') || typeof record.value !== 'number') {
        return semanticFailure('semantic-violation', 'const 运算的字段无效');
      }
      if (
        !Number.isFinite(expression.value) ||
        Math.abs(expression.value) > LIMITS.maxNumberMagnitude
      ) {
        return semanticFailure('semantic-violation', '表达式常量超出数值范围');
      }
      return null;
    }
    case 'state': {
      if (!hasExactKeys(record, 'op', 'id') || typeof record.id !== 'string') {
        return semanticFailure('semantic-violation', 'state 引用的字段无效');
      }
      const variable = context.stateById.get(expression.id);
      if (!variable || variable.kind !== 'number') {
        return semanticFailure(
          'invalid-reference',
          `数值表达式引用了不存在或非数值状态：${expression.id}`,
        );
      }
      return null;
    }
    case 'derived': {
      if (!hasExactKeys(record, 'op', 'id') || typeof record.id !== 'string') {
        return semanticFailure('semantic-violation', 'derived 引用的字段无效');
      }
      if (!context.derivedById.has(expression.id)) {
        return semanticFailure('invalid-reference', `引用了不存在的派生值：${expression.id}`);
      }
      return null;
    }
    case 'model': {
      if (
        !hasExactKeys(record, 'op', 'model', 'key') ||
        typeof record.model !== 'string' ||
        typeof record.key !== 'string'
      ) {
        return semanticFailure('semantic-violation', 'model 引用的字段无效');
      }
      if (!allowedModels || !allowedModels.has(expression.model)) {
        return semanticFailure(
          'invalid-reference',
          `模型引用必须指向已声明且更早的模型：${expression.model}`,
        );
      }
      const model = context.modelsById.get(expression.model);
      if (!model) {
        return semanticFailure('invalid-reference', `引用了不存在的模型：${expression.model}`);
      }
      const keys = MODEL_SCALAR_KEYS[model.kind] as readonly string[];
      if (!keys.includes(expression.key)) {
        return semanticFailure(
          'invalid-reference',
          `模型 ${expression.model} 没有标量 ${expression.key}`,
        );
      }
      return null;
    }
    case 'x': {
      if (!allowX) {
        return semanticFailure('semantic-violation', '变量 x 仅允许用于函数曲线的表达式');
      }
      if (!hasExactKeys(record, 'op')) {
        return semanticFailure('semantic-violation', 'x 运算的字段无效');
      }
      return null;
    }
    case 'negate':
    case 'abs':
    case 'round':
    case 'floor':
    case 'ceil': {
      if (!hasExactKeys(record, 'op', 'value') || typeof record.value !== 'object' || record.value === null) {
        return semanticFailure('semantic-violation', `${expression.op} 运算的字段无效`);
      }
      return inspectExpression(context, record.value as NumericExpression, depth + 1, allowX, allowedModels);
    }
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
    case 'min':
    case 'max': {
      if (
        !hasExactKeys(record, 'op', 'left', 'right') ||
        typeof record.left !== 'object' || record.left === null ||
        typeof record.right !== 'object' || record.right === null
      ) {
        return semanticFailure('semantic-violation', `${expression.op} 运算的字段无效`);
      }
      const leftFailure = inspectExpression(context, record.left as NumericExpression, depth + 1, allowX, allowedModels);
      if (leftFailure) return leftFailure;
      return inspectExpression(context, record.right as NumericExpression, depth + 1, allowX, allowedModels);
    }
    default: {
      const exhaustive: never = expression;
      return semanticFailure('semantic-violation', `不支持的运算：${String(exhaustive)}`);
    }
  }
}

/** 检查条件谓词的字段、引用与规模（条件节点预算独立于表达式预算）。 */
function inspectCondition(
  context: SemanticContext,
  condition: Condition,
  depth: number,
  allowedModels?: ReadonlySet<string>,
): SemanticFailure | null {
  context.conditionNodes += 1;
  if (context.conditionNodes > LIMITS.maxConditionNodes || depth > LIMITS.maxConditionDepth) {
    return semanticFailure('too-complex', '条件超过节点数或嵌套深度上限');
  }

  if (condition.op === 'state-eq' || condition.op === 'state-neq') {
    const variable = context.stateById.get(condition.id);
    if (!variable || variable.kind !== 'select') {
      return semanticFailure(
        'invalid-reference',
        `条件引用了不存在或非选择状态：${condition.id}`,
      );
    }
    if (!variable.options.some((option) => option.value === condition.value)) {
      return semanticFailure(
        'semantic-violation',
        `条件引用了选择状态 ${condition.id} 不存在的选项：${condition.value}`,
      );
    }
    return null;
  }

  if (condition.op === 'and' || condition.op === 'or') {
    for (const child of condition.conditions) {
      const failure = inspectCondition(context, child, depth + 1, allowedModels);
      if (failure) return failure;
    }
    return null;
  }

  if (condition.op === 'not') {
    return inspectCondition(context, condition.condition, depth + 1, allowedModels);
  }

  if (!('left' in condition) || !('right' in condition)) {
    return semanticFailure('semantic-violation', `不支持的条件运算：${String(condition.op)}`);
  }
  const leftFailure = inspectExpression(context, condition.left, 1, false, allowedModels);
  if (leftFailure) return leftFailure;
  return inspectExpression(context, condition.right, 1, false, allowedModels);
}

/** 状态定义、派生定义、表达式预算与循环依赖（v2/v3/v4 共用）。 */
function inspectStateAndDerived(
  context: SemanticContext,
  document: GenuiV2Document | GenuiV3Document | GenuiV4Document | GenuiV5Document,
): SemanticFailure | null {
  if (context.stateById.size !== document.state.length) {
    return semanticFailure('invalid-reference', 'state 中存在重复 id');
  }
  if (context.derivedById.size !== document.derived.length) {
    return semanticFailure('invalid-reference', 'derived 中存在重复 id');
  }
  for (const id of context.derivedById.keys()) {
    if (context.stateById.has(id)) {
      return semanticFailure('invalid-reference', `state 与 derived 的 id 冲突：${id}`);
    }
  }

  for (const variable of document.state) {
    if (variable.kind === 'number') {
      if (
        variable.min >= variable.max ||
        variable.initial < variable.min ||
        variable.initial > variable.max
      ) {
        return semanticFailure('semantic-violation', `数值状态 ${variable.id} 的初始值或范围无效`);
      }
      if (
        !isStepAligned(variable.initial, variable.min, variable.step) ||
        !isStepAligned(variable.max, variable.min, variable.step)
      ) {
        return semanticFailure('semantic-violation', `数值状态 ${variable.id} 的初始值或最大值不符合步长`);
      }
      continue;
    }

    const options = new Set(variable.options.map((option) => option.value));
    if (options.size !== variable.options.length) {
      return semanticFailure('semantic-violation', `选择状态 ${variable.id} 存在重复选项值`);
    }
    if (!options.has(variable.initial)) {
      return semanticFailure('semantic-violation', `选择状态 ${variable.id} 的初始值不在选项中`);
    }
  }

  for (const derived of document.derived) {
    const dependencies = new Set<string>();
    context.dependencies.set(derived.id, dependencies);
    const failure = inspectExpression(context, derived.expression, 1);
    if (failure) return failure;
    collectDerivedDependencies(derived.expression, dependencies);
  }

  return null;
}

/** 收集派生表达式中直接引用的派生值，用于环路检测。 */
function collectDerivedDependencies(
  expression: NumericExpression,
  dependencies: Set<string>,
): void {
  switch (expression.op) {
    case 'derived':
      dependencies.add(expression.id);
      return;
    case 'negate':
    case 'abs':
    case 'round':
    case 'floor':
    case 'ceil':
      collectDerivedDependencies(expression.value, dependencies);
      return;
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
    case 'min':
    case 'max':
      collectDerivedDependencies(expression.left, dependencies);
      collectDerivedDependencies(expression.right, dependencies);
      return;
    default:
      return;
  }
}

function inspectDependencyCycles(context: SemanticContext): SemanticFailure | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const dependency of context.dependencies.get(id) ?? []) {
      if (!visit(dependency)) return false;
    }
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  for (const id of context.dependencies.keys()) {
    if (!visit(id)) return semanticFailure('dependency-cycle', `派生值存在循环依赖：${id}`);
  }
  return null;
}

/** v2 叶元素引用检查（控件绑定、结果来源）；v3/v4 组合布局的叶元素复用。 */
function inspectLeafElement(
  context: SemanticContext,
  element:
    | Exclude<GenuiV2Document['elements'][number], { kind: 'text' }>
    | InteractiveElement
    | ModelValueElement,
): SemanticFailure | null {
  if (element.kind === 'number-input' || element.kind === 'slider' || element.kind === 'select') {
    const variable = context.stateById.get(element.bind);
    const expectedKind = element.kind === 'select' ? 'select' : 'number';
    if (!variable || variable.kind !== expectedKind) {
      return semanticFailure(
        'invalid-reference',
        `${element.kind} 控件绑定了不存在或类型不匹配的状态：${element.bind}`,
      );
    }
    return null;
  }
  if (element.kind === 'value') {
    if (element.source.kind === 'model') {
      const model = context.modelsById.get(element.source.model);
      if (!model) {
        return semanticFailure(
          'invalid-reference',
          `结果引用了不存在的模型：${element.source.model}`,
        );
      }
      const keys = MODEL_SCALAR_KEYS[model.kind] as readonly string[];
      if (!keys.includes(element.source.key)) {
        return semanticFailure(
          'invalid-reference',
          `模型 ${element.source.model} 没有标量 ${element.source.key}`,
        );
      }
      return null;
    }
    const exists = element.source.kind === 'state'
      ? context.stateById.has(element.source.id)
      : context.derivedById.has(element.source.id);
    if (!exists) {
      return semanticFailure(
        'invalid-reference',
        `结果引用不存在：${element.source.kind}.${element.source.id}`,
      );
    }
  }
  return null;
}

function validateV2Semantics(document: GenuiV2Document): SemanticFailure | null {
  const context = createContext(document);
  const stateFailure = inspectStateAndDerived(context, document);
  if (stateFailure) return stateFailure;

  for (const element of document.elements) {
    if (element.kind === 'text') continue;
    const failure = inspectLeafElement(context, element);
    if (failure) return failure;
  }

  return inspectDependencyCycles(context);
}

/**
 * v4 函数曲线系列：检查结构白名单与预算，且表达式允许局部变量 x。
 * domain 属普通数值表达式（不允许 x）；samples/features 形状由 schema 保证，
 * 语义层复检以维持白名单防御纵深。
 */
function inspectFunctionSeries(
  context: SemanticContext,
  series: ChartFunctionSeries,
  allowed: boolean,
): SemanticFailure | null {
  if (!allowed) {
    return semanticFailure(
      'semantic-violation',
      '函数曲线系列至少需要协议版本 4',
    );
  }
  const seriesRecord = series as unknown as Record<string, unknown>;
  const seriesOk =
    hasExactKeys(seriesRecord, 'label', 'function') ||
    hasExactKeys(seriesRecord, 'label', 'color', 'function');
  if (!seriesOk) {
    return semanticFailure('semantic-violation', '函数曲线系列的字段无效');
  }

  const definition = series.function;
  const definitionRecord = definition as unknown as Record<string, unknown>;
  if (
    typeof definitionRecord.expression !== 'object' ||
    definitionRecord.expression === null
  ) {
    return semanticFailure('semantic-violation', '函数曲线缺少表达式');
  }
  const defKeys = Object.keys(definitionRecord).sort();
  const allowedKeys = ['domain', 'expression', 'features', 'samples'];
  if (defKeys.some((key) => !allowedKeys.includes(key))) {
    return semanticFailure('semantic-violation', '函数曲线定义的字段无效');
  }
  if (
    definition.samples !== undefined &&
    (!Number.isInteger(definition.samples) ||
      definition.samples < 5 ||
      definition.samples > LIMITS.maxFunctionSamples)
  ) {
    return semanticFailure('semantic-violation', '函数曲线采样数超出范围');
  }
  if (definition.features !== undefined) {
    if (
      !Array.isArray(definition.features) ||
      definition.features.length !== 1 ||
      definition.features[0] !== 'zero'
    ) {
      return semanticFailure('semantic-violation', '函数曲线暂只支持 zero 特征覆盖');
    }
  }
  if (definition.domain !== undefined) {
    const domainRecord = definition.domain as unknown as Record<string, unknown>;
    if (!hasExactKeys(domainRecord, 'start', 'end')) {
      return semanticFailure('semantic-violation', '函数曲线定义域的字段无效');
    }
    const startFailure = inspectExpression(context, definition.domain.start, 1);
    if (startFailure) return startFailure;
    const endFailure = inspectExpression(context, definition.domain.end, 1);
    if (endFailure) return endFailure;
  }
  return inspectExpression(context, definition.expression, 1, true);
}

/** 展平后的元素总数、布局嵌套深度与各组合元素内部引用。 */
function inspectElements(
  context: SemanticContext,
  elements: Array<GenuiV3Element | GenuiV4Element>,
  version: number,
): SemanticFailure | null {
  let elementCount = 0;

  const walk = (
    list: Array<GenuiV3Element | GenuiV4Element>,
    depth: number,
  ): SemanticFailure | null => {
    for (const element of list) {
      if (depth > LIMITS.maxNestingDepth) {
        return semanticFailure('too-complex', '组合布局嵌套超过上限');
      }
      elementCount += 1;
      if (elementCount > LIMITS.maxElementsV3) {
        return semanticFailure('too-complex', '元素总数超过上限');
      }

      switch (element.kind) {
        case 'text': {
          if (element.visibleIf) {
            const failure = inspectCondition(context, element.visibleIf, 1);
            if (failure) return failure;
          }
          break;
        }
        case 'note': {
          if (element.visibleIf) {
            const failure = inspectCondition(context, element.visibleIf, 1);
            if (failure) return failure;
          }
          break;
        }
        case 'chart': {
          if (element.chartType === 'line') {
            let points = 0;
            let functionSamples = 0;
            for (const series of element.series) {
              if ('function' in series) {
                const failure = inspectFunctionSeries(context, series, version >= 4);
                if (failure) return failure;
                functionSamples += series.function.samples ?? LIMITS.defaultFunctionSamples;
                continue;
              }
              let previousX = Number.NEGATIVE_INFINITY;
              for (const point of series.points) {
                if (point.x <= previousX) {
                  return semanticFailure('semantic-violation', '折线图数据点的 x 必须严格递增');
                }
                previousX = point.x;
                points += 1;
                const failure = inspectExpression(context, point.y, 1);
                if (failure) return failure;
              }
            }
            if (points > LIMITS.maxChartPointsTotal) {
              return semanticFailure('too-complex', '折线图数据点总数超过上限');
            }
            if (functionSamples > LIMITS.maxFunctionSamplesTotal) {
              return semanticFailure('too-complex', '函数曲线采样总数超过上限');
            }
          } else {
            for (const item of element.items) {
              const failure = inspectExpression(context, item.value, 1);
              if (failure) return failure;
            }
          }
          break;
        }
        case 'table': {
          if (element.visibleIf) {
            const failure = inspectCondition(context, element.visibleIf, 1);
            if (failure) return failure;
          }
          const keys = new Set<string>();
          for (const column of element.columns) {
            if (keys.has(column.key)) {
              return semanticFailure('semantic-violation', `表格列 key 重复：${column.key}`);
            }
            keys.add(column.key);
          }
          if (element.initialSort && !keys.has(element.initialSort.key)) {
            return semanticFailure(
              'invalid-reference',
              `表格初始排序引用了不存在的列：${element.initialSort.key}`,
            );
          }
          for (const row of element.rows) {
            if (row.visibleIf) {
              const failure = inspectCondition(context, row.visibleIf, 1);
              if (failure) return failure;
            }
            for (const [key, cell] of Object.entries(row.cells)) {
              if (!keys.has(key)) {
                return semanticFailure('invalid-reference', `表格行包含未定义的列：${key}`);
              }
              if (typeof cell === 'object' && cell !== null) {
                const failure = inspectExpression(context, cell, 1);
                if (failure) return failure;
              }
            }
          }
          break;
        }
        case 'section': {
          const failure = walk(element.children, depth + 1);
          if (failure) return failure;
          break;
        }
        case 'columns': {
          for (const column of element.columns) {
            const failure = walk(column, depth + 1);
            if (failure) return failure;
          }
          break;
        }
        default: {
          const failure = inspectLeafElement(context, element);
          if (failure) return failure;
          break;
        }
      }
    }
    return null;
  };

  return walk(elements, 1);
}

function inspectV5Models(
  context: SemanticContext,
  models: SemanticModel[],
): SemanticFailure | null {
  if (context.modelsById.size !== models.length) {
    return semanticFailure('invalid-reference', 'models 中存在重复 id');
  }

  const earlier = new Set<string>();
  for (const model of models) {
    const modelFailure =
      model.kind === 'budget'
        ? inspectBudgetModel(context, model, earlier)
        : model.kind === 'cost'
          ? inspectCostModel(context, model, earlier)
          : inspectPreferenceModel(context, model, earlier);
    if (modelFailure) return modelFailure;
    earlier.add(model.id);
  }
  return null;
}

function inspectBudgetModel(
  context: SemanticContext,
  model: Extract<SemanticModel, { kind: 'budget' }>,
  earlier: ReadonlySet<string>,
): SemanticFailure | null {
  const incomeFailure = inspectExpression(context, model.income, 1, false, earlier);
  if (incomeFailure) return incomeFailure;
  for (const expense of model.expenses) {
    const failure = inspectExpression(context, expense.amount, 1, false, earlier);
    if (failure) return failure;
  }
  return null;
}

function inspectCostModel(
  context: SemanticContext,
  model: Extract<SemanticModel, { kind: 'cost' }>,
  earlier: ReadonlySet<string>,
): SemanticFailure | null {
  const horizonFailure = inspectExpression(context, model.horizon, 1, false, earlier);
  if (horizonFailure) return horizonFailure;
  for (const plan of model.plans) {
    const feeFailure = inspectExpression(context, plan.fee, 1, false, earlier);
    if (feeFailure) return feeFailure;
    const usesFailure = inspectExpression(context, plan.usesPerPeriod, 1, false, earlier);
    if (usesFailure) return usesFailure;
  }
  return null;
}

function inspectPreferenceModel(
  context: SemanticContext,
  model: Extract<SemanticModel, { kind: 'preference' }>,
  earlier: ReadonlySet<string>,
): SemanticFailure | null {
  const dimensionIds = new Set<string>();
  let positiveNumericWeight = false;
  let hasWeightExpression = false;
  for (const dimension of model.dimensions) {
    if (dimensionIds.has(dimension.id)) {
      return semanticFailure(
        'semantic-violation',
        `偏好维度 id 重复：${dimension.id}`,
      );
    }
    if (typeof dimension.weight === 'number') {
      if (
        !Number.isFinite(dimension.weight) ||
        dimension.weight < 0 ||
        dimension.weight > LIMITS.maxPreferenceWeight
      ) {
        return semanticFailure('semantic-violation', `偏好维度 ${dimension.id} 的权重无效`);
      }
      if (dimension.weight > 0) positiveNumericWeight = true;
    } else {
      hasWeightExpression = true;
      const failure = inspectExpression(context, dimension.weight, 1, false, earlier);
      if (failure) return failure;
    }
    dimensionIds.add(dimension.id);
  }
  if (!positiveNumericWeight && !hasWeightExpression) {
    return semanticFailure('semantic-violation', '偏好比较至少需要一个大于 0 的权重');
  }

  for (const candidate of model.candidates) {
    for (const key of Object.keys(candidate.values)) {
      if (!dimensionIds.has(key)) {
        return semanticFailure(
          'invalid-reference',
          `偏好候选 ${candidate.label} 引用了未声明的维度：${key}`,
        );
      }
    }
  }

  const filterDimensions = new Set<string>();
  for (const filter of model.filters ?? []) {
    if (!dimensionIds.has(filter.dimension)) {
      return semanticFailure(
        'invalid-reference',
        `偏好筛选引用了未声明的维度：${filter.dimension}`,
      );
    }
    if (filterDimensions.has(filter.dimension)) {
      return semanticFailure(
        'semantic-violation',
        `偏好筛选维度重复：${filter.dimension}`,
      );
    }
    filterDimensions.add(filter.dimension);
    if (filter.min === undefined && filter.max === undefined) {
      return semanticFailure(
        'semantic-violation',
        `偏好筛选 ${filter.dimension} 至少需要 min 或 max`,
      );
    }
    if (filter.min !== undefined && typeof filter.min !== 'number') {
      const failure = inspectExpression(context, filter.min, 1, false, earlier);
      if (failure) return failure;
    }
    if (filter.max !== undefined && typeof filter.max !== 'number') {
      const failure = inspectExpression(context, filter.max, 1, false, earlier);
      if (failure) return failure;
    }
    for (const bound of [filter.min, filter.max]) {
      if (typeof bound === 'number' && !Number.isFinite(bound)) {
        return semanticFailure(
          'semantic-violation',
          `偏好筛选 ${filter.dimension} 的阈值不是有限数字`,
        );
      }
    }
  }
  return null;
}

/** 展平后的 v5 元素总数、布局深度、模型来源与表达式引用。 */
function inspectV5Elements(
  context: SemanticContext,
  elements: GenuiV5Element[],
): SemanticFailure | null {
  let elementCount = 0;
  const allModels = new Set(context.modelOrder);

  const walk = (list: GenuiV5Element[], depth: number): SemanticFailure | null => {
    for (const element of list) {
      if (depth > LIMITS.maxNestingDepth) {
        return semanticFailure('too-complex', '组合布局嵌套超过上限');
      }
      elementCount += 1;
      if (elementCount > LIMITS.maxElementsV3) {
        return semanticFailure('too-complex', '元素总数超过上限');
      }

      switch (element.kind) {
        case 'text':
        case 'note': {
          if (element.visibleIf) {
            const failure = inspectCondition(context, element.visibleIf, 1, allModels);
            if (failure) return failure;
          }
          break;
        }
        case 'chart': {
          if ('source' in element) {
            if (!context.modelsById.has(element.source.model)) {
              return semanticFailure(
                'invalid-reference',
                `图表引用了不存在的模型：${element.source.model}`,
              );
            }
            break;
          }
          if (element.chartType === 'line') {
            let points = 0;
            let functionSamples = 0;
            for (const series of element.series) {
              if ('function' in series) {
                const failure = inspectFunctionSeries(context, series, true);
                if (failure) return failure;
                functionSamples += series.function.samples ?? LIMITS.defaultFunctionSamples;
                continue;
              }
              let previousX = Number.NEGATIVE_INFINITY;
              for (const point of series.points) {
                if (point.x <= previousX) {
                  return semanticFailure('semantic-violation', '折线图数据点的 x 必须严格递增');
                }
                previousX = point.x;
                points += 1;
                const failure = inspectExpression(context, point.y, 1, false, allModels);
                if (failure) return failure;
              }
            }
            if (points > LIMITS.maxChartPointsTotal) {
              return semanticFailure('too-complex', '折线图数据点总数超过上限');
            }
            if (functionSamples > LIMITS.maxFunctionSamplesTotal) {
              return semanticFailure('too-complex', '函数曲线采样总数超过上限');
            }
          } else {
            for (const item of element.items) {
              const failure = inspectExpression(context, item.value, 1, false, allModels);
              if (failure) return failure;
            }
          }
          break;
        }
        case 'table': {
          if ('source' in element) {
            const model = context.modelsById.get(element.source.model);
            if (!model) {
              return semanticFailure(
                'invalid-reference',
                `表格引用了不存在的模型：${element.source.model}`,
              );
            }
            if (element.source.view !== undefined) {
              const views = MODEL_TABLE_VIEWS[model.kind] as readonly string[];
              if (!views.includes(element.source.view)) {
                return semanticFailure(
                  'invalid-reference',
                  `模型 ${model.id} 不支持表格视图：${element.source.view}`,
                );
              }
            }
            break;
          }
          if (element.visibleIf) {
            const failure = inspectCondition(context, element.visibleIf, 1, allModels);
            if (failure) return failure;
          }
          const keys = new Set<string>();
          for (const column of element.columns) {
            if (keys.has(column.key)) {
              return semanticFailure('semantic-violation', `表格列 key 重复：${column.key}`);
            }
            keys.add(column.key);
          }
          if (element.initialSort && !keys.has(element.initialSort.key)) {
            return semanticFailure(
              'invalid-reference',
              `表格初始排序引用了不存在的列：${element.initialSort.key}`,
            );
          }
          for (const row of element.rows) {
            if (row.visibleIf) {
              const failure = inspectCondition(context, row.visibleIf, 1, allModels);
              if (failure) return failure;
            }
            for (const [key, cell] of Object.entries(row.cells)) {
              if (!keys.has(key)) {
                return semanticFailure('invalid-reference', `表格行包含未定义的列：${key}`);
              }
              if (typeof cell === 'object' && cell !== null) {
                const failure = inspectExpression(context, cell, 1, false, allModels);
                if (failure) return failure;
              }
            }
          }
          break;
        }
        case 'explain': {
          if (!context.modelsById.has(element.model)) {
            return semanticFailure(
              'invalid-reference',
              `解释元素引用了不存在的模型：${element.model}`,
            );
          }
          if (element.visibleIf) {
            const failure = inspectCondition(context, element.visibleIf, 1, allModels);
            if (failure) return failure;
          }
          break;
        }
        case 'section': {
          const failure = walk(element.children, depth + 1);
          if (failure) return failure;
          break;
        }
        case 'columns': {
          for (const column of element.columns) {
            const failure = walk(column, depth + 1);
            if (failure) return failure;
          }
          break;
        }
        default: {
          const failure = inspectLeafElement(context, element);
          if (failure) return failure;
          break;
        }
      }
    }
    return null;
  };

  return walk(elements, 1);
}

function validateV3Semantics(document: GenuiV3Document): SemanticFailure | null {
  const context = createContext(document);
  const stateFailure = inspectStateAndDerived(context, document);
  if (stateFailure) return stateFailure;

  const elementFailure = inspectElements(context, document.elements, document.version);
  if (elementFailure) return elementFailure;

  return inspectDependencyCycles(context);
}

function validateV4Semantics(document: GenuiV4Document): SemanticFailure | null {
  const context = createContext(document);
  const stateFailure = inspectStateAndDerived(context, document);
  if (stateFailure) return stateFailure;

  const elementFailure = inspectElements(context, document.elements, document.version);
  if (elementFailure) return elementFailure;

  return inspectDependencyCycles(context);
}

function validateV5Semantics(document: GenuiV5Document): SemanticFailure | null {
  const context = createContext(document);
  const stateFailure = inspectStateAndDerived(context, document);
  if (stateFailure) return stateFailure;

  const modelFailure = inspectV5Models(context, document.models);
  if (modelFailure) return modelFailure;

  const elementFailure = inspectV5Elements(context, document.elements);
  if (elementFailure) return elementFailure;

  return inspectDependencyCycles(context);
}

/** 解析并验证一段 genui 代码块文本。 */
export function parseGenui(raw: string): ParseGenuiResult {
  if (raw.length > LIMITS.maxRawLength) {
    return {
      ok: false,
      code: 'too-large',
      detail: `原始内容 ${raw.length} 字符，超过上限 ${LIMITS.maxRawLength}`,
    };
  }
  if (exceedsDepth(raw, LIMITS.maxDepth)) {
    return {
      ok: false,
      code: 'too-deep',
      detail: `嵌套深度超过上限 ${LIMITS.maxDepth} 层`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, code: 'invalid-json', detail: errorMessage(error) };
  }

  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'type' in parsed && parsed.type === 'genui' &&
    'version' in parsed && typeof parsed.version === 'number' && Number.isInteger(parsed.version) &&
    parsed.version > PROTOCOL_VERSION
  ) {
    return {
      ok: false,
      code: 'unsupported-version',
      detail: `不支持的协议版本 ${String(parsed.version)}，当前支持 1–${PROTOCOL_VERSION}`,
    };
  }

  if (!validate(parsed)) {
    return {
      ok: false,
      code: 'schema-violation',
      detail: formatErrors(validate.errors ?? []),
    };
  }

  const document = parsed as GenuiDocument;
  if (document.version === 2) {
    const failure = validateV2Semantics(document);
    if (failure) return failure;
  } else if (document.version === 3) {
    const failure = validateV3Semantics(document);
    if (failure) return failure;
  } else if (document.version === 4) {
    const failure = validateV4Semantics(document);
    if (failure) return failure;
  } else if (document.version === 5) {
    const failure = validateV5Semantics(document);
    if (failure) return failure;
  }
  return { ok: true, document };
}
