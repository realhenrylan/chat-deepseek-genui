import type { FormWidget } from './types.ts';

export const MAX_FORM_PROMPT_LENGTH = 600;

export type TemplateToken =
  | { kind: 'text'; value: string }
  | { kind: 'var'; fieldId: string }
  | { kind: 'cond'; fieldId: string; body: TemplateToken[] };

export interface TemplateParseResult {
  tokens: TemplateToken[];
  referencedIds: string[];
  validSyntax: boolean;
}

const IDENT_CHAR = /^[A-Za-z0-9_-]$/;

function parseSegment(
  source: string,
  start: number,
  stopAtBrace: boolean,
  referenced: Set<string>,
): { tokens: TemplateToken[]; nextIndex: number; closed: boolean; validSyntax: boolean } {
  const tokens: TemplateToken[] = [];
  let textBuf = '';
  let i = start;

  const flushText = () => {
    if (textBuf.length > 0) {
      tokens.push({ kind: 'text', value: textBuf });
      textBuf = '';
    }
  };

  while (i < source.length) {
    const ch = source[i];
    if (stopAtBrace && ch === '}') {
      flushText();
      return { tokens, nextIndex: i + 1, closed: true, validSyntax: true };
    }
    if (ch !== '{') {
      textBuf += ch;
      i += 1;
      continue;
    }

    // 扫描 {fieldId} 或 {fieldId?...}
    let j = i + 1;
    while (j < source.length && IDENT_CHAR.test(source[j])) {
      j += 1;
    }
    const fieldId = source.slice(i + 1, j);
    if (fieldId.length > 0 && j < source.length && source[j] === '}') {
      flushText();
      referenced.add(fieldId);
      tokens.push({ kind: 'var', fieldId });
      i = j + 1;
      continue;
    }
    if (fieldId.length > 0 && j < source.length && source[j] === '?') {
      flushText();
      referenced.add(fieldId);
      const inner = parseSegment(source, j + 1, true, referenced);
      if (!inner.closed || !inner.validSyntax) {
        return { tokens, nextIndex: source.length, closed: false, validSyntax: false };
      }
      tokens.push({ kind: 'cond', fieldId, body: inner.tokens });
      i = inner.nextIndex;
      continue;
    }

    // 孤立或非法大括号：按普通字面量处理。
    textBuf += ch;
    i += 1;
  }

  flushText();
  return {
    tokens,
    nextIndex: i,
    closed: !stopAtBrace,
    validSyntax: !stopAtBrace,
  };
}

/** 单遍解析提示词模板为 AST，不执行任何运行时插值。 */
export function parseFormPromptTemplate(template: string): TemplateParseResult {
  const referenced = new Set<string>();
  const parsed = parseSegment(template, 0, false, referenced);
  return {
    tokens: parsed.tokens,
    referencedIds: [...referenced],
    validSyntax: parsed.validSyntax,
  };
}

export interface TemplateValidationResult {
  valid: boolean;
  missingFields: string[];
  reason?: 'empty' | 'syntax' | 'unknown-fields';
}

/** 校验模板是否非空、括号配对合法且所有占位符都引用了已声明字段（R-T2 / R-T3）。 */
export function validateFormPromptTemplate(
  template: string,
  fieldIds: ReadonlySet<string>,
): TemplateValidationResult {
  if (template.trim() === '') {
    return { valid: false, missingFields: [], reason: 'empty' };
  }
  const parsed = parseFormPromptTemplate(template);
  if (!parsed.validSyntax) {
    return { valid: false, missingFields: [], reason: 'syntax' };
  }
  const missingFields = parsed.referencedIds.filter((id) => !fieldIds.has(id));
  if (missingFields.length > 0) {
    return { valid: false, missingFields, reason: 'unknown-fields' };
  }
  return { valid: true, missingFields: [] };
}

/**
 * 单遍渲染 AST（R-T2）：
 * 字段值只作为纯文本直接写入输出，绝不二次解析占位符或 Markdown。
 */
function renderTokens(tokens: readonly TemplateToken[], values: Readonly<Record<string, string>>): string {
  const parts: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'text') {
      parts.push(token.value);
    } else if (token.kind === 'var') {
      parts.push(values[token.fieldId] ?? '');
    } else {
      const value = values[token.fieldId] ?? '';
      if (value.trim() !== '') {
        parts.push(renderTokens(token.body, values));
      }
    }
  }
  return parts.join('');
}

/** R-T3 本地通用回退模板。 */
export function buildGenericFormPrompt(
  widget: Pick<FormWidget, 'title' | 'fields'>,
  values: Readonly<Record<string, string>>,
): string {
  const parts: string[] = [];
  for (const field of widget.fields) {
    const val = values[field.id] ?? '';
    if (val.trim() === '') continue;
    parts.push(`${field.label}：${val}`);
  }
  return `关于『${widget.title}』，我的选择是：${parts.join('；')}。请据此继续。`;
}

function truncateCodePoints(value: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  const chars = Array.from(value);
  if (chars.length <= maxChars) return value;
  if (maxChars === 1) return '…';
  return `${chars.slice(0, maxChars - 1).join('')}…`;
}

/**
 * 生成最终回流消息（R-T2 / R-T3 / R-T4）：
 * - 模板合法时按 AST 单遍渲染；缺失或引用不存在字段时回退到本地通用模板；
 * - 超出 maxLength（默认 600 字）时仅截断补充文本（type === 'text'），选项部分永不截断。
 */
export function renderFormPrompt(
  widget: Pick<FormWidget, 'title' | 'fields' | 'submit'>,
  formattedValues: Readonly<Record<string, string>>,
  maxLength: number = MAX_FORM_PROMPT_LENGTH,
): string {
  const fieldIds = new Set(widget.fields.map((field) => field.id));
  const validation = validateFormPromptTemplate(widget.submit.prompt, fieldIds);
  const tokens = validation.valid ? parseFormPromptTemplate(widget.submit.prompt).tokens : null;

  const renderWith = (values: Readonly<Record<string, string>>): string =>
    tokens ? renderTokens(tokens, values) : buildGenericFormPrompt(widget, values);

  const full = renderWith(formattedValues);
  if (full.length <= maxLength) return full;

  const textFieldIds = widget.fields
    .filter((field) => field.type === 'text')
    .map((field) => field.id);
  if (textFieldIds.length === 0) return full;

  const withoutTextValues: Record<string, string> = { ...formattedValues };
  for (const id of textFieldIds) {
    withoutTextValues[id] = '';
  }
  const withoutText = renderWith(withoutTextValues);
  if (withoutText.length >= maxLength) return withoutText;

  const working: Record<string, string> = { ...formattedValues };
  let current = full;

  // 逐步缩短最长的补充文本字段，直到满足长度上限；不截断任何选项部分。
  for (let guard = 0; guard < 32 && current.length > maxLength; guard += 1) {
    let longestId: string | null = null;
    let longestLen = 0;
    for (const id of textFieldIds) {
      const len = Array.from(working[id] ?? '').length;
      if (len > longestLen) {
        longestLen = len;
        longestId = id;
      }
    }
    if (!longestId || longestLen === 0) break;

    const excess = current.length - maxLength;
    const targetLen =
      longestLen > excess + 1 ? longestLen - excess : Math.floor(longestLen / 2);
    working[longestId] = targetLen <= 1 ? '' : truncateCodePoints(working[longestId], targetLen);
    current = renderWith(working);
  }

  return current.length <= maxLength ? current : withoutText;
}
