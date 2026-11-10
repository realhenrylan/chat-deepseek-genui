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
const EDIT_MESSAGE = '/api/v0/chat/edit_message';
const HISTORY = '/api/v0/chat/history_messages';
const SHARE_CONTENT = '/api/v0/share/content';

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
  Xhr: typeof XMLHttpRequest;
  createXhr: () => FakeXhr;
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

/**
 * 最小 XMLHttpRequest 替身：只实现拦截器用到的 open/send/response 接口。
 *
 * 每次 setup 都会派生子类并在子类原型上安装拦截器，避免全局原型包装串扰测试。
 */
class FakeXhr extends EventTarget {
  method: string | null = null;
  url: string | null = null;
  requestBody: Document | XMLHttpRequestBodyInit | null | undefined;
  status = 0;
  readyState = 0;
  responseType: XMLHttpRequestResponseType = '';

  private rawText = '';
  private rawJson: unknown = null;

  open(method: string, url: string | URL): void {
    this.method = method;
    this.url = String(url);
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    this.requestBody = body;
  }

  get responseText(): string {
    if (this.responseType !== '' && this.responseType !== 'text') {
      throw new DOMException('The object is in an invalid state.', 'InvalidStateError');
    }
    return this.rawText;
  }

  get response(): unknown {
    if (this.responseType === 'json') return this.readyState === 4 ? this.rawJson : null;
    return this.rawText;
  }

  complete(status: number, payload: unknown): void {
    this.status = status;
    this.readyState = 4;
    if (typeof payload === 'string') {
      this.rawText = payload;
      try {
        this.rawJson = JSON.parse(payload) as unknown;
      } catch {
        this.rawJson = null;
      }
    } else {
      this.rawJson = payload;
      this.rawText = JSON.stringify(payload);
    }
    this.dispatchEvent(new Event('loadend'));
  }
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
  class TestXhr extends FakeXhr {}
  const target = {
    fetch,
    document: doc,
    Response,
    Headers,
    Request,
    XMLHttpRequest: TestXhr as unknown as typeof XMLHttpRequest,
  };
  installGenuiFetchInterceptor(target);
  return {
    doc,
    calls,
    fetch: target.fetch,
    events,
    delivered,
    Xhr: target.XMLHttpRequest,
    createXhr: () => new TestXhr(),
  };
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

function xhrSend(
  harness: Harness,
  method: string,
  path: string,
  body?: Document | XMLHttpRequestBodyInit | null,
): FakeXhr {
  const xhr = harness.createXhr();
  xhr.open(method, `${ORIGIN}${path}`);
  xhr.send(body);
  return xhr;
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

describe('拦截器发送侧：XMLHttpRequest 静默注入', () => {
  it('XHR POST /completion 注入协议、保留其他字段并派发 request-sent', () => {
    const harness = setup();
    setBridge(harness.doc, true, 'auto');

    const xhr = xhrSend(
      harness,
      'POST',
      COMPLETION,
      JSON.stringify({ prompt: '把这段话总结成三点', thinking_enabled: false }),
    );

    expect(xhr.url).toBe(`${ORIGIN}${COMPLETION}`);
    expect(JSON.parse(xhr.requestBody as string) as unknown).toEqual({
      prompt: `把这段话总结成三点\n\n${GENUI_PROMPT_TEXT}`,
      thinking_enabled: false,
    });
    expect(harness.events).toEqual([
      { mode: 'auto', modeRevision: 0, injected: true, repairStashId: null },
    ]);
    expect(harness.delivered).toEqual([]);
  });

  it('XHR POST /edit_message 使用工具版协议，方法大小写不敏感', () => {
    const harness = setup();
    setBridge(harness.doc, true, 'tool');

    const xhr = xhrSend(harness, 'post', EDIT_MESSAGE, JSON.stringify({ prompt: '改一下标题' }));

    const body = JSON.parse(xhr.requestBody as string) as { prompt: string };
    expect(body.prompt).toBe(`改一下标题\n\n${GENUI_TOOL_PROMPT_TEXT}`);
    expect(harness.events[0]).toMatchObject({ mode: 'tool', injected: true });
  });

  it('XHR 相对路径同样按当前文档同源解析', () => {
    const harness = setup();
    setBridge(harness.doc, true, 'auto');

    const xhr = harness.createXhr();
    xhr.open('POST', COMPLETION);
    xhr.send(JSON.stringify({ prompt: '相对路径' }));

    expect((JSON.parse(xhr.requestBody as string) as { prompt: string }).prompt).toBe(
      `相对路径\n\n${GENUI_PROMPT_TEXT}`,
    );
    expect(harness.events[0].injected).toBe(true);
  });

  it('XHR 短触发文本合并暂存，2xx loadend 后才派发 request-delivered', () => {
    const harness = setup();
    setBridge(harness.doc, true, 'auto');
    const stash = writePendingRepairPrompt(harness.doc.documentElement, '错误路径：/elements/0');

    const xhr = xhrSend(harness, 'POST', COMPLETION, JSON.stringify({ prompt: SHORT_REPAIR_TRIGGER_TEXT }));

    const body = JSON.parse(xhr.requestBody as string) as { prompt: string };
    expect(body.prompt.startsWith(SHORT_REPAIR_TRIGGER_TEXT)).toBe(true);
    expect(body.prompt).toContain('错误路径：/elements/0');
    expect(harness.events[0].repairStashId).toBe(stash?.id ?? null);
    expect(harness.delivered).toEqual([]);

    xhr.complete(200, { code: 0 });
    expect(harness.delivered).toEqual([{ repairStashId: stash?.id ?? null }]);
  });

  it('XHR 响应失败时不派发 request-delivered', () => {
    const harness = setup();
    setBridge(harness.doc, true, 'auto');
    writePendingRepairPrompt(harness.doc.documentElement, '错误路径：/elements/0');

    const xhr = xhrSend(harness, 'POST', COMPLETION, JSON.stringify({ prompt: SHORT_REPAIR_TRIGGER_TEXT }));
    xhr.complete(500, { code: 1 });

    expect(harness.delivered).toEqual([]);
    expect(readPendingRepairPrompt(harness.doc.documentElement)).toBe('错误路径：/elements/0');
  });

  it('XHR 关闭增强时改写为无操作，但仍报告本次未注入', () => {
    const harness = setup();
    setBridge(harness.doc, false, 'auto');

    const xhr = xhrSend(harness, 'POST', COMPLETION, JSON.stringify({ prompt: '原样发送' }));

    expect(xhr.requestBody).toBe(JSON.stringify({ prompt: '原样发送' }));
    expect(harness.events[0]).toMatchObject({ injected: false });
  });

  it('XHR 非字符串或非 JSON 请求体直接放行', () => {
    const harness = setup();
    setBridge(harness.doc, true, 'auto');

    const form = new FormData();
    form.set('prompt', '表单');
    const formXhr = xhrSend(harness, 'POST', COMPLETION, form);
    expect(formXhr.requestBody).toBe(form);

    const invalidXhr = xhrSend(harness, 'POST', COMPLETION, 'not-json');
    expect(invalidXhr.requestBody).toBe('not-json');

    const blankXhr = xhrSend(harness, 'POST', COMPLETION, JSON.stringify({ prompt: '   ' }));
    expect(blankXhr.requestBody).toBe(JSON.stringify({ prompt: '   ' }));

    expect(harness.events.map((event) => event.injected)).toEqual([false, false, false]);
  });

  it('XHR 非聊天路径、跨源、子路径与非 POST 都不拦截', () => {
    const harness = setup();
    setBridge(harness.doc, true, 'auto');

    const historyPost = xhrSend(harness, 'POST', HISTORY, JSON.stringify({ prompt: '原样' }));
    expect(historyPost.requestBody).toBe(JSON.stringify({ prompt: '原样' }));

    const cross = harness.createXhr();
    cross.open('POST', 'https://evil.example/api/v0/chat/completion');
    cross.send(JSON.stringify({ prompt: '跨源' }));
    expect(cross.requestBody).toBe(JSON.stringify({ prompt: '跨源' }));

    const suffix = xhrSend(harness, 'POST', `${COMPLETION}x`, JSON.stringify({ prompt: '后缀' }));
    expect(suffix.requestBody).toBe(JSON.stringify({ prompt: '后缀' }));

    const get = xhrSend(harness, 'GET', COMPLETION);
    expect(get.requestBody).toBeUndefined();
    expect(harness.events).toEqual([]);
  });

  it('XHR 重复安装是幂等的，协议只追加一次', () => {
    const harness = setup();
    setBridge(harness.doc, true, 'auto');

    const installed = installGenuiFetchInterceptor({
      fetch: harness.fetch,
      document: harness.doc,
      Response,
      Headers,
      Request,
      XMLHttpRequest: harness.Xhr,
    });
    expect(installed).toBe(false);

    const xhr = xhrSend(harness, 'POST', COMPLETION, JSON.stringify({ prompt: '只追加一次' }));
    const prompt = (JSON.parse(xhr.requestBody as string) as { prompt: string }).prompt;
    expect(prompt.split(GENUI_PROMPT_START)).toHaveLength(2);
    expect(harness.events).toHaveLength(1);
  });
});

describe('拦截器读取侧：XMLHttpRequest 历史响应', () => {
  const userPrompt = '把这段话总结成三点';
  const dirty = `${userPrompt}\n\n${GENUI_PROMPT_TEXT}`;

  const historyPayload = (content: string) => ({
    code: 0,
    data: {
      chat_messages: [
        { message_id: 11, role: 'user', content },
        { message_id: 12, role: 'assistant', content: '已收到' },
      ],
    },
  });

  const sharePayload = (content: string) => ({
    code: 0,
    data: {
      messages: [{ message_id: 21, role: 'user', content }],
    },
  });

  it('默认 responseType 下，loadend 回调里的 response 与 responseText 都是清洗后的 JSON', () => {
    const harness = setup();
    const xhr = harness.createXhr();
    let text: string | null = null;
    let response: unknown = null;
    xhr.addEventListener('loadend', () => {
      text = xhr.responseText;
      response = xhr.response;
    });
    xhr.open('GET', `${ORIGIN}${HISTORY}?chat_session_id=s1`);
    xhr.send();
    xhr.complete(200, historyPayload(dirty));

    const expected = JSON.stringify(historyPayload(userPrompt));
    expect(text).toBe(expected);
    expect(response).toBe(expected);
    expect(xhr.responseText).toBe(expected);
  });

  it('responseType 为 text 时分享内容同样清洗，response 返回清洗后的文本', () => {
    const harness = setup();
    const xhr = harness.createXhr();
    xhr.open('GET', `${ORIGIN}${SHARE_CONTENT}`);
    xhr.responseType = 'text';
    let text: string | null = null;
    let response: unknown = null;
    xhr.addEventListener('loadend', () => {
      text = xhr.responseText;
      response = xhr.response;
    });
    xhr.send();
    xhr.complete(200, sharePayload(dirty));

    const expected = JSON.stringify(sharePayload(userPrompt));
    expect(text).toBe(expected);
    expect(response).toBe(expected);
  });

  it('responseType 为 json 时原地清洗原生对象', () => {
    const harness = setup();
    const xhr = harness.createXhr();
    xhr.open('GET', `${ORIGIN}${HISTORY}`);
    xhr.responseType = 'json';
    let response: unknown = null;
    xhr.addEventListener('loadend', () => {
      response = xhr.response;
    });
    xhr.send();
    xhr.complete(200, historyPayload(dirty));

    expect(response).toEqual(historyPayload(userPrompt));
    expect(() => xhr.responseText).toThrow(DOMException);
  });

  it('不含 GenUI 的历史文本原样返回', () => {
    const harness = setup();
    const xhr = harness.createXhr();
    xhr.open('GET', `${ORIGIN}${HISTORY}`);
    let text: string | null = null;
    xhr.addEventListener('loadend', () => {
      text = xhr.responseText;
    });
    xhr.send();

    const payload = historyPayload('普通消息');
    xhr.complete(200, payload);
    expect(text).toBe(JSON.stringify(payload));
  });

  it('JSON 解析失败时静默回退原生文本', () => {
    const harness = setup();
    const xhr = harness.createXhr();
    xhr.open('GET', `${ORIGIN}${HISTORY}`);
    let text: string | null = null;
    xhr.addEventListener('loadend', () => {
      text = xhr.responseText;
    });
    xhr.send();

    const raw = `{"code":0,"data":"${GENUI_PROMPT_START}`;
    xhr.complete(200, raw);
    expect(text).toBe(raw);
  });

  it('非 2xx 响应不读取也不改写', () => {
    const harness = setup();
    const xhr = harness.createXhr();
    xhr.open('GET', `${ORIGIN}${HISTORY}`);
    let text: string | null = null;
    xhr.addEventListener('loadend', () => {
      text = xhr.responseText;
    });
    xhr.send();

    const payload = historyPayload(dirty);
    xhr.complete(500, payload);
    expect(text).toBe(JSON.stringify(payload));
  });

  it('非历史路径与跨源同路径都不清洗', () => {
    const harness = setup();
    const other = harness.createXhr();
    other.open('GET', `${ORIGIN}/api/v0/chat/other`);
    let otherText: string | null = null;
    other.addEventListener('loadend', () => {
      otherText = other.responseText;
    });
    other.send();
    const otherPayload = historyPayload(dirty);
    other.complete(200, otherPayload);
    expect(otherText).toBe(JSON.stringify(otherPayload));

    const cross = harness.createXhr();
    cross.open('GET', 'https://evil.example/api/v0/chat/history_messages');
    let crossText: string | null = null;
    cross.addEventListener('loadend', () => {
      crossText = cross.responseText;
    });
    cross.send();
    const crossPayload = historyPayload(dirty);
    cross.complete(200, crossPayload);
    expect(crossText).toBe(JSON.stringify(crossPayload));
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
