import type { ErrorObject } from 'ajv';
import genuiValidate from './genui-validator.generated';
import { buildSchemaIssues } from './diagnose';
import { isStepAligned } from './step';
import {
  LIMITS,
  PROTOCOL_VERSION,
  type Condition,
  type DerivedValue,
  type GenuiDocument,
  type GenuiV2Document,
  type GenuiV3Document,
  type GenuiV3Element,
  type NumericExpression,
  type ParseGenuiResult,
  type StateVariable,
} from './types';

/**
 * genui 协议解析与验证（v1 静态 / v2 交互 / v3 组合）。
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
  dependencies: Map<string, Set<string>>;
  expressionNodes: number;
  expressionBudget: number;
  conditionNodes: number;
}

function createContext(document: GenuiV2Document | GenuiV3Document): SemanticContext {
  return {
    stateById: new Map(document.state.map((variable) => [variable.id, variable])),
    derivedById: new Map(document.derived.map((value) => [value.id, value])),
    dependencies: new Map(),
    expressionNodes: 0,
    expressionBudget:
      document.version === 3 ? LIMITS.maxExpressionNodesV3 : LIMITS.maxExpressionNodes,
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
  expression: NumericExpression,
  depth: number,
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
    case 'negate':
    case 'abs':
    case 'round':
    case 'floor':
    case 'ceil': {
      if (!hasExactKeys(record, 'op', 'value') || typeof record.value !== 'object' || record.value === null) {
        return semanticFailure('semantic-violation', `${expression.op} 运算的字段无效`);
      }
      return inspectExpression(context, record.value as NumericExpression, depth + 1);
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
      const leftFailure = inspectExpression(context, record.left as NumericExpression, depth + 1);
      if (leftFailure) return leftFailure;
      return inspectExpression(context, record.right as NumericExpression, depth + 1);
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
      const failure = inspectCondition(context, child, depth + 1);
      if (failure) return failure;
    }
    return null;
  }

  if (condition.op === 'not') {
    return inspectCondition(context, condition.condition, depth + 1);
  }

  if (!('left' in condition) || !('right' in condition)) {
    return semanticFailure('semantic-violation', `不支持的条件运算：${String(condition.op)}`);
  }
  const leftFailure = inspectExpression(context, condition.left, 1);
  if (leftFailure) return leftFailure;
  return inspectExpression(context, condition.right, 1);
}

/** 状态定义、派生定义、表达式预算与循环依赖（v2/v3 共用）。 */
function inspectStateAndDerived(
  context: SemanticContext,
  document: GenuiV2Document | GenuiV3Document,
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

/** v2 叶元素引用检查（控件绑定、结果来源）。 */
function inspectLeafElement(
  context: SemanticContext,
  element: Exclude<GenuiV2Document['elements'][number], { kind: 'text' }>,
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

/** 展平后的元素总数、布局嵌套深度与各组合元素内部引用。 */
function inspectV3Elements(
  context: SemanticContext,
  elements: GenuiV3Element[],
): SemanticFailure | null {
  let elementCount = 0;

  const walk = (list: GenuiV3Element[], depth: number): SemanticFailure | null => {
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
            for (const series of element.series) {
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

function validateV3Semantics(document: GenuiV3Document): SemanticFailure | null {
  const context = createContext(document);
  const stateFailure = inspectStateAndDerived(context, document);
  if (stateFailure) return stateFailure;

  const elementFailure = inspectV3Elements(context, document.elements);
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
    const detail = errorMessage(error);
    const match = /position\s+(\d+)/i.exec(detail);
    const position = match ? Math.min(Number(match[1]), raw.length) : undefined;
    return {
      ok: false,
      code: 'invalid-json',
      detail,
      ...(position === undefined ? {} : { position }),
    };
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
    const errors = validate.errors ?? [];
    return {
      ok: false,
      code: 'schema-violation',
      detail: formatErrors(errors),
      issues: buildSchemaIssues(errors, parsed),
    };
  }

  const document = parsed as GenuiDocument;
  if (document.version === 2) {
    const failure = validateV2Semantics(document);
    if (failure) return failure;
  } else if (document.version === 3) {
    const failure = validateV3Semantics(document);
    if (failure) return failure;
  }
  return { ok: true, document };
}
