/**
 * 脱敏本地诊断（issue #9）。
 *
 * 只记录「哪一类信号发生了多少次、何时发生」，不接收自由文本：分类与代码
 * 是固定词表，页面上下文只允许数量与布尔值。因此导出内容天然不含聊天
 * 文本、草稿、账号或会话标识，也没有上传或自动导出入口。
 *
 * 记录只存在于当前标签页内存（与卡片状态同层），不写入 chrome.storage；
 * 用户打开诊断面板时预览，主动点击复制/下载才会离开页面内存。
 */

export const DIAGNOSTICS_SCHEMA = 'genui-diagnostics/v1';
/** 固定词表下条目数天然有界；上限防止未来扩展词表时导出无限增长。 */
export const DIAGNOSTIC_ENTRY_LIMIT = 40;
/** 同一信号的计数节流：持续流式/等待不会把每次扫描都记成一次事件。 */
export const DIAGNOSTIC_COUNT_COOLDOWN_MS = 5000;

export type DiagnosticCategory = 'detection' | 'waiting' | 'protocol' | 'mount';

/** 每类允许的诊断代码；新增代码必须同时扩展对应类别的词表。 */
export const DIAGNOSTIC_CODES = {
  detection: ['no-assistant-container', 'no-input', 'input-ambiguous', 'missing-pre'],
  waiting: ['streaming', 'settling', 'deferred-offscreen'],
  protocol: [
    'too-large',
    'too-deep',
    'invalid-json',
    'schema-violation',
    'unsupported-version',
    'semantic-violation',
    'invalid-reference',
    'dependency-cycle',
    'too-complex',
  ],
  mount: ['mount-failed', 'render-error'],
} as const satisfies Record<DiagnosticCategory, readonly string[]>;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[DiagnosticCategory][number];

export interface DiagnosticEntry {
  category: DiagnosticCategory;
  code: DiagnosticCode;
  /** 节流后的发生次数（同代码合并为一条）。 */
  count: number;
  /** ISO 8601 时间；只表示本地时间点，不含页面内容。 */
  firstAt: string;
  lastAt: string;
}

/** 适配层自检上下文：只允许数量/布尔值，字符串无法进入导出。 */
export type DiagnosticsProbe = Record<string, number | boolean>;

export interface DiagnosticsContext {
  extensionVersion: string;
  adapter: { id: string; version: string; probe: DiagnosticsProbe };
  page: {
    route: 'chat' | 'other';
    candidates: number;
    mounted: number;
    failed: number;
  };
}

export interface DiagnosticsSnapshot {
  schema: typeof DIAGNOSTICS_SCHEMA;
  generatedAt: string;
  extension: { version: string };
  adapter: { id: string; version: string; probe: DiagnosticsProbe };
  page: DiagnosticsContext['page'];
  entries: DiagnosticEntry[];
  /** 超过条目上限时置位；导出仍只包含保留的脱敏条目。 */
  truncated: boolean;
}

export interface DiagnosticRecorder {
  /**
   * 记录一次信号。类别与代码必须在固定词表中，否则抛错（开发期错误，
   * 也保证任意文本无法混入导出）。
   */
  record(category: DiagnosticCategory, code: DiagnosticCode, at?: number): void;
  /** 生成可预览、可下载的导出对象；不修改记录本身。 */
  snapshot(context: DiagnosticsContext, at?: number): DiagnosticsSnapshot;
  reset(): void;
  /** 当前保留的条目数。 */
  readonly size: number;
}

interface EntryState {
  category: DiagnosticCategory;
  code: DiagnosticCode;
  count: number;
  firstAt: number;
  lastAt: number;
  lastCountedAt: number;
}

function isKnownCode(category: DiagnosticCategory, code: string): boolean {
  const codes: readonly string[] | undefined = DIAGNOSTIC_CODES[category];
  return codes !== undefined && codes.includes(code);
}

function toIso(at: number): string {
  return new Date(at).toISOString();
}

/** 只复制数量/布尔值，防止调用方未来传入意外字段（例如页面文本）。 */
function sanitizeProbe(probe: DiagnosticsProbe): DiagnosticsProbe {
  const clean: DiagnosticsProbe = {};
  for (const [key, value] of Object.entries(probe)) {
    if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === 'boolean') clean[key] = value;
  }
  return clean;
}

export interface DiagnosticRecorderOptions {
  /** 计数节流窗口；测试可缩短。 */
  cooldownMs?: number;
  /** 条目上限；默认 40。 */
  limit?: number;
  /** 时钟注入；默认 Date.now。 */
  now?: () => number;
}

export function createDiagnosticRecorder(
  options: DiagnosticRecorderOptions = {},
): DiagnosticRecorder {
  const cooldownMs = options.cooldownMs ?? DIAGNOSTIC_COUNT_COOLDOWN_MS;
  const limit = options.limit ?? DIAGNOSTIC_ENTRY_LIMIT;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, EntryState>();
  let truncated = false;

  return {
    get size() {
      return entries.size;
    },

    record(category, code, at = now()) {
      if (!isKnownCode(category, code)) {
        throw new Error(`未知诊断代码: ${category}/${code}`);
      }
      const key = `${category}:${code}`;
      const existing = entries.get(key);
      if (existing) {
        existing.lastAt = at;
        if (at - existing.lastCountedAt >= cooldownMs) {
          existing.count += 1;
          existing.lastCountedAt = at;
        }
        return;
      }

      entries.set(key, {
        category,
        code,
        count: 1,
        firstAt: at,
        lastAt: at,
        lastCountedAt: at,
      });
      if (entries.size > limit) {
        truncated = true;
        // 淘汰最早出现的条目，保留最近的诊断信号。
        const oldest = [...entries.entries()].sort(
          ([, a], [, b]) => a.firstAt - b.firstAt,
        )[0];
        if (oldest) entries.delete(oldest[0]);
      }
    },

    snapshot(context, at = now()) {
      const list = [...entries.values()]
        .sort((a, b) => a.firstAt - b.firstAt)
        .map<DiagnosticEntry>((entry) => ({
          category: entry.category,
          code: entry.code,
          count: entry.count,
          firstAt: toIso(entry.firstAt),
          lastAt: toIso(entry.lastAt),
        }));

      return {
        schema: DIAGNOSTICS_SCHEMA,
        generatedAt: toIso(at),
        extension: { version: context.extensionVersion },
        adapter: {
          id: context.adapter.id,
          version: context.adapter.version,
          probe: sanitizeProbe(context.adapter.probe),
        },
        page: { ...context.page },
        entries: list,
        truncated,
      };
    },

    reset() {
      entries.clear();
      truncated = false;
    },
  };
}

const CATEGORY_LABELS: Record<DiagnosticCategory, string> = {
  detection: '识别',
  waiting: '等待',
  protocol: '协议',
  mount: '挂载',
};

const CATEGORY_ORDER: readonly DiagnosticCategory[] = [
  'detection',
  'waiting',
  'protocol',
  'mount',
];

/** 面板摘要：只展示分类计数与总次数，不含任何页面文本。 */
export function summarizeDiagnostics(snapshot: DiagnosticsSnapshot): string {
  const totals = new Map<DiagnosticCategory, number>();
  for (const entry of snapshot.entries) {
    totals.set(entry.category, (totals.get(entry.category) ?? 0) + entry.count);
  }
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return '本地诊断：尚未记录到信号（不包含聊天内容）';
  }
  const parts = CATEGORY_ORDER.filter((category) => totals.has(category)).map(
    (category) => `${CATEGORY_LABELS[category]} ${totals.get(category)} 次`,
  );
  return `本地诊断：共 ${total} 次本地信号（${parts.join('、')}），明细见下方预览`;
}
