import type { ErrorObject } from 'ajv';
import { LIMITS, PROTOCOL_VERSION, type GenuiFailureCode, type GenuiSchemaIssue } from './types.ts';

/**
 * 把协议失败翻译成用户可理解、可行动的诊断。
 *
 * 这里只做「读」：筛选 Ajv oneOf 分支噪音、合并同对象的未知字段/缺失字段、
 * 生成限定失败范围的修复草稿。校验本身仍由 validate.ts 的严格 schema 完成，
 * 不对未知字段做任何放宽。
 */

export type DiagnosticStatus = 'needs-repair' | 'incomplete' | 'page-incompatible';

export type DiagnosticKind =
  | 'schema'
  | 'truncated-json'
  | 'invalid-json'
  | 'unsupported-version'
  | 'semantic'
  | 'too-large'
  | 'too-deep'
  | 'too-complex'
  | 'page-incompatible';

export interface GenuiDiagnostic {
  kind: DiagnosticKind;
  status: DiagnosticStatus;
  /** 面板标题，例如「字段名称需要修复」。 */
  title: string;
  /** 一句面向用户的说明。 */
  summary: string;
  /** 首个有效错误路径（用户可读）。 */
  path?: string;
  /** 对应的 JSON Pointer，供修复草稿使用。 */
  pointer?: string;
  /** 期望格式 / 修复目标。 */
  expected?: string;
  /** 当前值的短预览。 */
  actual?: string;
  /** JSON 解析失败时的字符位置，用于让长内容片段覆盖错误现场。 */
  position?: number;
  /** 原始失败 detail，保留给日志与展开详情。 */
  detail: string;
  issues: GenuiSchemaIssue[];
  /** 是否值得生成修复请求（页面兼容问题不生成）。 */
  repairable: boolean;
}

type ParseFailure = {
  ok: false;
  code: GenuiFailureCode;
  detail: string;
  issues?: GenuiSchemaIssue[];
  position?: number;
};

function dataVersion(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null;
  const version = (data as { version?: unknown }).version;
  return typeof version === 'number' && version >= 1 && version <= PROTOCOL_VERSION
    ? version
    : null;
}

function unescapePointer(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** JSON Pointer → 用户可读路径：/elements/3/initialSort/direction → elements[3].initialSort.direction。 */
export function formatSchemaPath(pointer: string): string {
  if (!pointer || pointer === '/') return '文档根';
  const segments = pointer.split('/').slice(1).map(unescapePointer);
  let output = '';
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) {
      output += `[${segment}]`;
    } else {
      output += output ? `.${segment}` : segment;
    }
  }
  return output || '文档根';
}

function valueAtPointer(data: unknown, pointer: string): unknown {
  if (!pointer || pointer === '/') return data;
  let current = data;
  for (const rawSegment of pointer.split('/').slice(1)) {
    const segment = unescapePointer(rawSegment);
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
    } else if (typeof current === 'object' && current !== null) {
      if (!(segment in current)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function previewValue(value: unknown, max = 60): string | undefined {
  if (value === undefined) return undefined;
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let left = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const diagonal = left;
      left = previous[j]!;
      previous[j] = Math.min(
        previous[j]! + 1,
        previous[j - 1]! + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return previous[b.length]!;
}

/** 判断未知字段是否像是某个缺失必填字段的拼写错误（如 direction → dir）。 */
function looksLikeFieldTypo(actual: string, expected: string): boolean {
  const a = actual.toLowerCase();
  const b = expected.toLowerCase();
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return a.length >= 3 && b.length >= 3 && levenshtein(a, b) <= 2;
}

function expectedFor(
  pointer: string,
  keyword: string,
  params: Record<string, unknown>,
  missing?: string,
): string | undefined {
  if (pointer.includes('/initialSort')) {
    return '"initialSort": { "key": "<列 id>", "dir": "asc" | "desc" }';
  }
  if (pointersEqual(pointer, '/version')) {
    return `版本号 1–${PROTOCOL_VERSION}`;
  }
  if (pointersEqual(pointer, '/type')) {
    return '"type": "genui"';
  }
  if (keyword === 'required') {
    if (missing === 'elements') return '必须提供至少 1 个元素的 elements 数组';
    if (missing === 'state' || missing === 'derived') return `必须提供 ${missing} 数组（可为空数组）`;
    return missing ? `需要字段「${missing}」` : undefined;
  }
  if (keyword === 'additionalProperties') {
    return '删除协议不支持的字段，或改用协议文档中的字段名';
  }
  if (keyword === 'enum' && Array.isArray(params.allowedValues)) {
    return `允许值：${params.allowedValues.map((value) => JSON.stringify(value)).join(' / ')}`;
  }
  if (keyword === 'const' && 'allowedValue' in params) {
    return `值应为 ${JSON.stringify(params.allowedValue)}`;
  }
  if (keyword === 'type' && typeof params.type === 'string') {
    return `类型应为 ${params.type}`;
  }
  if (keyword === 'pattern' && typeof params.pattern === 'string') {
    return `格式应符合 ${params.pattern}`;
  }
  if (keyword === 'minLength' && typeof params.limit === 'number') {
    return `至少 ${params.limit} 个字符`;
  }
  if (keyword === 'maxLength' && typeof params.limit === 'number') {
    return `最多 ${params.limit} 个字符`;
  }
  if (keyword === 'minItems' && typeof params.limit === 'number') {
    return `至少 ${params.limit} 项`;
  }
  if (keyword === 'maxItems' && typeof params.limit === 'number') {
    return `最多 ${params.limit} 项`;
  }
  if (keyword === 'minimum' && typeof params.limit === 'number') {
    return `数值应 ≥ ${params.limit}`;
  }
  if (keyword === 'maximum' && typeof params.limit === 'number') {
    return `数值应 ≤ ${params.limit}`;
  }
  if (keyword === 'oneOf' || keyword === 'anyOf') {
    return '检查该对象的字段组合；每种元素只接受其 kind 对应的字段';
  }
  return undefined;
}

function pointersEqual(a: string, b: string): boolean {
  return a === b || a === `${b}/` || b === `${a}/`;
}

function issueMessage(
  keyword: string,
  params: Record<string, unknown>,
  missing?: string,
): string {
  switch (keyword) {
    case 'additionalProperties': {
      const property = typeof params.additionalProperty === 'string' ? params.additionalProperty : '?';
      return `存在协议不支持的字段「${property}」`;
    }
    case 'required':
      return `缺少必要字段「${missing ?? '?'}」`;
    case 'type':
      return `字段类型应为 ${String(params.type ?? '指定类型')}`;
    case 'const':
      return `值应为 ${JSON.stringify(params.allowedValue)}`;
    case 'enum':
      return Array.isArray(params.allowedValues)
        ? `允许值为 ${params.allowedValues.map((value) => JSON.stringify(value)).join(' / ')}`
        : '值不在允许范围内';
    case 'pattern':
      return '字段格式不符合要求';
    case 'minLength':
    case 'maxLength':
    case 'minItems':
    case 'maxItems':
      return '字段长度或数量超出允许范围';
    case 'minimum':
    case 'maximum':
      return '数值超出允许范围';
    case 'oneOf':
    case 'anyOf':
      return '字段组合不符合任何受支持的形式';
    default:
      return '该字段不符合协议要求';
  }
}

function sortPriority(keyword: string): number {
  switch (keyword) {
    case 'unknown-field':
      return 0;
    case 'required':
      return 1;
    case 'type':
    case 'const':
    case 'enum':
      return 2;
    case 'additionalProperties':
      return 3;
    case 'oneOf':
    case 'anyOf':
      return 4;
    default:
      return 5;
  }
}

const ELEMENT_PATH = /^\/elements\/(\d+)(?:\/|$)/;
const INLINE_ELEMENT_VARIANT = /\/items\/oneOf\/(\d+)(?:\/|$)/;
const REF_ELEMENT_VARIANT = /^#\/oneOf\/(\d+)(?:\/|$)/;

const SUPPORTED_KINDS: Record<number, readonly string[]> = {
  1: ['text'],
  2: ['text', 'number-input', 'slider', 'select', 'value'],
  3: [
    'text',
    'number-input',
    'slider',
    'select',
    'value',
    'note',
    'chart',
    'table',
    'section',
    'columns',
  ],
  4: [
    'text',
    'number-input',
    'slider',
    'select',
    'value',
    'note',
    'chart',
    'table',
    'section',
    'columns',
  ],
  5: [
    'text',
    'number-input',
    'slider',
    'select',
    'value',
    'note',
    'chart',
    'table',
    'explain',
    'section',
    'columns',
  ],
};

/**
 * v3 元素 variant 的下标对应 kind。v4/v5 分支共用 `#/oneOf/<n>` 的 schemaPath，
 * 只看下标会把 v3 table（8）与 v5 explain（8）的 kind 错误混在一起。
 */
const V3_VARIANT_KINDS: readonly string[] = SUPPORTED_KINDS[3]!;

function supportedKinds(version: number | null): readonly string[] {
  return version === null ? SUPPORTED_KINDS[3]! : (SUPPORTED_KINDS[version] ?? []);
}

/**
 * 找到错误所属的最深元素对象。元素可以嵌套在 section.children / columns 中，
 * 因此不能只按第一个 /elements/N 分组。
 */
function nearestElementPath(error: ErrorObject, data: unknown): string | null {
  if (!ELEMENT_PATH.test(error.instancePath)) return null;
  const segments = error.instancePath.split('/').filter(Boolean);
  for (let length = segments.length; length >= 2; length -= 1) {
    const pointer = `/${segments.slice(0, length).join('/')}`;
    const value = valueAtPointer(data, pointer);
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { kind?: unknown }).kind === 'string'
    ) {
      return pointer;
    }
  }
  return null;
}

/**
 * 元素 variant 在 Ajv 错误里的位置：v2 是内联 oneOf，v3 通过 $ref 展开后
 * schemaPath 会重置为 `#/oneOf/<variant>/...`，不能当成根版本分支号。
 */
function elementVariantOf(error: ErrorObject): number | null {
  const inline = INLINE_ELEMENT_VARIANT.exec(error.schemaPath);
  if (inline) return Number(inline[1]);
  if (!ELEMENT_PATH.test(error.instancePath)) return null;
  const ref = REF_ELEMENT_VARIANT.exec(error.schemaPath);
  return ref ? Number(ref[1]) : null;
}

/** 其他版本分支产生的根级噪音，与当前文档版本无关。 */
function isVersionNoise(error: ErrorObject, version: number | null): boolean {
  if (version === null) return false;
  if (error.instancePath === '/version' && error.keyword === 'const') return true;
  if (error.instancePath !== '') return false;
  const property =
    typeof error.params.additionalProperty === 'string' ? error.params.additionalProperty : null;
  const missing =
    typeof error.params.missingProperty === 'string' ? error.params.missingProperty : null;
  if (
    version >= 2 &&
    error.keyword === 'additionalProperties' &&
    (property === 'state' || property === 'derived')
  ) {
    return true;
  }
  if (
    version < 5 &&
    error.keyword === 'required' &&
    missing === 'models'
  ) {
    return true;
  }
  return (
    version === 1 &&
    error.keyword === 'required' &&
    (missing === 'state' || missing === 'derived')
  );
}

/**
 * 从 Ajv allErrors 结果中提取高信号问题：
 * - 按元素 kind 过滤 oneOf variant 噪音，并剔除其他版本分支的根级错误；
 * - 丢弃根级 oneOf 聚合错误与同路径的嵌套 oneOf 聚合错误；
 * - 把同一对象上的未知字段与缺失字段合并成一条（direction → dir）。
 */
export function buildSchemaIssues(errors: ErrorObject[], data: unknown): GenuiSchemaIssue[] {
  if (errors.length === 0) return [];

  const version = dataVersion(data);
  const rootAggregates = errors.filter(
    (error) => error.schemaPath === '#/oneOf' && error.keyword === 'oneOf',
  );
  const relevant = errors.filter(
    (error) => !rootAggregates.includes(error) && !isVersionNoise(error, version),
  );

  const elementGroups = new Map<string, ErrorObject[]>();
  const candidates: ErrorObject[] = [];
  for (const error of relevant) {
    const elementPath = nearestElementPath(error, data);
    if (!elementPath) {
      candidates.push(error);
      continue;
    }
    const group = elementGroups.get(elementPath);
    if (group) group.push(error);
    else elementGroups.set(elementPath, [error]);
  }

  const synthesized: GenuiSchemaIssue[] = [];
  for (const [elementPath, group] of elementGroups) {
    const value = valueAtPointer(data, elementPath);
    const kind =
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { kind?: unknown }).kind === 'string'
        ? (value as { kind: string }).kind
        : undefined;

    const indexes = new Set(
      group.map(elementVariantOf).filter((index): index is number => index !== null),
    );
    const mismatched = new Set<number>();
    for (const index of indexes) {
      const expectedKind = version === 3 ? V3_VARIANT_KINDS[index] : undefined;
      const hasKindMismatch =
        expectedKind !== undefined
          ? kind !== expectedKind
          : group.some(
              (error) =>
                error.keyword === 'const' &&
                error.instancePath === `${elementPath}/kind` &&
                elementVariantOf(error) === index,
            );
      if (hasKindMismatch) mismatched.add(index);
    }
    const matches = [...indexes].filter((index) => !mismatched.has(index));

    if (matches.length > 0) {
      candidates.push(
        ...group.filter((error) => {
          const index = elementVariantOf(error);
          return index === null || matches.includes(index);
        }),
      );
      continue;
    }

    const allowed = supportedKinds(version);
    if (kind !== undefined && allowed.length > 0 && !allowed.includes(kind)) {
      const pointer = `${elementPath}/kind`;
      synthesized.push({
        pointer,
        path: formatSchemaPath(pointer),
        keyword: 'enum',
        message: `当前协议版本不支持元素类型「${kind}」`,
        expected: `受支持的元素类型：${allowed.join(' / ')}`,
        actual: JSON.stringify(kind),
      });
      continue;
    }

    // kind 本身合法但没有匹配到 variant：只保留结构聚合提示，避免大量 variant 噪音。
    candidates.push(
      ...group.filter((error) => error.keyword === 'oneOf' || error.keyword === 'anyOf'),
    );
  }

  // 嵌套 oneOf 往往由更深层的具体错误解释；没有子错误时才保留聚合提示。
  const filtered = candidates.filter((error) => {
    if (error.keyword !== 'oneOf' && error.keyword !== 'anyOf') return true;
    return !candidates.some(
      (other) =>
        other !== error &&
        other.instancePath.length > error.instancePath.length &&
        other.instancePath.startsWith(`${error.instancePath}/`),
    );
  });

  const issues: GenuiSchemaIssue[] = [];
  const candidatesForMerge = filtered;

  const used = new Set<ErrorObject>();
  const additional = candidatesForMerge.filter(
    (error) => error.keyword === 'additionalProperties',
  );
  const required = candidatesForMerge.filter((error) => error.keyword === 'required');

  for (const error of additional) {
    const property =
      typeof error.params.additionalProperty === 'string' ? error.params.additionalProperty : null;
    if (!property) continue;
    const missing = required.find((candidate) => {
      const missingProperty = candidate.params.missingProperty;
      return (
        candidate.instancePath === error.instancePath &&
        typeof missingProperty === 'string' &&
        looksLikeFieldTypo(property, missingProperty)
      );
    });
    if (!missing) continue;

    used.add(error);
    used.add(missing);
    const missingProperty = String(missing.params.missingProperty);
    const pointer = `${error.instancePath}/${escapePointer(property)}`;
    issues.push({
      pointer,
      path: formatSchemaPath(pointer),
      keyword: 'unknown-field',
      message: `字段「${property}」不是受支持的字段，这里应使用「${missingProperty}」`,
      expected: expectedFor(error.instancePath, 'additionalProperties', error.params, missingProperty),
      actual: previewValue(valueAtPointer(data, pointer)),
    });
  }

  for (const error of candidatesForMerge) {
    if (used.has(error)) continue;
    const pointer = error.instancePath || '/';
    const missing =
      typeof error.params.missingProperty === 'string' ? error.params.missingProperty : undefined;
    const params = error.params as Record<string, unknown>;
    issues.push({
      pointer,
      path: formatSchemaPath(pointer),
      keyword: error.keyword,
      message: issueMessage(error.keyword, params, missing),
      expected: expectedFor(pointer, error.keyword, params, missing),
      actual: previewValue(valueAtPointer(data, pointer)),
    });
  }

  issues.push(...synthesized);

  const deduped: GenuiSchemaIssue[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const key = `${issue.pointer}|${issue.keyword}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(issue);
  }

  return deduped
    .sort((a, b) => {
      const priority = sortPriority(a.keyword) - sortPriority(b.keyword);
      return priority !== 0 ? priority : b.pointer.length - a.pointer.length;
    })
    .slice(0, 4);
}

function jsonErrorPosition(detail: string, raw: string): number | undefined {
  const match = /position\s+(\d+)/i.exec(detail);
  if (match) return Math.min(Number(match[1]), raw.length);
  if (/unexpected end of json input/i.test(detail)) return raw.length;
  return undefined;
}

function isLikelyTruncated(detail: string, position: number | undefined, raw: string): boolean {
  const lower = detail.toLowerCase();
  if (lower.includes('unexpected end') || lower.includes('unterminated')) return true;
  if (position !== undefined) {
    const trimmedLength = raw.trimEnd().length;
    return position >= trimmedLength - 1;
  }
  return false;
}

function lineColumn(raw: string, position: number): { line: number; column: number } {
  const before = raw.slice(0, Math.max(0, Math.min(position, raw.length)));
  const lastNewline = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length,
    column: position - lastNewline,
  };
}

function localizedJsonReason(detail: string): string {
  const lower = detail.toLowerCase();
  if (lower.includes('unexpected end')) return '内容在 JSON 中途结束';
  if (lower.includes('unterminated string')) return '字符串没有闭合';
  if (lower.includes('expected') || lower.includes('unexpected token')) {
    return '字符不符合 JSON 语法';
  }
  return '无法解析为 JSON';
}

function firstLine(text: string, max = 180): string {
  const line = text.split('\n')[0]?.trim() ?? text;
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** 结构校验失败 → 用户诊断。 */
function schemaDiagnostic(failure: ParseFailure): GenuiDiagnostic {
  const issues = failure.issues ?? [];
  const primary = issues[0];
  if (!primary) {
    return {
      kind: 'schema',
      status: 'needs-repair',
      title: '界面格式不符合协议',
      summary: '这段界面内容没有通过结构校验，可查看错误详情或生成修复请求。',
      detail: failure.detail,
      issues,
      repairable: true,
    };
  }

  const title =
    primary.keyword === 'unknown-field'
      ? '字段名称需要修复'
      : primary.keyword === 'required'
        ? '缺少必要字段'
        : primary.keyword === 'additionalProperties'
          ? '存在不支持的字段'
          : primary.keyword === 'oneOf' || primary.keyword === 'anyOf'
            ? '界面结构需要修复'
            : '字段格式需要修复';
  const where = primary.path === '文档根' ? '' : `在 ${primary.path} 处，`;
  const extra = issues.length > 1 ? `另有 ${issues.length - 1} 处相关问题。` : '';

  return {
    kind: 'schema',
    status: 'needs-repair',
    title,
    summary: `${where}${primary.message}。${extra}`,
    path: primary.path,
    pointer: primary.pointer,
    expected: primary.expected,
    actual: primary.actual,
    detail: failure.detail,
    issues,
    repairable: true,
  };
}

function jsonDiagnostic(failure: ParseFailure, raw: string): GenuiDiagnostic {
  const position = failure.position ?? jsonErrorPosition(failure.detail, raw);
  const truncated = isLikelyTruncated(failure.detail, position, raw);
  const location =
    position === undefined
      ? ''
      : (() => {
          const { line, column } = lineColumn(raw, position);
          return `（第 ${line} 行第 ${column} 列）`;
        })();

  if (truncated) {
    return {
      kind: 'truncated-json',
      status: 'incomplete',
      title: '界面内容尚未完整',
      summary: `这段 genui 内容在 JSON 中途结束${location}，可能是回答尚未生成完整或复制时被截断。若回答仍在生成请稍候；若已经结束，可生成修复请求。`,
      path: position === undefined ? undefined : `JSON 字符位置 ${position}`,
      pointer: undefined,
      position,
      expected: '完整的 JSON 对象（以 } 结束）',
      detail: failure.detail,
      issues: [],
      repairable: true,
    };
  }

  return {
    kind: 'invalid-json',
    status: 'needs-repair',
    title: '界面内容不是有效 JSON',
    summary: `${localizedJsonReason(failure.detail)}${location}。这段内容没有通过解析，原始内容已保留。`,
    path: position === undefined ? undefined : `JSON 字符位置 ${position}`,
    position,
    expected: '可解析的 JSON 对象',
    detail: failure.detail,
    issues: [],
    repairable: true,
  };
}

/** 解析失败 → 用户诊断；页面兼容问题由 diagnoseIncompatible 生成。 */
export function diagnoseParseFailure(failure: ParseFailure, raw = ''): GenuiDiagnostic {
  switch (failure.code) {
    case 'invalid-json':
      return jsonDiagnostic(failure, raw);
    case 'schema-violation':
      return schemaDiagnostic(failure);
    case 'unsupported-version':
      return {
        kind: 'unsupported-version',
        status: 'needs-repair',
        title: '协议版本暂不支持',
        summary: `${failure.detail}。可以请模型改用受支持的版本重发。`,
        path: 'version',
        pointer: '/version',
        expected: '版本号 1、2 或 3',
        detail: failure.detail,
        issues: [],
        repairable: true,
      };
    case 'semantic-violation':
    case 'invalid-reference':
    case 'dependency-cycle': {
      const issue = failure.issues?.[0];
      const title =
        failure.code === 'dependency-cycle'
          ? '界面数据存在循环依赖'
          : failure.code === 'invalid-reference'
            ? '界面引用了不存在的数据'
            : '界面数据需要修复';
      const expected =
        issue?.expected ??
        (failure.code === 'dependency-cycle'
          ? '派生值之间不能形成循环依赖'
          : failure.code === 'invalid-reference'
            ? '所有引用都应指向当前文档已声明的字段或值'
            : '检查字段取值与引用是否满足当前文档的约束');
      return {
        kind: 'semantic',
        status: 'needs-repair',
        title,
        summary: issue?.path
          ? `在 ${issue.path} 处，${firstLine(failure.detail)}`
          : firstLine(failure.detail),
        path: issue?.path,
        pointer: issue?.pointer,
        expected,
        detail: failure.detail,
        issues: failure.issues ?? [],
        repairable: true,
      };
    }
    case 'too-large':
      return {
        kind: 'too-large',
        status: 'needs-repair',
        title: '界面内容过长',
        summary: `${failure.detail}。可请模型精简这一块界面后重发。`,
        expected: `原始内容不超过 ${LIMITS.maxRawLength} 字符`,
        detail: failure.detail,
        issues: [],
        repairable: true,
      };
    case 'too-deep':
      return {
        kind: 'too-deep',
        status: 'needs-repair',
        title: '界面嵌套过深',
        summary: `${failure.detail}。可请模型减少组合布局的嵌套层级。`,
        expected: `嵌套不超过 ${LIMITS.maxDepth} 层`,
        detail: failure.detail,
        issues: [],
        repairable: true,
      };
    case 'too-complex':
      return {
        kind: 'too-complex',
        status: 'needs-repair',
        title: '界面结构过于复杂',
        summary: `${firstLine(failure.detail)}。可请模型拆分或简化这段界面。`,
        expected: '减少表达式、条件或组合布局的节点数量',
        detail: failure.detail,
        issues: [],
        repairable: true,
      };
  }
}

/** 链路级失败：内容可能本身有效，是页面结构/渲染暂时不兼容。 */
export function diagnoseIncompatible(
  reason: 'missing-pre' | 'mount-failed' | 'render-error',
): GenuiDiagnostic {
  const summary =
    reason === 'missing-pre'
      ? '页面上没有找到可用的原始内容节点，暂时无法验证或挂载。原始回答仍保留在代码块中。'
      : reason === 'mount-failed'
        ? '内容已通过校验，但卡片挂载失败。原始内容已保留，聊天可以继续。'
        : '内容已通过校验，但当前页面渲染卡片时出错。原始内容已保留，聊天可以继续。';
  return {
    kind: 'page-incompatible',
    status: 'page-incompatible',
    title: '页面暂不兼容这段界面',
    summary,
    expected: '无需修改界面内容；刷新或稍后重试，聊天仍可正常使用',
    detail: reason,
    issues: [],
    repairable: false,
  };
}

function resolveScopePointer(data: unknown, pointer: string | undefined): string | undefined {
  if (!pointer || pointer === '/' || pointer === '') return undefined;
  const value = valueAtPointer(data, pointer);
  if (value === undefined) return undefined;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return pointer;
  const segments = pointer.split('/').slice(1);
  if (segments.length <= 1) return undefined;
  return `/${segments.slice(0, -1).join('/')}`;
}

function capSnippet(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}
…（片段已截断，完整内容仍保留在页面代码块中）`;
}

function invalidJsonSnippet(raw: string, position: number | undefined): string {
  if (raw.length <= 3200) return raw;
  if (position !== undefined && position > 1500) {
    const start = Math.max(0, position - 1500);
    return `…（前面内容省略）
${raw.slice(start, start + 2800)}`;
  }
  return `${raw.slice(0, 2200)}
…（中间内容省略）…
${raw.slice(-800)}`;
}

function scopedSnippet(diagnostic: GenuiDiagnostic, raw: string): string {
  if (diagnostic.kind === 'truncated-json' || diagnostic.kind === 'invalid-json') {
    return invalidJsonSnippet(raw, diagnostic.position);
  }

  try {
    const data: unknown = JSON.parse(raw);
    const pointer = diagnostic.pointer;
    const scopePointer = resolveScopePointer(data, pointer);
    if (scopePointer) {
      const scoped = valueAtPointer(data, scopePointer);
      if (scoped !== undefined) {
        return capSnippet(JSON.stringify(scoped, null, 2), 3200);
      }
    }
    if (pointer && typeof valueAtPointer(data, pointer) === 'object') {
      const scoped = valueAtPointer(data, pointer);
      return capSnippet(JSON.stringify(scoped, null, 2), 3200);
    }
    return capSnippet(JSON.stringify(data, null, 2), 3200);
  } catch {
    return invalidJsonSnippet(raw, diagnostic.position);
  }
}

/**
 * 生成限定本次失败界面的修复草稿。
 *
 * - 只带失败元素/字段附近的片段，不带整段会话或其他代码块；
 * - 明确错误路径、期望格式与「只输出修复后代码块」的约束；
 * - 草稿由用户检查后自行发送，这里不触发任何发送动作。
 */
export function buildRepairPrompt(diagnostic: GenuiDiagnostic, raw: string): string {
  const lines: string[] = [
    '请修复下面这段 GenUI（genui）界面内容的格式错误，并只返回修复后的完整 `genui` 代码块。',
    '',
    `错误类型：${diagnostic.title}`,
    `错误摘要：${diagnostic.summary}`,
  ];

  if (diagnostic.path) {
    lines.push(
      diagnostic.pointer && diagnostic.pointer !== diagnostic.path
        ? `错误路径：${diagnostic.path}（${diagnostic.pointer}）`
        : `错误路径：${diagnostic.path}`,
    );
  }
  if (diagnostic.expected) lines.push(`期望格式：${diagnostic.expected}`);
  if (diagnostic.actual) lines.push(`当前值：${diagnostic.actual}`);

  const related = diagnostic.issues
    .filter((issue) => issue !== diagnostic.issues[0])
    .slice(0, 2)
    .map((issue) => `- ${issue.path}：${issue.message}`);
  if (related.length > 0) {
    lines.push('其他相关错误：', ...related);
  }

  const snippet = scopedSnippet(diagnostic, raw);
  lines.push(
    '',
    '相关原始内容（只包含本次失败位置附近的内容）：',
    '```genui',
    snippet,
    '```',
    '',
    '修复要求：',
    '- 只修正上述格式问题，保留原有界面意图与数据。',
    `- 使用协议 1–${PROTOCOL_VERSION} 的合法字段，不要添加未知字段，也不要猜测新的业务信息。`,
    '- 不要执行、解释或讨论代码，只输出修复后的完整 `genui` 代码块。',
  );

  const prompt = lines.join('\n');
  return prompt.length > 4000 ? `${prompt.slice(0, 3950)}
…（修复请求已截断）` : prompt;
}
