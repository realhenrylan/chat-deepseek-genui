import type { ErrorObject } from 'ajv';
import genuiValidate from './genui-validator.generated';
import { isValidProvenanceDate } from './provenance';
import { isStepAligned } from './step';
import {
  LIMITS,
  PROTOCOL_VERSION,
  type Condition,
  type DerivedValue,
  type GenuiBasis,
  type GenuiDocument,
  type GenuiSource,
  type GenuiV2Document,
  type GenuiV3Document,
  type GenuiV3Element,
  type GenuiV4Document,
  type GenuiV4Element,
  type NumericExpression,
  type ParseGenuiResult,
  type StateVariable,
} from './types';

/**
 * genui 协议解析与验证（v1 静态 / v2 交互 / v3 组合 / v4 依据）。
 *
 * 守卫顺序（每一步先于解析成本更高的步骤）：
 * 1. too-large          原始长度上限；
 * 2. too-deep           字符串感知的嵌套深度扫描（先于 JSON.parse 拦截病态输入）；
 * 3. invalid-json       JSON.parse 失败；
 * 4. schema-violation   结构校验（Ajv allErrors，构建期代码生成，见下）；
 * 5. 语义检查            引用、依赖、初始状态、组合布局、资源预算与依据。
 *
 * v4 的「依据」只是一份声明：插件不请求来源 URL、不核验资料存在，
 * 因此语义阶段只检查 URL 形状、日期可解析性与来源绑定是否自洽。
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
  sourcesById: Map<string, GenuiSource>;
  dependencies: Map<string, Set<string>>;
  expressionNodes: number;
  expressionBudget: number;
  conditionNodes: number;
}

function createContext(
  document: GenuiV2Document | GenuiV3Document | GenuiV4Document,
): SemanticContext {
  return {
    stateById: new Map(
      document.state.map((variable): [string, StateVariable] => [variable.id, variable]),
    ),
    derivedById: new Map(
      document.derived.map((value): [string, DerivedValue] => [value.id, value]),
    ),
    sourcesById: new Map(
      (document.version === 4 ? document.sources ?? [] : []).map(
        (source): [string, GenuiSource] => [source.id, source],
      ),
    ),
    dependencies: new Map(),
    expressionNodes: 0,
    expressionBudget:
      document.version >= 3 ? LIMITS.maxExpressionNodesV3 : LIMITS.maxExpressionNodes,
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

/** 状态定义、派生定义、表达式预算与循环依赖（v2/v3/v4 共用）。 */
function inspectStateAndDerived(
  context: SemanticContext,
  document: GenuiV2Document | GenuiV3Document | GenuiV4Document,
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

/** v2/v4 叶元素引用检查（控件绑定、结果来源）。 */
function inspectLeafElement(
  context: SemanticContext,
  element:
    | { kind: 'number-input' | 'slider' | 'select'; bind: string }
    | { kind: 'value'; source: { kind: 'state' | 'derived'; id: string } },
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

/** 展平后的元素总数、布局嵌套深度与各组合元素内部引用（v3/v4 共用）。 */
type ValidatedElement = GenuiV3Element | GenuiV4Element;

function inspectV3Elements(
  context: SemanticContext,
  elements: ValidatedElement[],
): SemanticFailure | null {
  let elementCount = 0;

  const walk = (list: ValidatedElement[], depth: number): SemanticFailure | null => {
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

/** v4 来源声明：id 唯一、URL 形状可接受、日期真实存在。 */
function inspectSources(document: GenuiV4Document): SemanticFailure | null {
  const sources = document.sources ?? [];
  const ids = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.id)) {
      return semanticFailure('invalid-reference', `来源 id 重复：${source.id}`);
    }
    ids.add(source.id);
    // URL 的 https 与长度由 schema 保证；凭据/私有主机等不可靠形式不拒绝整份
    // 文档，而是在界面中按纯文本显著标注。插件从不请求这些链接。
    if (source.publishedAt !== undefined && !isValidProvenanceDate(source.publishedAt)) {
      return semanticFailure('semantic-violation', `来源 ${source.id} 的发布时间无效`);
    }
    if (source.retrievedAt !== undefined && !isValidProvenanceDate(source.retrievedAt)) {
      return semanticFailure('semantic-violation', `来源 ${source.id} 的获取时间无效`);
    }
  }
  return null;
}

/** 单条 basis：日期、有效期顺序、来源绑定都必须自洽。 */
function inspectBasis(
  context: SemanticContext,
  basis: GenuiBasis | undefined,
  where: string,
): SemanticFailure | null {
  if (basis === undefined) {
    return null;
  }
  if (basis.asOf !== undefined && !isValidProvenanceDate(basis.asOf)) {
    return semanticFailure('semantic-violation', `${where}的时点无效`);
  }
  if (basis.validUntil !== undefined && !isValidProvenanceDate(basis.validUntil)) {
    return semanticFailure('semantic-violation', `${where}的有效期无效`);
  }
  if (
    basis.asOf !== undefined &&
    basis.validUntil !== undefined &&
    basis.validUntil.slice(0, 10) < basis.asOf.slice(0, 10)
  ) {
    return semanticFailure('semantic-violation', `${where}的有效期早于适用时点`);
  }
  if (basis.kind === 'reference' && basis.sourceId === undefined) {
    return semanticFailure('semantic-violation', `${where}标记为模型引用但没有 sourceId`);
  }
  if (basis.kind === 'computed' && basis.sourceId !== undefined) {
    return semanticFailure('semantic-violation', `${where}的计算结果不能绑定来源`);
  }
  if (basis.sourceId !== undefined && !context.sourcesById.has(basis.sourceId)) {
    return semanticFailure('invalid-reference', `${where}引用了未声明的来源：${basis.sourceId}`);
  }
  return null;
}

/**
 * v4 依据检查：来源声明 + 每个数据节点的 basis。
 * 过期数据不会让文档失效（界面必须显示「已过期」），但伪造/悬空的来源会。
 */
function inspectV4Provenance(
  context: SemanticContext,
  document: GenuiV4Document,
): SemanticFailure | null {
  const sourceFailure = inspectSources(document);
  if (sourceFailure) return sourceFailure;

  for (const variable of document.state) {
    if (variable.basis?.kind === 'computed') {
      return semanticFailure(
        'semantic-violation',
        `状态 ${variable.id} 是输入项，不能标记为计算结果`,
      );
    }
    const failure = inspectBasis(context, variable.basis, `状态 ${variable.id} 的依据`);
    if (failure) return failure;
  }

  for (const derived of document.derived) {
    if (derived.basis !== undefined && derived.basis.kind !== 'computed') {
      return semanticFailure(
        'semantic-violation',
        `派生值 ${derived.id} 由其他数据计算得出，依据应标为计算结果`,
      );
    }
    const failure = inspectBasis(context, derived.basis, `派生值 ${derived.id} 的依据`);
    if (failure) return failure;
  }

  const walk = (elements: GenuiV4Element[]): SemanticFailure | null => {
    for (const element of elements) {
      const failure = inspectBasis(
        context,
        (element as { basis?: GenuiBasis }).basis,
        `元素 ${element.kind} 的依据`,
      );
      if (failure) return failure;

      switch (element.kind) {
        case 'value': {
          break;
        }
        case 'chart': {
          if (element.chartType === 'line') {
            for (const series of element.series) {
              const seriesFailure = inspectBasis(
                context,
                series.basis,
                `折线系列「${series.label}」的依据`,
              );
              if (seriesFailure) return seriesFailure;
            }
          } else {
            for (const item of element.items) {
              const itemFailure = inspectBasis(
                context,
                item.basis,
                `图表条目「${item.label}」的依据`,
              );
              if (itemFailure) return itemFailure;
            }
          }
          break;
        }
        case 'table': {
          for (const column of element.columns) {
            const columnFailure = inspectBasis(
              context,
              column.basis,
              `表格列「${column.label}」的依据`,
            );
            if (columnFailure) return columnFailure;
          }
          for (const row of element.rows) {
            const rowFailure = inspectBasis(context, row.basis, '表格行的依据');
            if (rowFailure) return rowFailure;
          }
          break;
        }
        case 'section': {
          const sectionFailure = walk(element.children);
          if (sectionFailure) return sectionFailure;
          break;
        }
        case 'columns': {
          for (const column of element.columns) {
            const columnFailure = walk(column);
            if (columnFailure) return columnFailure;
          }
          break;
        }
        default:
          break;
      }
    }
    return null;
  };

  return walk(document.elements);
}

function validateV3Semantics(document: GenuiV3Document): SemanticFailure | null {
  const context = createContext(document);
  const stateFailure = inspectStateAndDerived(context, document);
  if (stateFailure) return stateFailure;

  const elementFailure = inspectV3Elements(context, document.elements);
  if (elementFailure) return elementFailure;

  return inspectDependencyCycles(context);
}

function validateV4Semantics(document: GenuiV4Document): SemanticFailure | null {
  const context = createContext(document);
  const stateFailure = inspectStateAndDerived(context, document);
  if (stateFailure) return stateFailure;

  const provenanceFailure = inspectV4Provenance(context, document);
  if (provenanceFailure) return provenanceFailure;

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
  }
  return { ok: true, document };
}
