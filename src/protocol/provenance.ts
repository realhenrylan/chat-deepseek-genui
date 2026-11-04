/**
 * 依据（provenance）的纯函数：日期、来源链接与展示文案。
 *
 * 设计约束（Issue 8）：
 * - 插件绝不替模型发起网络请求；来源 URL 只是不可信文本，展示前做协议、
 *   凭据、主机与长度校验，不合格就明确说明而不是静默丢弃；
 * - 模型声称的来源永远不标「已验证」；界面固定显示「模型引用 · 未核验」；
 * - 缺失值与 0 不同：本模块不把缺失折算成 0，只负责描述依据；
 * - 日期仅接受 ISO 日期或带时区的日期时间，避免时区含义不明的字符串。
 */

import type { GenuiBasis, GenuiBasisKind, GenuiSource } from './types';

/** 与 JSON Schema 共用的日期 pattern；只允许 YYYY-MM-DD 或带时区的日期时间。 */
export const PROVENANCE_DATE_PATTERN =
  '^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,3})?)?(?:Z|[+-]\\d{2}:\\d{2}))?$';

/** 与 JSON Schema 共用的 URL 前缀；其余语义校验在 normalizeSourceUrl 中完成。 */
export const PROVENANCE_URL_PATTERN = '^https://';

export interface UrlCheck {
  ok: true;
  url: string;
}

export interface UrlProblem {
  ok: false;
  reason: string;
}

export type UrlCheckResult = UrlCheck | UrlProblem;

function hasSpaceOrControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * 校验 ISO 日期/日期时间，并确认日历字段真实存在（拒绝 2025-02-30）。
 * 日期时间必须带 Z 或 ±HH:MM，避免把本地时间当成可比较的绝对时点。
 */
export function isValidProvenanceDate(value: string): boolean {
  if (value.length > 40) {
    return false;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(
      value,
    );
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return false;
  }
  if (match[4] !== undefined) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = match[6] === undefined ? 0 : Number(match[6]);
    if (hour > 23 || minute > 59 || second > 59) {
      return false;
    }
    const zone = match[8];
    if (zone !== undefined && zone !== 'Z') {
      const zoneHour = Number(zone.slice(1, 3));
      const zoneMinute = Number(zone.slice(4, 6));
      if (zoneHour > 23 || zoneMinute > 59) {
        return false;
      }
    }
  }
  return Number.isFinite(Date.parse(value));
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((part) => part > 255)) {
      return true;
    }
    const [a = 0, b = 0] = octets;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return true;
    }
  }
  if (host.startsWith('[') || host.includes(':')) {
    // IPv6 或异常主机：仅允许公网可解析名称，直接拒绝字面量地址。
    return true;
  }
  return !host.includes('.');
}

/**
 * 来源 URL 只接受 https，并拒绝凭据、控制字符、私有/本地地址与超长文本。
 * 注意：这里只做展示前校验，插件不会请求该地址，也不代表资料真实存在。
 */
export function normalizeSourceUrl(raw: string): UrlCheckResult {
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, reason: '链接为空' };
  }
  if (value.length > 2048) {
    return { ok: false, reason: '链接超过 2048 字符' };
  }
  if (hasSpaceOrControl(value)) {
    return { ok: false, reason: '链接包含空白或控制字符' };
  }
  if (!value.startsWith('https://')) {
    return { ok: false, reason: '只支持 https 链接' };
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: '链接格式无法解析' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: '只支持 https 链接' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: '链接不得包含账号或密码' };
  }
  if (parsed.hostname === '' || isPrivateHost(parsed.hostname)) {
    return { ok: false, reason: '链接指向本地或私有地址' };
  }
  return { ok: true, url: value };
}

/** 本地日期（YYYY-MM-DD），用于「截至今天」与过期判断。 */
export function todayLocalDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 展示用日期：日期保留天；带时间的值保留秒与时区，不换算成无时区的本地时间。 */
export function formatProvenanceDate(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(.+))?$/.exec(value);
  if (!match) {
    return value;
  }
  const date = match[1] ?? value;
  return match[2] === undefined ? date : `${date} ${match[2]}`;
}

function hasTimePart(value: string): boolean {
  return value.includes('T');
}

/**
 * 有效期判断：日期值按本地日期比较（当天仍有效）；带时间的值按绝对时刻比较，
 * 因此同一天内已经过去的截止时间也会标记为过期。
 */
export function isBasisExpired(
  basis: GenuiBasis | undefined,
  today: string,
  now: Date = new Date(),
): boolean {
  const validUntil = basis?.validUntil;
  if (validUntil === undefined) {
    return false;
  }
  if (hasTimePart(validUntil)) {
    const instant = Date.parse(validUntil);
    return Number.isFinite(instant) && instant <= now.getTime();
  }
  return validUntil.slice(0, 10) < today;
}

export const BASIS_KIND_LABELS: Record<GenuiBasisKind, string> = {
  user: '用户提供',
  example: '示例数据',
  estimate: '估算',
  reference: '模型引用 · 未核验',
  computed: '计算结果',
  unknown: '未标注来源',
};

/** reference 必须绑定到已声明来源；其他类别不得借来源伪装成已核验。 */
export function findBasisSource(
  basis: GenuiBasis | undefined,
  sources: readonly GenuiSource[] | undefined,
): GenuiSource | undefined {
  if (basis?.kind !== 'reference' || basis.sourceId === undefined) {
    return undefined;
  }
  return sources?.find((source) => source.id === basis.sourceId);
}

export interface BasisDescription {
  label: string;
  /** 来源名称（reference 且能找到来源时）。 */
  sourceLabel?: string;
  /** 附加说明，供界面与摘要逐字复用。 */
  note?: string;
}

export function describeBasis(
  basis: GenuiBasis | undefined,
  sources: readonly GenuiSource[] | undefined,
): BasisDescription {
  const kind = basis?.kind ?? 'unknown';
  const source = findBasisSource(basis, sources);
  return {
    label: BASIS_KIND_LABELS[kind],
    ...(source === undefined ? {} : { sourceLabel: source.label }),
    ...(basis?.note === undefined ? {} : { note: basis.note }),
  };
}

/**
 * 依据问题的中文说明；没有问题时返回 undefined。
 * 这些问题必须显示，而不是把无依据的数据当成正常数据。
 */
export function basisProblem(
  basis: GenuiBasis | undefined,
  sources: readonly GenuiSource[] | undefined,
  today: string,
  now: Date = new Date(),
): string | undefined {
  const kind = basis?.kind ?? 'unknown';
  if (kind === 'reference') {
    if (basis?.sourceId === undefined) {
      return '标记为模型引用，但没有指定来源';
    }
    if (findBasisSource(basis, sources) === undefined) {
      return `引用的来源 ${basis.sourceId} 未声明`;
    }
  } else if (kind === 'computed' && basis?.sourceId !== undefined) {
    return '计算结果不能绑定来源';
  } else if (basis?.sourceId !== undefined && findBasisSource(basis, sources) === undefined) {
    return `引用的来源 ${basis.sourceId} 未声明`;
  }
  if (isBasisExpired(basis, today, now)) {
    return `依据已过期（有效期至 ${formatProvenanceDate(basis?.validUntil ?? '')}）`;
  }
  if (basis?.asOf !== undefined) {
    const asOfIsFuture = hasTimePart(basis.asOf)
      ? Date.parse(basis.asOf) > now.getTime()
      : basis.asOf.slice(0, 10) > today;
    if (asOfIsFuture) {
      return `依据时点 ${formatProvenanceDate(basis.asOf)} 晚于今天`;
    }
  }
  return undefined;
}
