import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRepairPrompt,
  diagnoseIncompatible,
  diagnoseParseFailure,
} from '../../src/protocol/diagnose';
import { parseGenui } from '../../src/protocol/validate';
import { GenuiStatusPanel, type StatusPanelOptions } from '../../src/content/failure-ui';
import { createEnhancementManager, STATE_ATTR, REASON_ATTR } from '../../src/content/enhance';
import { findGenuiBlocks } from '../../src/content/detect';
import { deliverRepairRequest } from '../../src/content/repair';
import { appendDraftIntoInput } from '../../src/content/followup';

const VALID_TEXT = JSON.stringify({
  type: 'genui',
  version: 1,
  elements: [{ kind: 'text', value: '默认文本' }],
});

function tableDocument(initialSort: unknown): string {
  return JSON.stringify({
    type: 'genui',
    version: 3,
    title: '价格表',
    state: [],
    derived: [],
    elements: [
      {
        kind: 'table',
        title: '价格',
        columns: [
          { key: 'name', label: '名称' },
          { key: 'price', label: '价格', numeric: true },
        ],
        rows: [{ cells: { name: '基础版', price: 10 } }],
        initialSort,
      },
    ],
  });
}

function failureOf(raw: string) {
  const parsed = parseGenui(raw);
  if (parsed.ok) throw new Error('expected parse failure');
  return parsed;
}

function panelFor(raw: string, doc: Document, options: StatusPanelOptions = {}) {
  const block = doc.createElement('div');
  block.className = 'md-code-block';
  const pre = doc.createElement('pre');
  pre.textContent = raw;
  block.append(pre);
  doc.body.append(block);
  return { block, panel: new GenuiStatusPanel(doc, block, options) };
}

function codeBlock(raw: string | null): string {
  const banner =
    '<div class="md-code-block-banner-wrap"><div class="md-code-block-banner">' +
    '<span class="d813de27">genui</span></div></div>';
  return `<div class="md-code-block">${banner}${raw === null ? '' : `<pre><span>${raw}</span></pre>`}</div>`;
}

function buildDoc(html: string): Document {
  return new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body><div class="ds-assistant-message-main-content">${html}</div></body></html>`,
    'text/html',
  );
}

function shadowText(panel: GenuiStatusPanel): string {
  return panel.host.shadowRoot?.textContent ?? '';
}

describe('协议失败诊断：initialSort.direction 真实案例', () => {
  const raw = tableDocument({ key: 'price', direction: 'asc' });
  const failure = failureOf(raw);
  const diagnostic = diagnoseParseFailure(failure, raw);

  it('提取最相关字段并合并 direction → dir，不保留 oneOf 根/分支噪音', () => {
    expect(failure.code).toBe('schema-violation');
    expect(failure.issues?.length).toBeGreaterThan(0);
    expect(failure.issues?.length).toBeLessThanOrEqual(4);

    const primary = failure.issues?.[0];
    expect(primary?.pointer).toBe('/elements/0/initialSort/direction');
    expect(primary?.path).toBe('elements[0].initialSort.direction');
    expect(primary?.keyword).toBe('unknown-field');
    expect(primary?.message).toContain('direction');
    expect(primary?.message).toContain('dir');
    expect(primary?.expected).toContain('initialSort');
    expect(primary?.expected).toContain('dir');

    for (const issue of failure.issues ?? []) {
      expect(issue.pointer).not.toBe('/');
      expect(issue.pointer).not.toMatch(/^\/(state|derived)(\/|$)/);
      expect(issue.pointer).not.toBe('/version');
    }

    expect(diagnostic.status).toBe('needs-repair');
    expect(diagnostic.path).toBe('elements[0].initialSort.direction');
    expect(diagnostic.summary).toContain('elements[0].initialSort.direction');
    expect(diagnostic.summary).toContain('dir');
  });

  it('修复请求包含错误路径、期望格式，且只带失败对象附近的内容', () => {
    const prompt = buildRepairPrompt(diagnostic, raw);

    expect(prompt).toContain('elements[0].initialSort.direction');
    expect(prompt).toContain('/elements/0/initialSort/direction');
    expect(prompt).toContain('"dir"');
    expect(prompt).toContain('"direction": "asc"');
    expect(prompt).toContain('只返回修复后的完整 `genui` 代码块');
    expect(prompt).not.toContain('"cells"');
    expect(prompt).not.toContain('基础版');
    expect(prompt.length).toBeLessThanOrEqual(4000);
  });
});

describe('协议失败诊断：流式截断与永久非法 JSON', () => {
  it('流式截断标记为尚未完整，而不是永久失败', () => {
    const truncated = VALID_TEXT.slice(0, 62);
    expect(truncated.length).toBeLessThan(VALID_TEXT.length);
    const failure = failureOf(truncated);
    const diagnostic = diagnoseParseFailure(failure, truncated);

    expect(failure.code).toBe('invalid-json');
    expect(diagnostic.kind).toBe('truncated-json');
    expect(diagnostic.status).toBe('incomplete');
    expect(diagnostic.title).toBe('界面内容尚未完整');
    expect(diagnostic.repairable).toBe(true);
    expect(diagnostic.summary).toContain('尚未生成完整');
  });

  it('永久非法 JSON 给出可修复诊断与位置', () => {
    const raw = '{"type":"genui","version":1,"elements":[}';
    const failure = failureOf(raw);
    const diagnostic = diagnoseParseFailure(failure, raw);

    expect(failure.code).toBe('invalid-json');
    expect(diagnostic.kind).toBe('invalid-json');
    expect(diagnostic.status).toBe('needs-repair');
    expect(diagnostic.title).toBe('界面内容不是有效 JSON');
    expect(diagnostic.summary).toContain('JSON');
    expect(diagnostic.repairable).toBe(true);
  });

  it('页面兼容问题不要求修复内容', () => {
    const diagnostic = diagnoseIncompatible('render-error');
    expect(diagnostic.status).toBe('page-incompatible');
    expect(diagnostic.repairable).toBe(false);
    expect(diagnostic.summary).toContain('聊天可以继续');
  });
});

describe('失败面板与修复草稿', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('展示标题、错误路径、期望格式与原始内容，不自动发送', async () => {
    const raw = tableDocument({ key: 'price', direction: 'asc' });
    const failure = failureOf(raw);
    const diagnostic = diagnoseParseFailure(failure, raw);
    const doc = document.implementation.createHTMLDocument('test');
    const requested: string[] = [];
    const send = vi.fn();
    doc.body.insertAdjacentHTML('beforeend', '<button aria-label="发送">发送</button>');
    doc.querySelector('button')?.addEventListener('click', send);
    const { panel } = panelFor(raw, doc, {
      onRequestRepair: (prompt) => {
        requested.push(prompt);
        return 'filled';
      },
    });
    panel.showDiagnostic(diagnostic, raw);

    const shadow = panel.host.shadowRoot;
    expect(shadow?.querySelector('.genui-status-title')?.textContent).toBe(diagnostic.title);
    expect(shadowText(panel)).toContain('错误路径：');
    expect(shadowText(panel)).toContain('elements[0].initialSort.direction');
    expect(shadowText(panel)).toContain('期望格式：');
    expect(shadow?.querySelector('pre[data-genui-raw]')?.textContent).toBe(raw);

    shadow?.querySelector<HTMLButtonElement>('[data-genui-action="repair"]')?.click();
    await vi.waitFor(() => {
      expect(shadow?.querySelector('[data-genui-feedback]')?.textContent).toContain('已填入输入框');
    });

    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain('elements[0].initialSort.direction');
    expect(send).not.toHaveBeenCalled();
  });

  it('保留已有草稿，重复点击不会重复追加同一修复内容', async () => {
    const doc = document.implementation.createHTMLDocument('test');
    const textarea = doc.createElement('textarea');
    textarea.name = 'search';
    textarea.value = '用户已经写好的草稿';
    doc.body.append(textarea);

    const raw = tableDocument({ key: 'price', direction: 'asc' });
    const diagnostic = diagnoseParseFailure(failureOf(raw), raw);
    const { panel } = panelFor(raw, doc, {
      onRequestRepair: (prompt) => deliverRepairRequest(doc, prompt),
    });
    panel.showDiagnostic(diagnostic, raw);

    const repair = panel.host.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-genui-action="repair"]',
    );
    repair?.click();
    await vi.waitFor(() => {
      expect(textarea.value).toContain('elements[0].initialSort.direction');
    });

    const afterFirst = textarea.value;
    expect(afterFirst.startsWith('用户已经写好的草稿')).toBe(true);
    expect(afterFirst.split('elements[0].initialSort.direction').length).toBeGreaterThan(1);

    repair?.click();
    await vi.waitFor(() => {
      expect(panel.host.shadowRoot?.querySelector('[data-genui-feedback]')?.textContent).toContain(
        '草稿已保留',
      );
    });
    expect(textarea.value).toBe(afterFirst);
  });

  it('找不到输入框时复制修复请求作为退路', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const doc = document.implementation.createHTMLDocument('test');
    const result = await deliverRepairRequest(doc, '修复这段 genui 内容');

    expect(result).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('修复这段 genui 内容');
  });

  it('找不到输入框且复制失败时明确返回 copy-failed', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const doc = document.implementation.createHTMLDocument('test');
    (doc as unknown as { execCommand: () => boolean }).execCommand = () => false;

    const result = await deliverRepairRequest(doc, '修复这段 genui 内容');
    expect(result).toBe('copy-failed');
  });
});

describe('状态面板：等待、验证、离屏与恢复', () => {
  it('生成中显示等待，不写 failed；稳定后可恢复卡片', () => {
    const doc = buildDoc(codeBlock(VALID_TEXT));
    const manager = createEnhancementManager(doc);
    const block = doc.querySelector<HTMLElement>('.md-code-block');
    if (!block) throw new Error('missing block');

    manager.markPending(findGenuiBlocks(doc));
    expect(block.getAttribute('data-genui-status')).toBe('pending');
    expect(block.hasAttribute(STATE_ATTR)).toBe(false);
    expect(block.hasAttribute('data-genui-reason')).toBe(false);
    expect(doc.querySelector('[data-genui-status-host]')).not.toBeNull();

    manager.markValidating(findGenuiBlocks(doc));
    expect(block.getAttribute('data-genui-status')).toBe('validating');

    expect(manager.reconcile(true)).toEqual({ mounted: 1, skipped: 0, failed: 0 });
    expect(block.getAttribute(STATE_ATTR)).toBe('mounted');
    expect(block.hasAttribute('data-genui-status')).toBe(false);
    expect(doc.querySelector('[data-genui-status-host]')).toBeNull();
  });

  it('离屏未补齐只显示 deferred，可验证后挂载', () => {
    const doc = buildDoc(codeBlock('{"type":"genui","version":2,"state":[],"derived":[],'));
    let unverifiable = true;
    const manager = createEnhancementManager(doc, {
      isBlockUnverifiable: () => unverifiable,
    });
    const block = doc.querySelector<HTMLElement>('.md-code-block');
    const pre = block?.querySelector('pre > span');
    if (!block || !pre) throw new Error('missing block');

    expect(manager.reconcile(true)).toEqual({ mounted: 0, skipped: 0, failed: 0 });
    expect(block.getAttribute('data-genui-status')).toBe('deferred');
    expect(block.hasAttribute(STATE_ATTR)).toBe(false);
    expect(doc.querySelector('.genui-card-host')).toBeNull();

    unverifiable = false;
    pre.textContent = VALID_TEXT;
    expect(manager.reconcile(true)).toEqual({ mounted: 1, skipped: 0, failed: 0 });
    expect(block.getAttribute(STATE_ATTR)).toBe('mounted');
    expect(block.hasAttribute('data-genui-status')).toBe(false);
  });

  it('永久非法格式显示 invalid 并保留原始内容，内容修复后恢复卡片', () => {
    const invalidRaw = tableDocument({ key: 'price', direction: 'asc' });
    const doc = buildDoc(codeBlock(invalidRaw));
    const manager = createEnhancementManager(doc);
    const block = doc.querySelector<HTMLElement>('.md-code-block');
    const pre = block?.querySelector('pre > span');
    if (!block || !pre) throw new Error('missing block');

    expect(manager.reconcile(true)).toEqual({ mounted: 0, skipped: 0, failed: 1 });
    expect(block.getAttribute(STATE_ATTR)).toBe('failed');
    expect(block.getAttribute(REASON_ATTR)).toBe('schema-violation');
    expect(block.getAttribute('data-genui-status')).toBe('invalid');
    expect(block.style.display).not.toBe('none');
    expect(pre.textContent).toBe(invalidRaw);
    expect(block.nextElementSibling?.getAttribute('data-genui-status-host')).toBe('');

    pre.textContent = tableDocument({ key: 'price', dir: 'asc' });
    expect(manager.reconcile(true)).toEqual({ mounted: 1, skipped: 0, failed: 0 });
    expect(block.getAttribute(STATE_ATTR)).toBe('mounted');
    expect(block.hasAttribute('data-genui-status')).toBe(false);
    expect(doc.querySelector('.genui-status-host')).toBeNull();
  });

  it('链路级缺 pre 标为页面不兼容，不提供修复按钮', () => {
    const doc = buildDoc(codeBlock(null));
    const manager = createEnhancementManager(doc);
    const block = doc.querySelector<HTMLElement>('.md-code-block');
    if (!block) throw new Error('missing block');

    expect(manager.reconcile(true)).toEqual({ mounted: 0, skipped: 0, failed: 1 });
    expect(block.getAttribute(REASON_ATTR)).toBe('missing-pre');
    expect(block.getAttribute('data-genui-status')).toBe('incompatible');
    const shadow = block.nextElementSibling?.shadowRoot;
    expect(shadow?.querySelector('[data-genui-action="repair"]')).toBeNull();
    expect(shadow?.textContent).toContain('页面暂不兼容这段界面');
  });
});

describe('appendDraftIntoInput 的草稿语义', () => {
  it('空草稿直接填入，已有内容按换行追加且保留原字节', () => {
    const doc = document.implementation.createHTMLDocument('test');
    const textarea = doc.createElement('textarea');
    textarea.name = 'search';
    doc.body.append(textarea);

    expect(appendDraftIntoInput(doc, '修复请求 A')).toBe('filled');
    expect(textarea.value).toBe('修复请求 A');
    expect(appendDraftIntoInput(doc, '修复请求 B')).toBe('appended');
    expect(textarea.value).toBe('修复请求 A\n\n修复请求 B');
  });
});
