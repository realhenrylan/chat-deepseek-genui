import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findGenuiBlocks } from '../../src/content/detect';

/**
 * 阶段 2：genui 代码块识别（依据 docs/compatibility-investigation.md §3.2–3.3）。
 *
 * 规则：
 * - 只扫描 AI 回复容器 div.ds-assistant-message-main-content，不触碰用户消息；
 * - 只处理语言标签明确为 genui 的代码块（span.d813de27 优先，banner 内叶子节点回退）；
 * - json / python 或无标签的代码块、普通 Markdown 一律不处理。
 */

const EXPECTED_JSON = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"透明增强测试"}]}';

const FIXTURE = join(process.cwd(), 'tests/fixtures/assistant-genui-message.html');
const REAL_PAGE = join(process.cwd(), '.tmp/genui2.html');
const REAL_PAGE_JSON_LABEL = join(process.cwd(), '.tmp/genui.html');
const REAL_PAGE_PYTHON = join(process.cwd(), '.tmp/page.html');

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** 按真实网页观察到的结构组装代码块。 */
function codeBlock(options: {
  label?: string | null;
  labelClass?: string;
  raw?: string | null;
}): string {
  const {
    label = 'genui',
    labelClass = 'd813de27',
    raw = EXPECTED_JSON,
  } = options;
  const banner =
    '<div class="md-code-block-banner-wrap">' +
    '<div class="md-code-block-banner md-code-block-banner-lite">' +
    '<div class="_121d384"><div class="d2a24f03">' +
    (label === null ? '' : `<span class="${labelClass}">${label}</span>`) +
    '</div></div></div></div>';
  const pre = raw === null ? '' : `<pre><span>${raw}</span></pre>`;
  return `<div class="md-code-block md-code-block-dark">${banner}${pre}</div>`;
}

function assistant(html: string): string {
  return `<div class="ds-markdown ds-assistant-message-main-content">${html}</div>`;
}

describe('genui 代码块识别', () => {
  describe('真实网页取证', () => {
    it('阶段 0 真实快照 fixture 检出恰好 1 个 genui 块并读出原始 JSON', () => {
      const doc = parseHtml(readFileSync(FIXTURE, 'utf8'));

      const blocks = findGenuiBlocks(doc);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].labelSource).toBe('primary');
      expect(blocks[0].pre).not.toBeNull();
      expect(blocks[0].pre?.textContent).toBe(EXPECTED_JSON);
    });

    it.runIf(existsSync(REAL_PAGE))(
      '完整真实页面快照 .tmp/genui2.html 检出恰好 1 个 genui 块',
      () => {
        const doc = parseHtml(readFileSync(REAL_PAGE, 'utf8'));

        const blocks = findGenuiBlocks(doc);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].pre?.textContent).toBe(EXPECTED_JSON);
      },
    );

    it.runIf(existsSync(REAL_PAGE_JSON_LABEL))(
      '真实页面快照 .tmp/genui.html（json 标签 + genui 内容）按规则不处理',
      () => {
        const doc = parseHtml(readFileSync(REAL_PAGE_JSON_LABEL, 'utf8'));

        expect(findGenuiBlocks(doc)).toHaveLength(0);
      },
    );

    it.runIf(existsSync(REAL_PAGE_PYTHON))(
      '真实页面快照 .tmp/page.html（python 代码块）不处理',
      () => {
        const doc = parseHtml(readFileSync(REAL_PAGE_PYTHON, 'utf8'));

        expect(findGenuiBlocks(doc)).toHaveLength(0);
      },
    );
  });

  describe('识别边界', () => {
    it('语言标签为 json 的代码块即使内容是 genui 协议也不处理', () => {
      const doc = parseHtml(assistant(codeBlock({ label: 'json' })));

      expect(findGenuiBlocks(doc)).toHaveLength(0);
    });

    it('用户消息 div.ds-message 中的 genui 块不处理', () => {
      const doc = parseHtml(`<div class="ds-message">${codeBlock({})}</div>`);

      expect(findGenuiBlocks(doc)).toHaveLength(0);
    });

    it('普通 Markdown 段落（无代码块）不产生候选', () => {
      const doc = parseHtml(
        assistant('<p class="ds-markdown-paragraph">这里提到 genui 一词。</p>'),
      );

      expect(findGenuiBlocks(doc)).toHaveLength(0);
    });

    it('无语言标签的代码块不处理', () => {
      const doc = parseHtml(assistant(codeBlock({ label: null })));

      expect(findGenuiBlocks(doc)).toHaveLength(0);
    });

    it('同一回复内多个 genui 块按文档顺序全部检出，其他语言块被跳过', () => {
      const first = codeBlock({ raw: '{"type":"genui","version":1,"elements":[{"kind":"text","value":"第一"}]}' });
      const python = codeBlock({ label: 'python', raw: 'print(1)' });
      const second = codeBlock({ raw: '{"type":"genui","version":1,"elements":[{"kind":"text","value":"第二"}]}' });
      const doc = parseHtml(assistant(first + python + second));

      const blocks = findGenuiBlocks(doc);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].pre?.textContent).toContain('"第一"');
      expect(blocks[1].pre?.textContent).toContain('"第二"');
    });

    it('标签大小写敏感：Genui 不匹配', () => {
      const doc = parseHtml(assistant(codeBlock({ label: 'Genui' })));

      expect(findGenuiBlocks(doc)).toHaveLength(0);
    });

    it('标签首尾空白会被裁剪后匹配', () => {
      const doc = parseHtml(assistant(codeBlock({ label: '  genui  ' })));

      expect(findGenuiBlocks(doc)).toHaveLength(1);
    });

    it('哈希类名回退：banner 内叶子节点文本为 genui 时仍可检出', () => {
      const doc = parseHtml(assistant(codeBlock({ labelClass: 'lang-label-rotated' })));

      const blocks = findGenuiBlocks(doc);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].labelSource).toBe('fallback');
    });

    it('banner 中的复制按钮文本不会被误判为语言标签', () => {
      const html =
        '<div class="md-code-block md-code-block-dark">' +
        '<div class="md-code-block-banner-wrap"><div class="md-code-block-banner">' +
        '<div class="d2a24f03"><span class="d813de27">genui</span></div>' +
        '<div role="button" class="ds-button"><span class="code-info-button-text">复制</span></div>' +
        '</div></div>' +
        `<pre><span>${EXPECTED_JSON}</span></pre></div>`;
      const doc = parseHtml(assistant(html));

      expect(findGenuiBlocks(doc)).toHaveLength(1);
    });

    it('有 genui 标签但缺少 pre 时仍返回候选且 pre 为 null', () => {
      const doc = parseHtml(assistant(codeBlock({ raw: null })));

      const blocks = findGenuiBlocks(doc);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].pre).toBeNull();
    });

    it('无 AI 回复容器的文档返回空数组', () => {
      expect(findGenuiBlocks(parseHtml('<main><p>普通页面</p></main>'))).toHaveLength(0);
    });
  });
});
