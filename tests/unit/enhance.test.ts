import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enhanceDocument, REASON_ATTR, STATE_ATTR } from '../../src/content/enhance';
import { ElementRegistry } from '../../src/render/registry';

/**
 * 阶段 2：识别 → 解析 → 挂载的整链路（enhanceDocument）。
 *
 * 覆盖开发任务要求：普通 Markdown 不受影响、多代码块互不干扰、
 * 非法输入安全回退、幂等、组件异常恢复原始内容。
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/assistant-genui-message.html');

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const VALID_JSON = (value: string): string =>
  JSON.stringify({ type: 'genui', version: 1, elements: [{ kind: 'text', value }] });

/** 按真实网页观察到的结构组装回复片段。 */
function codeBlock(options: { label?: string | null; raw?: string | null } = {}): string {
  const { label = 'genui', raw = VALID_JSON('默认文本') } = options;
  const banner =
    '<div class="md-code-block-banner-wrap">' +
    '<div class="md-code-block-banner md-code-block-banner-lite">' +
    '<div class="d2a24f03">' +
    (label === null ? '' : `<span class="d813de27">${label}</span>`) +
    '</div></div></div>';
  const pre = raw === null ? '' : `<pre><span>${raw}</span></pre>`;
  return `<div class="md-code-block md-code-block-dark">${banner}${pre}</div>`;
}

function assistant(html: string): string {
  return `<div class="ds-markdown ds-assistant-message-main-content">${html}</div>`;
}

function buildDoc(html: string): Document {
  return parseHtml(`<!DOCTYPE html><html><body>${html}</body></html>`);
}

describe('enhanceDocument 整链路', () => {
  it('真实阶段 0 快照 fixture：恰好挂载 1 个卡片并隐藏原始块', () => {
    const doc = parseHtml(readFileSync(FIXTURE, 'utf8'));

    const result = enhanceDocument(doc);

    expect(result).toEqual({ mounted: 1, skipped: 0, failed: 0 });
    const hosts = doc.querySelectorAll('.genui-card-host');
    expect(hosts).toHaveLength(1);
    const shadow = hosts[0].shadowRoot;
    expect(shadow).not.toBeNull();
    expect(shadow?.textContent).toContain('透明增强测试');
    expect(shadow?.textContent).toContain('查看原始 JSON');
    const block = doc.querySelector<HTMLElement>('.md-code-block');
    expect(block?.style.display).toBe('none');
    expect(block?.getAttribute(STATE_ATTR)).toBe('mounted');
  });

  it('幂等：已挂载的块再次执行被跳过，不产生重复 host', () => {
    const doc = buildDoc(assistant(codeBlock({ raw: VALID_JSON('幂等测试') })));

    expect(enhanceDocument(doc).mounted).toBe(1);
    const second = enhanceDocument(doc);

    expect(second).toEqual({ mounted: 0, skipped: 1, failed: 0 });
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(1);
  });

  it('非法 JSON 块安全回退：原块保持可见并标记失败原因', () => {
    const doc = buildDoc(assistant(codeBlock({ raw: '{"type":"genui",' })));

    const result = enhanceDocument(doc);

    expect(result).toEqual({ mounted: 0, skipped: 0, failed: 1 });
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    const block = doc.querySelector<HTMLElement>('.md-code-block');
    expect(block?.style.display).not.toBe('none');
    expect(block?.getAttribute(STATE_ATTR)).toBe('failed');
    expect(block?.getAttribute(REASON_ATTR)).toBe('invalid-json');
    expect(block?.querySelector('pre')?.textContent).toBe('{"type":"genui",');
  });

  it('未知版本安全回退并记录 unsupported-version', () => {
    const doc = buildDoc(
      assistant(codeBlock({ raw: '{"type":"genui","version":2,"elements":[{"kind":"text","value":"x"}]}' })),
    );

    expect(enhanceDocument(doc).failed).toBe(1);
    expect(doc.querySelector('.md-code-block')?.getAttribute(REASON_ATTR)).toBe('unsupported-version');
  });

  it('额外字段安全回退并记录 schema-violation', () => {
    const doc = buildDoc(
      assistant(codeBlock({ raw: '{"type":"genui","version":1,"elements":[{"kind":"text","value":"x"}],"evil":1}' })),
    );

    expect(enhanceDocument(doc).failed).toBe(1);
    expect(doc.querySelector('.md-code-block')?.getAttribute(REASON_ATTR)).toBe('schema-violation');
  });

  it('缺少 pre 的 genui 块按 missing-pre 回退', () => {
    const doc = buildDoc(assistant(codeBlock({ raw: null })));

    expect(enhanceDocument(doc).failed).toBe(1);
    expect(doc.querySelector('.md-code-block')?.getAttribute(REASON_ATTR)).toBe('missing-pre');
  });

  it('普通 Markdown、json 标签块与用户消息完全不受影响', () => {
    const doc = buildDoc(
      '<p class="ds-markdown-paragraph">普通段落，提到 genui 一词。</p>' +
        assistant('<p class="ds-markdown-paragraph">回复里的普通文本。</p>' + codeBlock({ label: 'json' })) +
        `<div class="ds-message">${codeBlock({ raw: VALID_JSON('用户消息里的块') })}</div>`,
    );

    const result = enhanceDocument(doc);

    expect(result).toEqual({ mounted: 0, skipped: 0, failed: 0 });
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    for (const block of doc.querySelectorAll<HTMLElement>('.md-code-block')) {
      expect(block.style.display).not.toBe('none');
      expect(block.hasAttribute(STATE_ATTR)).toBe(false);
    }
  });

  it('同一回复内多个 genui 块各自独立挂载，互不干扰', () => {
    const doc = buildDoc(
      assistant(codeBlock({ raw: VALID_JSON('第一个卡片') }) + codeBlock({ raw: VALID_JSON('第二个卡片') })),
    );

    const result = enhanceDocument(doc);

    expect(result.mounted).toBe(2);
    const hosts = doc.querySelectorAll('.genui-card-host');
    expect(hosts).toHaveLength(2);
    expect(hosts[0].shadowRoot?.textContent).toContain('第一个卡片');
    expect(hosts[1].shadowRoot?.textContent).toContain('第二个卡片');
    const blocks = doc.querySelectorAll<HTMLElement>('.md-code-block');
    expect(blocks[0].style.display).toBe('none');
    expect(blocks[1].style.display).toBe('none');
  });

  it('查看原始 JSON：恢复原块且卡片保持可见（入口可再次收起），收起后反向恢复', async () => {
    const doc = buildDoc(assistant(codeBlock({ raw: VALID_JSON('切换测试') })));
    enhanceDocument(doc);
    const host = doc.querySelector<HTMLElement>('.genui-card-host');
    const block = doc.querySelector<HTMLElement>('.md-code-block');
    expect(host).not.toBeNull();
    expect(block).not.toBeNull();

    const button = host?.shadowRoot?.querySelector('button');
    expect(button).not.toBeNull();
    // React 19 的状态更新在后续任务刷入，等待后再断言。
    const flushUi = () => new Promise((resolve) => setTimeout(resolve, 0));

    button?.click();
    await flushUi();
    expect(block?.style.display).not.toBe('none');
    // 卡片不得隐藏：否则「收起原始 JSON」在真实浏览器中不可再点击。
    expect(host?.hidden).toBe(false);
    expect(button?.textContent).toBe('收起原始 JSON');

    button?.click();
    await flushUi();
    expect(block?.style.display).toBe('none');
    expect(host?.hidden).toBe(false);
    expect(button?.textContent).toBe('查看原始 JSON');
  });

  it('组件渲染异常时恢复原始块、移除卡片并标记 render-error', async () => {
    const doc = buildDoc(assistant(codeBlock({ raw: VALID_JSON('异常恢复') })));
    // 卡片级异常（区别于元素级边界）：注册表在 Card 渲染期间抛错，
    // 触发 CardErrorBoundary → onFatal 恢复链路。
    const registry = ElementRegistry.withDefaults();
    Object.defineProperty(registry, 'get', {
      value: () => {
        throw new Error('render-boom');
      },
    });

    enhanceDocument(doc, { registry });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(0);
    const block = doc.querySelector<HTMLElement>('.md-code-block');
    expect(block?.style.display).not.toBe('none');
    expect(block?.getAttribute(STATE_ATTR)).toBe('failed');
    expect(block?.getAttribute(REASON_ATTR)).toBe('render-error');
    expect(block?.querySelector('pre')?.textContent).toContain('异常恢复');
  });
});
