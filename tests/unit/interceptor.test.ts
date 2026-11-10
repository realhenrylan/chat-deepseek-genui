import { describe, expect, it } from 'vitest';
import {
  REQUEST_DELIVERED_EVENT,
  REQUEST_SENT_EVENT,
  readPendingRepairPrompt,
  writePendingRepairPrompt,
  type RequestDeliveredDetail,
  type RequestSentDetail,
} from '../../src/content/bridge.ts';
import {
  GENUI_PROMPT_START,
  GENUI_PROMPT_TEXT,
  GENUI_TOOL_PROMPT_TEXT,
  mergeRepairDetails,
  SHORT_REPAIR_TRIGGER_TEXT,
} from '../../src/content/prompt.ts';
import { installGenuiFetchInterceptor } from '../../src/content/interceptor.ts';

const ORIGIN = 'https://chat.deepseek.com';
const COMPLETION = '/api/v0/chat/completion';
const HISTORY = '/api/v0/chat/history_messages';

interface Call {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
  body: string | null;
}

interface Harness {
  doc: Document;
  calls: Call[];
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  events: RequestSentDetail[];
  delivered: RequestDeliveredDetail[];
}

/** 最小 Document 替身：jsdom 的 Document 是代理，无法覆盖 location。 */
function makeDoc(pathname = '/'): Document {
  const host = document.implementation.createHTMLDocument('genui-interceptor');
  const target = new EventTarget();
  return {
    documentElement: host.documentElement,
    baseURI: `${ORIGIN}/`,
    location: { pathname, search: '', origin: ORIGIN },
    dispatchEvent: (event: Event) => target.dispatchEvent(event),
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
      target.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
      target.removeEventListener(type, listener),
  } as unknown as Document;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(
  payload: unknown = { code: 0, data: { id: 'ok' } },
  status = 200,
  pathname = '/',
): Harness {
  const doc = makeDoc(pathname);
  const calls: Call[] = [];
  const events: RequestSentDetail[] = [];
  const delivered: RequestDeliveredDetail[] = [];
  doc.addEventListener(REQUEST_SENT_EVENT, (event) => {
    events.push((event as CustomEvent<RequestSentDetail>).detail);
  });
  doc.addEventListener(REQUEST_DELIVERED_EVENT, (event) => {
    delivered.push((event as CustomEvent<RequestDeliveredDetail>).detail);
  });
  const original = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body =
      typeof init?.body === 'string'
        ? init.body
        : typeof Request !== 'undefined' && input instanceof Request
          ? await input.clone().text()
          : null;
    calls.push({ input, init, body });
    return jsonResponse(payload, status);
  };
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => original(input, init);
  const target = {
    fetch,
    document: doc,
    Response,
    Headers,
    Request,
  };
  installGenuiFetchInterceptor(target);
  return { doc, calls, fetch: target.fetch, events, delivered };
}

function sentBody(call: Call): unknown {
  return call.body === null ? null : (JSON.parse(call.body) as unknown);
}

function setBridge(doc: Document, enabled: boolean, mode: 'auto' | 'tool' | 'plain'): void {
  const root = doc.documentElement;
  root.setAttribute('data-genui-enabled', enabled ? 'true' : 'false');
  root.setAttribute('data-genui-mode', mode);
  root.setAttribute('data-genui-mode-rev', '0');
}

describe('拦截器发送侧：静默注入', () => {
  it('自动模式下把协议追加到聊天生成请求的 prompt，其他字段保持不变', async () => {
    const harness = setup();
    setBridge(harness.doc, true, 'auto');

    await harness.fetch(`${ORIGIN}${COMPLETION}`, {
      method: 'POST',
      body: JSON.stringify({ prompt: '把这段话总结成三点', thinking_enabled: false }),
    });

    const body = sentBody(harness.calls[0]) as Record<string, unknown>;
    expect(body.prompt).toBe(`把这段话总结成三点\n\n${GENUI_PROMPT_TEXT}`);
    expect(body.thinking_enabled).toBe(false);
    expect(harness.events).toEqual([
      { mode: 'auto', modeRevision: 0, injected: true, repairStashId: null },
    ]);
    expect(harness.delivered).toEqual([]);
  });

  it('明确生成工具模式使用工具版协议，相对路径同样生效', async () => {
    const harness = setup();
    setBridge(harness.doc, true, 'tool');

    await harness.fetch('/api/v0/chat/edit', {
      method: 'POST',
      body: JSON.stringify({ prompt: '改一下标题' }),
    });

    const body = sentBody(harness.calls[0]) as Record<string, unknown>;
    expect(body.prompt).toBe(`改一下标题\n\n${GENUI_TOOL_PROMPT_TEXT}`);
    expect(harness.events[0]).toMatchObject({ mode: 'tool', injected: true });
  });

  it('普通回答与关闭状态都不改写请求，但仍报告本次未注入', async () => {
    const plain = setup();
    setBridge(plain.doc, true, 'plain');
    await plain.fetch(`${ORIGIN}${COMPLETION}`, {
      method: 'POST',
      body: JSON.stringify({ prompt: '原样发送' }),
    });
    expect((sentBody(plain.calls[0]) as { prompt: string }).prompt).toBe('原样发送');
    expect(plain.events[0]).toMatchObject({ mode: 'plain', injected: false });

    const off = setup();
    setBridge(off.doc, false, 'auto');
    await off.fetch(`${ORIGIN}${COMPLETION}`, {
      method: 'POST',
      body: JSON.stringify({ prompt: '原样发送' }),
    });
    expect((sentBody(off.calls[0]) as { prompt: string }).prompt).toBe('原样发送');
    expect(off.events[0]).toMatchObject({ injected: false });
  });

  it('短触发文本会合并暂存的修复详情，并在响应成功后按 id 清除', async () => {
    const harness = setup();
    setBridge(harness.doc, true, 'auto');
    const stash = writePendingRepairPrompt(harness.doc.documentElement, '错误路径：/elements/0');
    expect(stash).not.toBeNull();

    await harness.fetch(`${ORIGIN}${COMPLETION}`, {
      method: 'POST',
      body: JSON.stringify({ prompt: SHORT_REPAIR_TRIGGER_TEXT }),
    });

    const body = sentBody(harness.calls[0]) as { prompt: string };
    expect(body.prompt.startsWith(SHORT_REPAIR_TRIGGER_TEXT)).toBe(true);
    expect(body.prompt).toContain('错误路径：/elements/0');
    expect(harness.events[0].repairStashId).toBe(stash?.id ?? null);
    expect(harness.delivered).toEqual([{ repairStashId: stash?.id ?? null }]);
  });

  it('响应失败时不清除暂存，用户可重试', async () => {
    const harness = setup({ code: 1 }, 500);
    setBridge(harness.doc, true, 'auto');
    const stash = writePendingRepairPrompt(harness.doc.documentElement, '错误路径：/elements/0');

    await harness.fetch(`${ORIGIN}${COMPLETION}`, {
      method: 'POST',
      body: JSON.stringify({ prompt: SHORT_REPAIR_TRIGGER_TEXT }),
    });

    expect(harness.delivered).toEqual([]);
    expect(readPendingRepairPrompt(harness.doc.documentElement)).toBe('错误路径：/elements/0');
    expect(stash).not.toBeNull();
  });

  it('Request 对象入参同样注入并重建请求体', async () => {
    const harness = setup();
    setBridge(harness.doc, true, 'auto');
    const request = new Request(`${ORIGIN}${COMPLETION}`, {
      method: 'POST',
      body: JSON.stringify({ prompt: '继续' }),
    });

    await harness.fetch(request);

    const body = sentBody(harness.calls[0]) as { prompt: string };
    expect(body.prompt).toBe(`继续\n\n${GENUI_PROMPT_TEXT}`);
    expect(harness.calls[0].input).not.toBe(request);
    expect(harness.events[0].injected).toBe(true);
  });

  it('非聊天路径、跨源请求与非 POST 方法都不拦截', async () => {
    const harness = setup();
    setBridge(harness.doc, true, 'auto');

    await harness.fetch(`${ORIGIN}/api/v0/chat/history_messages`, { method: 'POST', body: '{}' });
    await harness.fetch('https://evil.example/api/v0/chat/completion', {
      method: 'POST',
      body: JSON.stringify({ prompt: '跨源' }),
    });
    await harness.fetch(`${ORIGIN}/api/v0/chat/completionx`, {
      method: 'POST',
      body: JSON.stringify({ prompt: '后缀' }),
    });
    await harness.fetch(`${ORIGIN}${COMPLETION}`, { method: 'GET' });

    expect(harness.calls.map((call) => call.body)).toEqual(['{}', '{"prompt":"跨源"}', '{"prompt":"后缀"}', null]);
    expect(harness.events).toEqual([]);
  });

  it('无法解析的请求体保持原样，不注入也不报错', async () => {
    const harness = setup();
    setBridge(harness.doc, true, 'auto');

    await harness.fetch(`${ORIGIN}${COMPLETION}`, { method: 'POST', body: 'not-json' });
    await harness.fetch(`${ORIGIN}${COMPLETION}`, {
      method: 'POST',
      body: JSON.stringify({ prompt: '   ' }),
    });
    await harness.fetch(`${ORIGIN}${COMPLETION}`, { method: 'POST', body: JSON.stringify({}) });

    expect(harness.calls.map((call) => call.body)).toEqual([
      'not-json',
      '{"prompt":"   "}',
      '{}',
    ]);
    expect(harness.events.every((event) => event.injected === false)).toBe(true);
  });

  it('FormData 请求体无法改写时直接放行', async () => {
    const harness = setup();
    setBridge(harness.doc, true, 'auto');
    const form = new FormData();
    form.set('prompt', '表单');

    await harness.fetch(`${ORIGIN}${COMPLETION}`, { method: 'POST', body: form });

    expect(harness.calls[0].body).toBeNull();
    expect(harness.events[0].injected).toBe(false);
  });

  it('重复安装是幂等的', () => {
    const harness = setup();
    const first = installGenuiFetchInterceptor({
      fetch: harness.fetch,
      document: harness.doc,
      Response,
      Headers,
      Request,
    });
    expect(first).toBe(false);
  });
});

describe('拦截器读取侧：历史消息按内容剥离', () => {
  const userPrompt = '把这段话总结成三点';

  it('剥离用户角色消息末尾的完整协议块，保留助手消息', async () => {
    const harness = setup({
      code: 0,
      data: {
        chat_messages: [
          { message_id: 11, role: 'user', content: `${userPrompt}\n\n${GENUI_PROMPT_TEXT}` },
          { message_id: 12, role: 'assistant', content: '好的，三点如下：' },
        ],
      },
    });

    const response = await harness.fetch(`${ORIGIN}${HISTORY}?chat_session_id=s1`, {
      method: 'GET',
    });
    const body = (await response.json()) as {
      data: { chat_messages: Array<{ content: string }> };
    };

    expect(body.data.chat_messages[0].content).toBe(userPrompt);
    expect(body.data.chat_messages[1].content).toBe('好的，三点如下：');
  });

  it('片段形式（fragments REQUEST）里的用户正文也会被清洗', async () => {
    const harness = setup({
      code: 0,
      data: {
        chat_messages: [
          {
            message_id: 21,
            role: 'assistant',
            fragments: [{ type: 'REQUEST', content: `${userPrompt}\n${GENUI_PROMPT_TEXT}` }],
          },
        ],
      },
    });

    const response = await harness.fetch(`${ORIGIN}${HISTORY}`, { method: 'GET' });
    const body = (await response.json()) as {
      data: { chat_messages: Array<{ fragments: Array<{ content: string }> }> };
    };
    expect(body.data.chat_messages[0].fragments[0].content).toBe(userPrompt);
  });

  it('用户引用首尾标记但内容不是完整协议时保留原文', async () => {
    const quoted = `请解释这段内容：\n${GENUI_PROMPT_START}\n用户自己的段落`;
    const harness = setup({
      code: 0,
      data: { chat_messages: [{ message_id: 31, role: 'user', content: quoted }] },
    });

    const response = await harness.fetch(`${ORIGIN}${HISTORY}`, { method: 'GET' });
    const body = (await response.json()) as { data: { chat_messages: Array<{ content: string }> } };
    expect(body.data.chat_messages[0].content).toBe(quoted);
  });

  it('修复详情块按校验码剥离，正文被改动时保留', async () => {
    const merged = mergeRepairDetails(SHORT_REPAIR_TRIGGER_TEXT, '错误路径：/elements/0');
    const tampered = merged.replace(/〔GenUI 修复详情校验：[0-9a-z]+〕/, '〔GenUI 修复详情校验：zzzz〕');
    const harness = setup({
      code: 0,
      data: {
        chat_messages: [
          { message_id: 41, role: 'user', content: merged },
          { message_id: 42, role: 'user', content: tampered },
        ],
      },
    });

    const response = await harness.fetch(`${ORIGIN}${HISTORY}`, { method: 'GET' });
    const body = (await response.json()) as { data: { chat_messages: Array<{ content: string }> } };
    expect(body.data.chat_messages[0].content).toBe(SHORT_REPAIR_TRIGGER_TEXT);
    expect(body.data.chat_messages[1].content).toBe(tampered);
  });

  it('没有需要清洗的内容时原样返回同一个 Response', async () => {
    const harness = setup({ code: 0, data: { chat_messages: [{ content: '普通消息' }] } });
    const response = await harness.fetch(`${ORIGIN}${HISTORY}`, { method: 'GET' });
    expect(response.status).toBe(200);
  });

  it('非历史路径不做处理', async () => {
    const harness = setup({ code: 0, data: { chat_messages: [{ role: 'user', content: GENUI_PROMPT_TEXT }] } });
    await harness.fetch(`${ORIGIN}/api/v0/chat/other`, { method: 'GET' });
    expect(harness.calls).toHaveLength(1);
  });
});
