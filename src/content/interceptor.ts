import {
  REQUEST_DELIVERED_EVENT,
  REQUEST_SENT_EVENT,
  readBridgeEnabled,
  readBridgeMode,
  readBridgeModeRevision,
  readPendingRepairState,
  readSessionIdFromLocation,
  type PendingRepairState,
  type RequestDeliveredDetail,
  type RequestSentDetail,
} from './bridge.ts';
import {
  appendGenuiPrompt,
  mergeRepairDetails,
  stripGenuiPrompt,
  type GenuiPromptMode,
} from './prompt.ts';

/**
 * MAIN world 网络层拦截器（document_start）。
 *
 * 只做两件事，并且任何异常都会静默回退到原生 fetch：
 * 1. 发送侧：把 GenUI 协议文本附加到聊天生成请求体的 `prompt` 字段，页面输入框与消息气泡不受影响。
 * 2. 读取侧：历史消息 JSON 进入前端状态树之前，剥离扩展追加的尾部块。
 *
 * 状态消费规则（避免旧请求影响新一轮选择）：
 * - 调用 fetch 后派发 `genui:request-sent`，携带当前模式版本号与本次是否合并了修复详情；
 *   模式切换以版本号为准，迟到的旧事件不会复位新一轮选择。
 * - 只有请求成功返回后才派发 `genui:request-delivered`，且只清除被该请求真正合并过的修复暂存。
 *
 * 历史清洗只按内容判断：协议块必须与内置完整协议逐字相等（忽略空白差异），
 * 修复详情块必须带首尾标记与匹配的校验码；不依赖消息 id、会话记录或本地索引。
 * 该文件会被单独打包为 `interceptor.js`，以 `world: "MAIN"` 注入；不得访问扩展 API。
 */

const INTERCEPTOR_FLAG = '__dsgenuiFetchInterceptor';

const CHAT_GENERATION_PATHS = ['/api/v0/chat/completion', '/api/v0/chat/edit'];

const HISTORY_PATHS = ['/api/v0/chat/history_messages'];

// DeepSeek 的历史接口把用户正文放在 `fragments[{ type: "REQUEST", content }]` 里，
// 只检查外层 `role: "USER"` 会漏掉这些片段。
const USER_ROLES = new Set(['user', 'human', 'request']);

const CHAT_GENERATION_METHOD = 'POST';
const HISTORY_METHOD = 'GET';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface InterceptorTarget {
  fetch: FetchLike;
  document: Document;
  Response: typeof Response;
  Headers: typeof Headers;
  Request?: typeof Request;
}

interface InjectedBody {
  body: string;
  mode: GenuiPromptMode;
  injected: boolean;
  repairStashId: string | null;
}

type InjectionOutcome =
  | { status: 'injected'; result: InjectedBody }
  | { status: 'unchanged' }
  | { status: 'unsupported' };

/**
 * 请求级状态快照。
 *
 * 必须在 fetch 被调用的同一同步片段内读取：页面通常在调用 fetch 之后立刻清空输入框
 * 并派发 input，控制器的草稿监听会随之清理暂存；如果等 await 之后再读，
 * 本次请求的修复详情就已经丢失。开关与模式也在此一并固定，避免等待期间
 * 用户切换模式影响已经发出的这一轮。
 */
interface RequestSnapshot {
  enabled: boolean;
  mode: GenuiPromptMode;
  modeRevision: number;
  sessionId: string | null;
  pendingRepair: PendingRepairState | null;
}

interface ResolvedBody {
  text: string;
  source: 'init' | 'request';
}

function readRequestSnapshot(doc: Document): RequestSnapshot {
  const root = doc.documentElement;
  return {
    enabled: readBridgeEnabled(root),
    mode: readBridgeMode(root),
    modeRevision: readBridgeModeRevision(root),
    sessionId: readSessionIdFromLocation(doc.location),
    pendingRepair: readPendingRepairState(root),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 解析请求 URL，并确认它与当前页面同源。
 *
 * 只处理站内请求：站外同名路径（第三方接口）即使路径相同也不会被注入或清洗。
 * 相对路径按当前文档的 baseURI 解析；无法解析时返回 null，调用方按不拦截处理。
 */
function resolveRequestUrl(input: RequestInfo | URL, doc: Document): URL | null {
  try {
    const raw =
      typeof input === 'string'
        ? input
        : typeof URL !== 'undefined' && input instanceof URL
          ? input.href
          : isRecord(input) && typeof input.url === 'string'
            ? input.url
            : null;
    if (raw === null) return null;
    const url = new URL(raw, doc.baseURI);
    if (url.protocol !== 'https:') return null;
    const pageOrigin = doc.location?.origin ?? new URL(doc.baseURI).origin;
    return url.origin === pageOrigin ? url : null;
  } catch {
    return null;
  }
}

/** 读取请求方法：`init.method` 优先，其次 `Request.method`，默认 GET。 */
function readMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  const method =
    init?.method ?? (isRequestLike(input) ? input.method : undefined) ?? HISTORY_METHOD;
  return method.toUpperCase();
}

function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** 只接受精确的聊天生成路径（不允许第三方或子路径借用同一后缀）。 */
function isChatGenerationPath(pathname: string): boolean {
  return CHAT_GENERATION_PATHS.includes(normalizePathname(pathname));
}

/** 只接受精确的历史消息路径。 */
function isHistoryPath(pathname: string): boolean {
  return HISTORY_PATHS.includes(normalizePathname(pathname));
}

function isRequestLike(input: RequestInfo | URL): input is Request {
  return isRecord(input) && typeof input.url === 'string' && typeof input.clone === 'function';
}

function readRole(record: Record<string, unknown>): string {
  const role = record.role ?? record.type ?? record.author_role;
  return typeof role === 'string' ? role.toLowerCase() : '';
}

/**
 * 递归清洗历史消息中的用户消息文本；返回是否发生修改。
 *
 * 只按内容剥离：协议块与内置完整文本逐字相符（忽略空白差异），修复详情块带
 * 匹配的校验码。用户引用首尾标记或模仿固定开头的同形文字会原样保留。
 */
function stripUserMessageValues(value: unknown): boolean {
  let changed = false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (stripUserMessageValues(item)) changed = true;
    }
    return changed;
  }
  if (!isRecord(value)) return false;
  if (USER_ROLES.has(readRole(value))) {
    for (const key of ['content', 'prompt', 'text', 'message']) {
      const text = value[key];
      if (typeof text !== 'string' || text === '') continue;
      const result = stripGenuiPrompt(text);
      if (result.stripped) {
        value[key] = result.text;
        changed = true;
      }
    }
  }
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) {
      if (stripUserMessageValues(child)) changed = true;
    }
  }
  return changed;
}

/**
 * 把扩展内容写入聊天请求体的 `prompt`。
 *
 * 只使用调用 fetch 时取得的快照：会话不匹配的修复暂存不会被合并；
 * 只有确实写入过详情时才返回 `repairStashId`，上层据此决定请求成功后要清除哪一份暂存。
 */
function injectIntoBody(body: string, snapshot: RequestSnapshot): InjectionOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { status: 'unsupported' };
  }
  if (!isRecord(parsed)) return { status: 'unsupported' };
  const prompt = parsed.prompt;
  if (typeof prompt !== 'string' || prompt.trim() === '') return { status: 'unsupported' };

  const mode = snapshot.mode;
  const pending = snapshot.pendingRepair;
  const usablePending = pending && pending.sessionId === snapshot.sessionId ? pending : null;
  const withRepair = mergeRepairDetails(prompt, usablePending?.prompt ?? null);
  const repairStashId = usablePending && withRepair !== prompt ? usablePending.id : null;

  const result =
    snapshot.enabled && mode !== 'plain'
      ? appendGenuiPrompt(withRepair, mode)
      : { value: withRepair, inserted: false };
  if (!result.inserted && repairStashId === null) return { status: 'unchanged' };

  parsed.prompt = result.value;
  return {
    status: 'injected',
    result: {
      body: JSON.stringify(parsed),
      mode,
      injected: result.inserted,
      repairStashId,
    },
  };
}

/**
 * 读取请求体文本。
 *
 * 支持 `init.body` 字符串（站点当前形式）与 `Request` 对象（`fetch(new Request(...))`）；
 * 其他形式（Blob/FormData/流）无法安全改写，返回 null 交给原请求发出。
 */
async function readRequestBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<ResolvedBody | null> {
  if (typeof init?.body === 'string') return { text: init.body, source: 'init' };
  if (init?.body !== undefined && init.body !== null) return null;
  if (!isRequestLike(input)) return null;
  const text = await input.clone().text();
  return text === '' ? null : { text, source: 'request' };
}

/** 用改写后的 body 重建 Request；失败时返回 null。 */
function rebuildRequest(
  input: Request,
  body: string,
  RequestCtor: typeof Request | undefined,
): Request | null {
  if (typeof RequestCtor !== 'function') return null;
  try {
    const rebuilt = new RequestCtor(input, { body });
    // 旧 body 的 content-length 不再适用，交给浏览器重新计算。
    rebuilt.headers.delete('content-length');
    return rebuilt;
  } catch {
    return null;
  }
}

/**
 * 历史响应清洗：只处理 JSON 用户消息，并重建 Response。
 *
 * 不等待任何本地索引，也不要求消息 id；响应里没有 GenUI 文本时原样返回。
 */
async function cleanResponse(
  response: Response,
  target: InterceptorTarget,
): Promise<Response> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return response;
  const text = await response.clone().text();
  if (!text.includes('GenUI')) return response;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return response;
  }
  if (!stripUserMessageValues(parsed)) return response;
  const headers = new target.Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new target.Response(JSON.stringify(parsed), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 安装 fetch 拦截器；对同一个 fetch 函数重复调用是幂等的。
 *
 * 返回 true 表示本次完成了安装，false 表示该 fetch 已被本拦截器包裹。
 */
export function installGenuiFetchInterceptor(target: InterceptorTarget): boolean {
  const original = target.fetch;
  if (
    typeof original !== 'function' ||
    (original as unknown as Record<string, unknown>)[INTERCEPTOR_FLAG]
  ) {
    return false;
  }
  const doc = target.document;
  const RequestCtor = target.Request ?? (typeof Request === 'function' ? Request : undefined);

  const dispatch = <TDetail>(name: string, detail: TDetail): void => {
    try {
      doc.dispatchEvent(new CustomEvent(name, { detail }));
    } catch {
      // 事件派发失败不影响聊天。
    }
  };

  const wrapped: FetchLike = async (input, init) => {
    // 先做同步判定：来源、方法、精确路径全部匹配才继续。
    const url = resolveRequestUrl(input, doc);
    if (url === null) return original(input, init);
    const method = readMethod(input, init);
    const path = url.pathname;
    const isChat = method === CHAT_GENERATION_METHOD && isChatGenerationPath(path);
    const isHistory = method === HISTORY_METHOD && isHistoryPath(path);
    if (!isChat && !isHistory) return original(input, init);

    if (isHistory) {
      const response = await original(input, init);
      try {
        return await cleanResponse(response, target);
      } catch {
        return response;
      }
    }

    // 同步快照：站点可能在 fetch 返回后立刻清空草稿并触发 input，
    // 控制器的监听会清掉暂存；必须在任何 await 之前固定本次请求要用的状态。
    const snapshot = readRequestSnapshot(doc);
    const sentMode = snapshot.mode;
    const modeRevision = snapshot.modeRevision;
    let outgoingInput: RequestInfo | URL = input;
    let outgoingInit = init;
    let injected = false;
    let repairStashId: string | null = null;

    const applyInjection = (result: InjectedBody): void => {
      injected = result.injected;
      repairStashId = result.repairStashId;
    };

    try {
      if (typeof init?.body === 'string') {
        // 字符串请求体完全同步处理：页面清空草稿之前就已合并完成。
        const outcome = injectIntoBody(init.body, snapshot);
        if (outcome.status === 'injected') {
          outgoingInit = { ...init, body: outcome.result.body };
          applyInjection(outcome.result);
        }
      } else {
        const body = await readRequestBody(input, init);
        if (body !== null) {
          const outcome = injectIntoBody(body.text, snapshot);
          if (outcome.status === 'injected') {
            if (body.source === 'init') {
              outgoingInit = { ...init, body: outcome.result.body };
            } else {
              const rebuilt = rebuildRequest(input as Request, outcome.result.body, RequestCtor);
              if (!rebuilt) throw new Error('genui interceptor: cannot rebuild request');
              outgoingInput = rebuilt;
            }
            applyInjection(outcome.result);
          }
        }
      }
    } catch {
      // 任何改写失败都退回原请求：聊天不能因为增强而中断。
      outgoingInput = input;
      outgoingInit = init;
      injected = false;
      repairStashId = null;
    }

    const detail: RequestSentDetail = {
      mode: sentMode,
      modeRevision,
      injected,
      repairStashId,
    };

    let responsePromise: Promise<Response>;
    try {
      responsePromise = original(outgoingInput, outgoingInit);
    } catch (error) {
      dispatch<RequestSentDetail>(REQUEST_SENT_EVENT, detail);
      throw error;
    }
    dispatch<RequestSentDetail>(REQUEST_SENT_EVENT, detail);

    const response = await responsePromise;
    if (response.ok && repairStashId !== null) {
      dispatch<RequestDeliveredDetail>(REQUEST_DELIVERED_EVENT, { repairStashId });
    }
    return response;
  };

  Object.defineProperty(wrapped, INTERCEPTOR_FLAG, { value: true });

  try {
    target.fetch = wrapped;
  } catch {
    return false;
  }
  return true;
}

if (typeof globalThis !== 'undefined') {
  const scope = globalThis as unknown as Partial<InterceptorTarget>;
  if (typeof scope.fetch === 'function' && scope.document) {
    installGenuiFetchInterceptor(scope as InterceptorTarget);
  }
}
