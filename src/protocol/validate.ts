import type { ErrorObject } from 'ajv';
import genuiValidate from './genui-validator.generated';
import { buildSchemaIssues, formatSchemaPath } from './diagnose';
import { isStepAligned } from './step';
import {
  LIMITS,
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
  type InteractiveElement,
  type NumericExpression,
  type ParseGenuiResult,
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

function semanticFailure(
  code: SemanticFailure['code'],
  detail: string,
  pointer?: string,
  expected?: string,
): SemanticFailure {
  if (!pointer) return { ok: false, code, detail };
  const issue = {
    pointer,
    path: formatSchemaPath(pointer),
    keyword: 'semantic',
    message: detail,
    ...(expected ? { expected } : {}),
  };
  return { ok: false, code, detail, issues: [issue] };
}

/** 给 JSON Pointer 追加一段，用于把语义错误定位到具体字段。 */
function at(pointer: string | undefined, segment: string): string | undefined {
  return pointer ? `${pointer}/${segment}` : undefined;
}

/** RFC 6901 转义，用于把表格列 key 等动态字段写进 JSON Pointer。 */
function pointerToken(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

interface SemanticContext {
  stateById: Map<string, StateVariable>;
  derivedById: Map<string, DerivedValue>;
  derivedIndexById: Map<string, number>;
  dependencies: Map<string, Set<string>>;
  expressionNodes: number;
  expressionBudget: number;
  conditionNodes: number;
  /** 文档范围内累计的函数曲线采样数（跨图表、跨嵌套布局累加）。 */
  functionSamples: number;
}

function createContext(
  document: GenuiV2Document | GenuiV3Document | GenuiV4Document,
): SemanticContext {
  return {
    stateById: new Map(document.state.map((variable) => [variable.id, variable])),
    derivedById: new Map(document.derived.map((value) => [value.id, value])),
    derivedIndexById: new Map(document.derived.map((value, index) => [value.id, index])),
    dependencies: new Map(),
    expressionNodes: 0,
    expressionBudget:
      document.version >= 3 ? LIMITS.maxExpressionNodesV3 : LIMITS.maxExpressionNodes,
    conditionNodes: 0,
    functionSamples: 0,
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
  expression: FunctionExpression,
  depth: number,
  pointer?: string,
  allowX = false,
): SemanticFailure | null {
  context.expressionNodes += 1;
  if (context.expressionNodes > context.expressionBudget || depth > LIMITS.maxExpressionDepth) {
    return semanticFailure('too-complex', '表达式超过节点数或嵌套深度上限', pointer);
  }

  const record = expression as unknown as Record<string, unknown>;
  switch (expression.op) {
    case 'const': {
      if (!hasExactKeys(record, 'op', 'value') || typeof record.value !== 'number') {
        return semanticFailure('semantic-violation', 'const 运算的字段无效', pointer);
      }
      if (
        !Number.isFinite(expression.value) ||
        Math.abs(expression.value) > LIMITS.maxNumberMagnitude
      ) {
        return semanticFailure('semantic-violation', '表达式常量超出数值范围', at(pointer, 'value'));
      }
      return null;
    }
    case 'state': {
      if (!hasExactKeys(record, 'op', 'id') || typeof record.id !== 'string') {
        return semanticFailure('semantic-violation', 'state 引用的字段无效', pointer);
      }
      const variable = context.stateById.get(expression.id);
      if (!variable || variable.kind !== 'number') {
        return semanticFailure(
          'invalid-reference',
          `数值表达式引用了不存在或非数值状态：${expression.id}`,
          at(pointer, 'id'),
          '表达式中的 state.id 必须是已声明的 number 状态 id',
        );
      }
      return null;
    }
    case 'derived': {
      if (!hasExactKeys(record, 'op', 'id') || typeof record.id !== 'string') {
        return semanticFailure('semantic-violation', 'derived 引用的字段无效', pointer);
      }
      if (!context.derivedById.has(expression.id)) {
        return semanticFailure(
          'invalid-reference',
          `引用了不存在的派生值：${expression.id}`,
          at(pointer, 'id'),
          '表达式中的 derived.id 必须是已声明的派生值 id',
        );
      }
      return null;
    }
    case 'x': {
      if (!allowX) {
        return semanticFailure('semantic-violation', '变量 x 仅允许用于函数曲线的表达式', pointer);
      }
      if (!hasExactKeys(record, 'op')) {
        return semanticFailure('semantic-violation', 'x 运算的字段无效', pointer);
      }
      return null;
    }
    case 'negate':
    case 'abs':
    case 'round':
    case 'floor':
    case 'ceil': {
      if (!hasExactKeys(record, 'op', 'value') || typeof record.value !== 'object' || record.value === null) {
        return semanticFailure('semantic-violation', `${expression.op} 运算的字段无效`, pointer);
      }
      return inspectExpression(
        context,
        record.value as NumericExpression,
        depth + 1,
        at(pointer, 'value'),
        allowX,
      );
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
        return semanticFailure('semantic-violation', `${expression.op} 运算的字段无效`, pointer);
      }
      const leftFailure = inspectExpression(
        context,
        record.left as NumericExpression,
        depth + 1,
        at(pointer, 'left'),
        allowX,
      );
      if (leftFailure) return leftFailure;
      return inspectExpression(
        context,
        record.right as NumericExpression,
        depth + 1,
        at(pointer, 'right'),
        allowX,
      );
    }
    default: {
      const exhaustive: never = expression;
      return semanticFailure('semantic-violation', `不支持的运算：${String(exhaustive)}`, pointer);
    }
  }
}

/** 检查条件谓词的字段、引用与规模（条件节点预算独立于表达式预算）。 */
function inspectCondition(
  context: SemanticContext,
  condition: Condition,
  depth: number,
  pointer?: string,
): SemanticFailure | null {
  context.conditionNodes += 1;
  if (context.conditionNodes > LIMITS.maxConditionNodes || depth > LIMITS.maxConditionDepth) {
    return semanticFailure('too-complex', '条件超过节点数或嵌套深度上限', pointer);
  }

  if (condition.op === 'state-eq' || condition.op === 'state-neq') {
    const variable = context.stateById.get(condition.id);
    if (!variable || variable.kind !== 'select') {
      return semanticFailure(
        'invalid-reference',
        `条件引用了不存在或非选择状态：${condition.id}`,
        at(pointer, 'id'),
        '条件 state-eq/state-neq 的 id 必须是已声明的 select 状态 id',
      );
    }
    if (!variable.options.some((option) => option.value === condition.value)) {
      return semanticFailure(
        'semantic-violation',
        `条件引用了选择状态 ${condition.id} 不存在的选项：${condition.value}`,
        at(pointer, 'value'),
        '条件的 value 必须是该 select 状态 options 中已声明的值',
      );
    }
    return null;
  }

  if (condition.op === 'and' || condition.op === 'or') {
    for (const [index, child] of condition.conditions.entries()) {
      const failure = inspectCondition(
        context,
        child,
        depth + 1,
        pointer ? `${pointer}/conditions/${index}` : undefined,
      );
      if (failure) return failure;
    }
    return null;
  }

  if (condition.op === 'not') {
    return inspectCondition(context, condition.condition, depth + 1, at(pointer, 'condition'));
  }

  if (!('left' in condition) || !('right' in condition)) {
    return semanticFailure('semantic-violation', `不支持的条件运算：${String(condition.op)}`, pointer);
  }
  const leftFailure = inspectExpression(context, condition.left, 1, at(pointer, 'left'));
  if (leftFailure) return leftFailure;
  return inspectExpression(context, condition.right, 1, at(pointer, 'right'));
}

function firstDuplicateIndex<T>(items: T[], keyOf: (item: T) => string): number {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const key = keyOf(item);
    if (seen.has(key)) return index;
    seen.add(key);
  }
  return -1;
}

/** 状态定义、派生定义、表达式预算与循环依赖（v2/v3/v4 共用）。 */
function inspectStateAndDerived(
  context: SemanticContext,
  document: GenuiV2Document | GenuiV3Document | GenuiV4Document,
): SemanticFailure | null {
  const duplicateState = firstDuplicateIndex(document.state, (variable) => variable.id);
  if (duplicateState >= 0) {
    return semanticFailure(
      'invalid-reference',
      `state 中存在重复 id：${document.state[duplicateState].id}`,
      `/state/${duplicateState}/id`,
      'state 的 id 必须唯一',
    );
  }
  const duplicateDerived = firstDuplicateIndex(document.derived, (value) => value.id);
  if (duplicateDerived >= 0) {
    return semanticFailure(
      'invalid-reference',
      `derived 中存在重复 id：${document.derived[duplicateDerived].id}`,
      `/derived/${duplicateDerived}/id`,
      'derived 的 id 必须唯一',
    );
  }
  for (const [index, value] of document.derived.entries()) {
    if (context.stateById.has(value.id)) {
      return semanticFailure(
        'invalid-reference',
        `state 与 derived 的 id 冲突：${value.id}`,
        `/derived/${index}/id`,
        'state 与 derived 不能复用同一个 id',
      );
    }
  }

  for (const [index, variable] of document.state.entries()) {
    const base = `/state/${index}`;
    if (variable.kind === 'number') {
      if (variable.min >= variable.max) {
        return semanticFailure(
          'semantic-violation',
          `数值状态 ${variable.id} 的范围无效`,
          `${base}/min`,
          'min 必须小于 max',
        );
      }
      if (variable.initial < variable.min || variable.initial > variable.max) {
        return semanticFailure(
          'semantic-violation',
          `数值状态 ${variable.id} 的初始值或范围无效`,
          `${base}/initial`,
          'initial 必须位于 min 与 max 之间',
        );
      }
      if (!isStepAligned(variable.initial, variable.min, variable.step)) {
        return semanticFailure(
          'semantic-violation',
          `数值状态 ${variable.id} 的初始值或最大值不符合步长`,
          `${base}/initial`,
          'initial 必须与 min、step 对齐',
        );
      }
      if (!isStepAligned(variable.max, variable.min, variable.step)) {
        return semanticFailure(
          'semantic-violation',
          `数值状态 ${variable.id} 的初始值或最大值不符合步长`,
          `${base}/max`,
          'max 必须与 min、step 对齐',
        );
      }
      continue;
    }

    const options = new Set(variable.options.map((option) => option.value));
    if (options.size !== variable.options.length) {
      return semanticFailure(
        'semantic-violation',
        `选择状态 ${variable.id} 存在重复选项值`,
        `${base}/options`,
        'options 的 value 必须唯一',
      );
    }
    if (!options.has(variable.initial)) {
      return semanticFailure(
        'semantic-violation',
        `选择状态 ${variable.id} 的初始值不在选项中`,
        `${base}/initial`,
        'initial 必须是 options 中已声明的值',
      );
    }
  }

  for (const [index, derived] of document.derived.entries()) {
    const dependencies = new Set<string>();
    context.dependencies.set(derived.id, dependencies);
    const failure = inspectExpression(context, derived.expression, 1, `/derived/${index}/expression`);
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
    if (!visit(id)) {
      const index = context.derivedIndexById.get(id);
      return semanticFailure(
        'dependency-cycle',
        `派生值存在循环依赖：${id}`,
        typeof index === 'number' ? `/derived/${index}/expression` : undefined,
        '派生值之间不能循环引用',
      );
    }
  }
  return null;
}

/** v2 叶元素引用检查（控件绑定、结果来源）；v3/v4 组合布局的叶元素复用。 */
function inspectLeafElement(
  context: SemanticContext,
  element:
    | Exclude<GenuiV2Document['elements'][number], { kind: 'text' }>
    | InteractiveElement,
  pointer: string,
): SemanticFailure | null {
  if (element.kind === 'number-input' || element.kind === 'slider' || element.kind === 'select') {
    const variable = context.stateById.get(element.bind);
    const expectedKind = element.kind === 'select' ? 'select' : 'number';
    if (!variable || variable.kind !== expectedKind) {
      return semanticFailure(
        'invalid-reference',
        `${element.kind} 控件绑定了不存在或类型不匹配的状态：${element.bind}`,
        `${pointer}/bind`,
        `bind 必须是已声明的 ${expectedKind} 状态 id`,
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
        `${pointer}/source/id`,
        `source.id 必须是已声明的 ${element.source.kind} id`,
      );
    }
  }
  return null;
}

function validateV2Semantics(document: GenuiV2Document): SemanticFailure | null {
  const context = createContext(document);
  const stateFailure = inspectStateAndDerived(context, document);
  if (stateFailure) return stateFailure;

  for (const [index, element] of document.elements.entries()) {
    if (element.kind === 'text') continue;
    const failure = inspectLeafElement(context, element, `/elements/${index}`);
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
      `函数曲线系列需要协议版本 ${PROTOCOL_VERSION}`,
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
  return inspectExpression(context, definition.expression, 1, undefined, true);
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
    base: string,
  ): SemanticFailure | null => {
    for (const [index, element] of list.entries()) {
      const pointer = `${base}/${index}`;
      if (depth > LIMITS.maxNestingDepth) {
        return semanticFailure('too-complex', '组合布局嵌套超过上限', pointer);
      }
      elementCount += 1;
      if (elementCount > LIMITS.maxElementsV3) {
        return semanticFailure('too-complex', '元素总数超过上限', base);
      }

      switch (element.kind) {
        case 'text': {
          if (element.visibleIf) {
            const failure = inspectCondition(context, element.visibleIf, 1, `${pointer}/visibleIf`);
            if (failure) return failure;
          }
          break;
        }
        case 'note': {
          if (element.visibleIf) {
            const failure = inspectCondition(context, element.visibleIf, 1, `${pointer}/visibleIf`);
            if (failure) return failure;
          }
          break;
        }
        case 'chart': {
          if (element.chartType === 'line') {
            let points = 0;
            for (const [seriesIndex, series] of element.series.entries()) {
              if ('function' in series) {
                const failure = inspectFunctionSeries(context, series, version === PROTOCOL_VERSION);
                if (failure) return failure;
                context.functionSamples += series.function.samples ?? LIMITS.defaultFunctionSamples;
                continue;
              }
              let previousX = Number.NEGATIVE_INFINITY;
              for (const [pointIndex, point] of series.points.entries()) {
                if (point.x <= previousX) {
                  return semanticFailure(
                    'semantic-violation',
                    '折线图数据点的 x 必须严格递增',
                    `${pointer}/series/${seriesIndex}/points/${pointIndex}/x`,
                    '同一系列内每个数据点的 x 必须大于前一个点的 x',
                  );
                }
                previousX = point.x;
                points += 1;
                const failure = inspectExpression(
                  context,
                  point.y,
                  1,
                  `${pointer}/series/${seriesIndex}/points/${pointIndex}/y`,
                );
                if (failure) return failure;
              }
            }
            if (points > LIMITS.maxChartPointsTotal) {
              return semanticFailure('too-complex', '折线图数据点总数超过上限', `${pointer}/series`);
            }
            if (context.functionSamples > LIMITS.maxFunctionSamplesTotal) {
              return semanticFailure('too-complex', '函数曲线采样总数超过上限', `${pointer}/series`);
            }
          } else {
            for (const [itemIndex, item] of element.items.entries()) {
              const failure = inspectExpression(
                context,
                item.value,
                1,
                `${pointer}/items/${itemIndex}/value`,
              );
              if (failure) return failure;
            }
          }
          break;
        }
        case 'table': {
          if (element.visibleIf) {
            const failure = inspectCondition(context, element.visibleIf, 1, `${pointer}/visibleIf`);
            if (failure) return failure;
          }
          const keys = new Set<string>();
          for (const [columnIndex, column] of element.columns.entries()) {
            if (keys.has(column.key)) {
              return semanticFailure(
                'semantic-violation',
                `表格列 key 重复：${column.key}`,
                `${pointer}/columns/${columnIndex}/key`,
                'columns 的 key 必须唯一',
              );
            }
            keys.add(column.key);
          }
          if (element.initialSort && !keys.has(element.initialSort.key)) {
            return semanticFailure(
              'invalid-reference',
              `表格初始排序引用了不存在的列：${element.initialSort.key}`,
              `${pointer}/initialSort/key`,
              'initialSort.key 必须是 columns 中已声明的列 key',
            );
          }
          for (const [rowIndex, row] of element.rows.entries()) {
            if (row.visibleIf) {
              const failure = inspectCondition(
                context,
                row.visibleIf,
                1,
                `${pointer}/rows/${rowIndex}/visibleIf`,
              );
              if (failure) return failure;
            }
            for (const [key, cell] of Object.entries(row.cells)) {
              const cellPointer = `${pointer}/rows/${rowIndex}/cells/${pointerToken(key)}`;
              if (!keys.has(key)) {
                return semanticFailure(
                  'invalid-reference',
                  `表格行包含未定义的列：${key}`,
                  cellPointer,
                  'rows.cells 的键必须是 columns 中已声明的列 key',
                );
              }
              if (typeof cell === 'object' && cell !== null) {
                const failure = inspectExpression(context, cell, 1, cellPointer);
                if (failure) return failure;
              }
            }
          }
          break;
        }
        case 'section': {
          const failure = walk(element.children, depth + 1, `${pointer}/children`);
          if (failure) return failure;
          break;
        }
        case 'columns': {
          for (const [columnIndex, column] of element.columns.entries()) {
            const failure = walk(column, depth + 1, `${pointer}/columns/${columnIndex}`);
            if (failure) return failure;
          }
          break;
        }
        default: {
          const failure = inspectLeafElement(context, element, pointer);
          if (failure) return failure;
          break;
        }
      }
    }
    return null;
  };

  return walk(elements, 1, '/elements');
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
  } else if (document.version === 4) {
    const failure = validateV4Semantics(document);
    if (failure) return failure;
  }
  return { ok: true, document };
}
