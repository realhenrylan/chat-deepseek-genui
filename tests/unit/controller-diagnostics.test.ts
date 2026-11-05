import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageLifecycle, STOP_GENERATION_PATH_PREFIX } from '../../src/content/controller';
import type { ExtensionSettingsStore } from '../../src/content/settings';
import type { CardStateStore } from '../../src/runtime/card-state-store';
import { DEEPSEEK_SITE_ADAPTER } from '../../src/content/site-adapter';
import { GENUI_PROMPT_TEXT } from '../../src/content/prompt';

const VALID = (value: string): string =>
  JSON.stringify({ type: 'genui', version: 1, elements: [{ kind: 'text', value }] });

function codeBlock(id: string, raw: string): string {
  return `<div class="md-code-block" id="${id}"><div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div><pre><span>${raw}</span></pre></div>`;
}

function bareCodeBlock(id: string): string {
  return `<div class="md-code-block" id="${id}"><div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div></div>`;
}

function assistant(id: string, raw: string): string {
  return `<div class="ds-assistant-message-main-content" id="${id}">${codeBlock(`${id}-block`, raw)}</div>`;
}

function buildDoc(body: string): Document {
  const doc = document.implementation.createHTMLDocument('lifecycle diagnostics test');
  doc.body.innerHTML = body;
  return doc;
}

function stopControl(): string {
  return `<div id="stop" role="button" aria-label="停止生成"><svg><path d="${STOP_GENERATION_PATH_PREFIX} rest" /></svg></div>`;
}

function makeStore(initial?: boolean): ExtensionSettingsStore {
  let stored = initial;
  return {
    async loadGenuiEnabled() {
      return stored;
    },
    async saveGenuiEnabled(enabled) {
      stored = enabled;
    },
    subscribe() {
      return () => undefined;
    },
  };
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
}

function codes(doc: ReturnType<typeof createPageLifecycle>): string[] {
  return doc
    .buildDiagnostics()
    .entries.map((entry) => `${entry.category}/${entry.code}`);
}

describe('本地诊断与页面生命周期', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  it('协议解析失败记为 protocol/invalid-json，页面计数同步', async () => {
    const doc = buildDoc(
      `<textarea name="search"></textarea>${assistant('bad', '{"type":"genui",')}`,
    );
    const lifecycle = createPageLifecycle(doc, {
      store: makeStore(),
      window,
      debounceMs: 10,
      settleMs: 20,
    });

    await lifecycle.start();
    await advance(300);

    expect(codes(lifecycle)).toContain('protocol/invalid-json');
    const snapshot = lifecycle.buildDiagnostics();
    expect(snapshot.page.failed).toBe(1);
    expect(snapshot.page.mounted).toBe(0);
    expect(snapshot.page.candidates).toBe(1);
    expect(snapshot.page.route).toBe('other');
    expect(snapshot.adapter.id).toBe('deepseek-chat');

    lifecycle.dispose();
  });

  it('缺少 pre 记为 detection/missing-pre，与其他失败分开', async () => {
    const doc = buildDoc(
      `<textarea name="search"></textarea><div class="ds-assistant-message-main-content" id="a">${bareCodeBlock('a-block')}</div>`,
    );
    const lifecycle = createPageLifecycle(doc, {
      store: makeStore(),
      window,
      debounceMs: 10,
      settleMs: 20,
    });

    await lifecycle.start();
    await advance(300);

    expect(codes(lifecycle)).toEqual(['detection/missing-pre']);
    expect(lifecycle.buildDiagnostics().page.failed).toBe(1);

    lifecycle.dispose();
  });

  it('生成中记为 waiting/streaming，且不产生协议失败', async () => {
    const doc = buildDoc(`${stopControl()}<textarea name="search"></textarea>${assistant('live', VALID('流式'))}`);
    const lifecycle = createPageLifecycle(doc, {
      store: makeStore(),
      window,
      debounceMs: 10,
      settleMs: 20,
    });

    await lifecycle.start();
    await advance(200);

    expect(codes(lifecycle)).toContain('waiting/streaming');
    expect(codes(lifecycle).some((code) => code.startsWith('protocol/'))).toBe(false);
    expect(lifecycle.buildDiagnostics().page.failed).toBe(0);

    lifecycle.dispose();
  });

  it('有 genui 标签但无回答容器时记为 detection/no-assistant-container', async () => {
    const doc = buildDoc(
      `<textarea name="search"></textarea><div id="stray" class="md-code-block"><div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div><pre>${VALID('孤立')}</pre></div>`,
    );
    const lifecycle = createPageLifecycle(doc, {
      store: makeStore(),
      window,
      debounceMs: 10,
      settleMs: 20,
    });

    await lifecycle.start();
    await advance(300);

    const snapshot = lifecycle.buildDiagnostics();
    expect(codes(lifecycle)).toContain('detection/no-assistant-container');
    expect(snapshot.page.candidates).toBe(0);
    expect(snapshot.adapter.probe.labelledBlocksOutsideContainers).toBe(1);

    lifecycle.dispose();
  });

  it('找不到确定输入框时记为 detection/no-input，而不是猜测写入', async () => {
    const doc = buildDoc(assistant('ready', VALID('就绪')));
    const lifecycle = createPageLifecycle(doc, {
      store: makeStore(),
      window,
      debounceMs: 10,
      settleMs: 20,
    });

    await lifecycle.start();
    await advance(200);
    expect(doc.querySelectorAll('.genui-card-host')).toHaveLength(1);

    lifecycle.setEnabled(false);
    lifecycle.setEnabled(true);

    expect(codes(lifecycle)).toContain('detection/no-input');
    expect(doc.querySelectorAll('textarea')).toHaveLength(0);

    lifecycle.dispose();
  });

  it('导出不含聊天正文、草稿、账号或会话，也不含自由文本字段', async () => {
    const doc = buildDoc(
      `<div data-user-id="user-secret-123">机密聊天内容</div><textarea name="search">草稿私密内容</textarea>${assistant('secret', VALID('回答内容'))}`,
    );
    const lifecycle = createPageLifecycle(doc, {
      store: makeStore(),
      window,
      debounceMs: 10,
      settleMs: 20,
    });

    await lifecycle.start();
    await advance(300);
    const json = JSON.stringify(lifecycle.buildDiagnostics(), null, 2);

    for (const secret of ['机密聊天内容', '草稿私密内容', 'user-secret-123', '回答内容']) {
      expect(json).not.toContain(secret);
    }
    expect(json).not.toContain('"detail"');
    expect(json).not.toContain('"message"');
    expect(json).not.toContain('"text"');
    for (const entry of lifecycle.buildDiagnostics().entries) {
      expect(Object.keys(entry).sort()).toEqual([
        'category',
        'code',
        'count',
        'firstAt',
        'lastAt',
      ]);
    }

    lifecycle.dispose();
  });

  it('SPA 仅切换会话路由时，复用同一代码块也会重新绑定身份并换新卡片', async () => {
    window.history.replaceState({}, '', '/a/chat/s/one');
    document.body.innerHTML = `<textarea name="search"></textarea><div data-message-id="m1" class="ds-assistant-message-main-content" id="reuse">${codeBlock('reuse-block', VALID('复用节点'))}</div>`;
    const states = new Map<string, Parameters<CardStateStore['set']>[1]>();
    const stateStore: CardStateStore = {
      get: (key) => states.get(key),
      set: (key, state) => states.set(key, state),
      delete: (key) => states.delete(key),
      clear: () => states.clear(),
      size: () => states.size,
    };
    const lifecycle = createPageLifecycle(document, {
      store: makeStore(),
      window,
      debounceMs: 10,
      settleMs: 20,
      navigationPollMs: 50,
      stateStore,
    });

    await lifecycle.start();
    await advance(200);
    const firstHost = document.querySelector('.genui-card-host');
    expect(firstHost).not.toBeNull();
    expect([...states.keys()].some((key) => key.includes('/a/chat/s/one'))).toBe(true);

    // 只改路由、不改 DOM：轮询导航键触发重扫，旧卡片必须解绑旧会话。
    window.history.replaceState({}, '', '/a/chat/s/two');
    await advance(160);

    const hosts = document.querySelectorAll('.genui-card-host');
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).not.toBe(firstHost);
    expect([...states.keys()].some((key) => key.includes('/a/chat/s/two'))).toBe(true);

    lifecycle.dispose();
  });

  it('聊天路由启动时找不到输入框会立即记录 detection/no-input', async () => {
    window.history.replaceState({}, '', '/a/chat/s/no-input');
    document.body.innerHTML = assistant('ready', VALID('就绪'));

    const lifecycle = createPageLifecycle(document, {
      store: makeStore(),
      window,
      debounceMs: 10,
      settleMs: 20,
    });

    await lifecycle.start();
    expect(codes(lifecycle)).toContain('detection/no-input');

    lifecycle.dispose();
  });

  it('多个可用输入框时记录 detection/input-ambiguous，并不写入任何一个', async () => {
    window.history.replaceState({}, '', '/a/chat/s/ambiguous');
    document.body.innerHTML = `<textarea name="search"></textarea><textarea name="search"></textarea>${assistant('ready', VALID('就绪'))}`;

    const lifecycle = createPageLifecycle(document, {
      store: makeStore(),
      window,
      debounceMs: 10,
      settleMs: 20,
    });

    await lifecycle.start();
    await advance(120);

    expect(codes(lifecycle)).toContain('detection/input-ambiguous');
    expect(DEEPSEEK_SITE_ADAPTER.probe(document).inputFound).toBe(false);
    expect(DEEPSEEK_SITE_ADAPTER.probe(document).inputCandidates).toBe(2);
    for (const textarea of document.querySelectorAll('textarea')) {
      expect(textarea.value).toBe('');
    }

    lifecycle.dispose();
  });

  it('注入的适配器同时用于草稿增强，而不是退回页面默认输入框', async () => {
    const doc = buildDoc(
      `<textarea name="search" id="real"></textarea>${assistant('ready', VALID('就绪'))}`,
    );
    const real = doc.querySelector<HTMLTextAreaElement>('#real')!;
    const custom = doc.createElement('textarea');
    custom.id = 'custom-input';
    doc.body.append(custom);
    const adapter = {
      ...DEEPSEEK_SITE_ADAPTER,
      findChatInput: () => custom,
    };

    const lifecycle = createPageLifecycle(doc, {
      store: makeStore(),
      window,
      adapter,
      debounceMs: 10,
      settleMs: 20,
    });

    await lifecycle.start();
    await advance(80);
    custom.value = '保留的草稿';
    custom.dispatchEvent(new Event('input', { bubbles: true }));
    await advance(800);

    expect(custom.value).toContain('保留的草稿');
    expect(custom.value).toContain(GENUI_PROMPT_TEXT);
    expect(real.value).toBe('');

    lifecycle.dispose();
  });
});
