import katex from 'katex';
import katexRawCss from 'katex/dist/katex.min.css?raw';
import { Fragment, useLayoutEffect, useRef } from 'react';
import { formatNumber } from './format';

/**
 * 本地 KaTeX 公式渲染层（P1-b）。
 *
 * 安全与打包约束：
 * - 完全本地打包，不引入任何远程脚本、样式或 CDN 字体；
 * - 强制 trust: false、throwOnError: false、strict: 'ignore'，禁用 \href/\url/\htmlClass 等扩展；
 * - 不使用 dangerouslySetInnerHTML；通过 KaTeX DOM 渲染器将受控节点写入独立 ref 容器，
 *   并在异常时回退为纯文本；
 * - Chromium 的 Shadow DOM 不会单独加载仅声明在 ShadowRoot 内的 @font-face，因此：
 *   1) Shadow DOM 内只注入剥离了 @font-face 的 KaTeX 布局 CSS（无相对 url() 404）；
 *   2) 宿主 document.head 幂等注入一次指向 chrome.runtime.getURL('fonts/katex/*.woff2') 的 @font-face。
 */

const FONT_FACE_BLOCK_RE = /@font-face\s*\{[^}]*\}/g;
const WOFF2_FILE_RE = /url\((?:["']?)fonts\/([A-Za-z0-9_-]+\.woff2)(?:["']?)\)/;

/** 从 KaTeX 样式表中剥离 @font-face 声明，避免 Shadow DOM 触发相对路径字体请求。 */
export function stripKatexFontFaces(css: string): string {
  return css.replace(FONT_FACE_BLOCK_RE, '');
}

/** 注入 Shadow DOM 的 KaTeX 布局样式（已剥离 @font-face，避免触发站点相对路径请求）。 */
export const KATEX_SHADOW_CSS = `${stripKatexFontFaces(katexRawCss)}\n.genui-math-display{display:block;text-align:center;margin:4px 0;overflow-x:auto;overflow-y:hidden;max-width:100%;padding:2px 0;}\n.genui-math-inline{display:inline-block;vertical-align:baseline;max-width:100%;overflow-x:auto;overflow-y:hidden;}\n.genui-math-fallback{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:0.92em;}\n`;

const KATEX_FONT_STYLE_ATTR = 'data-genui-katex-fonts';

function resolveExtensionUrl(path: string): string | null {
  try {
    const runtime = (
      globalThis as {
        chrome?: { runtime?: { id?: string; getURL?: (resource: string) => string } };
      }
    ).chrome?.runtime;
    if (!runtime?.id || typeof runtime.getURL !== 'function') return null;
    const url = runtime.getURL(path);
    return typeof url === 'string' && url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

function buildLocalFontFaceCss(): string | null {
  const blocks = katexRawCss.match(FONT_FACE_BLOCK_RE);
  if (!blocks || blocks.length === 0) return null;
  const rules: string[] = [];
  for (const block of blocks) {
    const fileMatch = WOFF2_FILE_RE.exec(block);
    if (!fileMatch) continue;
    const url = resolveExtensionUrl(`fonts/katex/${fileMatch[1]}`);
    if (!url) return null;
    const rewritten = block
      .replace(/src\s*:[^;}]+/, `src:url("${url}") format("woff2")`)
      .replace(/font-display\s*:[^;}]+/, 'font-display:swap');
    rules.push(rewritten);
  }
  return rules.length > 0 ? rules.join('\n') : null;
}

/** 在宿主文档 head 中幂等注入本地 KaTeX woff2 字体声明（Shadow DOM 可直接继承）。 */
export function ensureKatexFonts(doc: Document | null | undefined): void {
  if (!doc) return;
  const root = doc.head ?? doc.documentElement;
  if (!root) return;
  if (doc.querySelector(`style[${KATEX_FONT_STYLE_ATTR}]`)) return;
  const css = buildLocalFontFaceCss();
  if (!css) return;
  const style = doc.createElement('style');
  style.setAttribute(KATEX_FONT_STYLE_ATTR, '1');
  style.textContent = css;
  root.appendChild(style);
}

export type MathSegment =
  | { kind: 'text'; value: string }
  | { kind: 'inline'; tex: string }
  | { kind: 'display'; tex: string };

const HAS_MATH_HINT_RE = /\$|\\[()[\]]/;

function isSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function findUnescaped(text: string, needle: string, from: number, allowNewline: boolean): number {
  let i = from;
  while (i <= text.length - needle.length) {
    const ch = text[i];
    if (ch === '\\') {
      if (needle.startsWith('\\') && text.startsWith(needle, i)) {
        return i;
      }
      i += 2;
      continue;
    }
    if (!allowNewline && (ch === '\n' || ch === '\r')) {
      return -1;
    }
    if (text.startsWith(needle, i)) {
      return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * 将包含 `$...$` / `$$...$$` / `\(...\)` / `\[...\]` 的纯文本切分为受控片段。
 * 遵循 Pandoc/KaTeX 货币避让规则：`$100`、`$50 到 $80`、`$50-$100` 保持普通文本。
 */
export function parseMathSegments(text: string): MathSegment[] {
  if (!HAS_MATH_HINT_RE.test(text)) {
    return [{ kind: 'text', value: text }];
  }

  const out: MathSegment[] = [];
  let buf = '';
  let i = 0;

  const flushText = () => {
    if (buf.length > 0) {
      out.push({ kind: 'text', value: buf });
      buf = '';
    }
  };

  while (i < text.length) {
    // 1) 转义的 \$ 输出为字面 $
    if (text[i] === '\\' && text[i + 1] === '$') {
      buf += '$';
      i += 2;
      continue;
    }

    // 2) 块级 $$...$$
    if (text[i] === '$' && text[i + 1] === '$') {
      const end = findUnescaped(text, '$$', i + 2, true);
      if (end > i + 2) {
        const tex = text.slice(i + 2, end).trim();
        if (tex.length > 0) {
          flushText();
          out.push({ kind: 'display', tex });
          i = end + 2;
          continue;
        }
      }
      buf += '$$';
      i += 2;
      continue;
    }

    // 3) 块级 \[...\]
    if (text[i] === '\\' && text[i + 1] === '[') {
      const end = findUnescaped(text, '\\]', i + 2, true);
      if (end > i + 2) {
        const tex = text.slice(i + 2, end).trim();
        if (tex.length > 0) {
          flushText();
          out.push({ kind: 'display', tex });
          i = end + 2;
          continue;
        }
      }
    }

    // 4) 行内 \(...\)
    if (text[i] === '\\' && text[i + 1] === '(') {
      const end = findUnescaped(text, '\\)', i + 2, false);
      if (end > i + 2) {
        const tex = text.slice(i + 2, end).trim();
        if (tex.length > 0) {
          flushText();
          out.push({ kind: 'inline', tex });
          i = end + 2;
          continue;
        }
      }
    }

    // 5) 行内 $...$（避让货币写法：$100 / $50 到 $80 / $50-$100）
    if (text[i] === '$' && !isSpace(text[i + 1])) {
      let searchFrom = i + 1;
      let matchedEnd = -1;
      while (searchFrom < text.length) {
        const end = findUnescaped(text, '$', searchFrom, false);
        if (end < 0) break;
        // 遇到 $$ 不作为行内闭符
        if (text[end + 1] === '$') {
          searchFrom = end + 2;
          continue;
        }
        const prevChar = text[end - 1];
        const nextChar = text[end + 1];
        if (!isSpace(prevChar) && !isDigit(nextChar)) {
          matchedEnd = end;
          break;
        }
        searchFrom = end + 1;
      }

      if (matchedEnd > i + 1) {
        const tex = text.slice(i + 1, matchedEnd).trim();
        if (tex.length > 0) {
          flushText();
          out.push({ kind: 'inline', tex });
          i = matchedEnd + 1;
          continue;
        }
      }
    }

    buf += text[i];
    i += 1;
  }

  flushText();
  return out.length > 0 ? out : [{ kind: 'text', value: '' }];
}

const FORMULA_PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/**
 * 单遍替换公式模板中的 `{varId}` 占位符，用于滑块/派生值驱动的动态公式（如 `y = {a}x^2`）。
 * 替换结果不做二次展开，未命中的占位符原样保留（不破坏 LaTeX 花括号如 `\frac{1}{2}`）。
 */
export function interpolateFormula(
  template: string,
  values: Readonly<Record<string, number | string | undefined>>,
): string {
  return template.replace(FORMULA_PLACEHOLDER_RE, (full, id: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, id)) return full;
    const raw = values[id];
    if (raw === undefined) return full;
    if (typeof raw === 'number') {
      return Number.isFinite(raw) ? formatNumber(raw) : '?';
    }
    return raw;
  });
}

/** 提取公式模板中出现的所有 `{varId}` 标识符（去重），供内联总线订阅使用。 */
export function extractFormulaVars(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of template.matchAll(FORMULA_PLACEHOLDER_RE)) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export interface MathFormulaProps {
  tex: string;
  displayMode?: boolean;
  className?: string;
}

/** 受控 KaTeX 公式节点：直接渲染到 ref 容器，禁用 trust 扩展并在出错时回退纯文本。 */
export function MathFormula({ tex, displayMode = false, className }: MathFormulaProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    ensureKatexFonts(node.ownerDocument);
    try {
      katex.render(tex, node, {
        displayMode,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
        maxSize: 100,
        maxExpand: 200,
        output: 'htmlAndMathml',
      });
    } catch {
      node.textContent = tex;
      node.classList.add('genui-math-fallback');
    }
  }, [tex, displayMode]);

  const cls = [
    displayMode ? 'genui-math-display' : 'genui-math-inline',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <span ref={hostRef} className={cls} data-genui-math={tex} />;
}

/**
 * 渲染可能包含行内/块级公式的文本。
 * 无公式定界符时直接返回原字符串，零额外 DOM 包装，保持纯文本结构与既有单测完全兼容。
 */
export function MathText({ text }: { text: string }) {
  if (!HAS_MATH_HINT_RE.test(text)) {
    return <>{text}</>;
  }
  const segments = parseMathSegments(text);
  if (segments.length === 1 && segments[0]?.kind === 'text') {
    return <>{segments[0].value}</>;
  }
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          return <Fragment key={index}>{segment.value}</Fragment>;
        }
        return (
          <MathFormula
            key={index}
            tex={segment.tex}
            displayMode={segment.kind === 'display'}
          />
        );
      })}
    </>
  );
}
