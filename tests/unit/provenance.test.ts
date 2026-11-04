import { describe, expect, it } from 'vitest';
import {
  BASIS_KIND_LABELS,
  basisProblem,
  describeBasis,
  findBasisSource,
  formatProvenanceDate,
  isBasisExpired,
  isValidProvenanceDate,
  normalizeSourceUrl,
  todayLocalDate,
} from '../../src/protocol/provenance';
import type { GenuiBasis, GenuiSource } from '../../src/protocol/types';

const SOURCE: GenuiSource = {
  id: 'stats',
  label: '统计公报',
  url: 'https://example.com/report',
  publisher: '统计局',
  publishedAt: '2026-01-02',
};

describe('依据日期与来源链接', () => {
  it('接受真实日历日与带时区的 ISO 时间，拒绝不存在的日期和越界时间', () => {
    for (const value of [
      '2026-01-01',
      '2026-02-28',
      '2028-02-29',
      '2026-12-31T23:59:59Z',
      '2026-12-31T23:59:59+08:00',
    ]) {
      expect(isValidProvenanceDate(value), value).toBe(true);
    }
    for (const value of [
      '2026-02-30',
      '2026-13-01',
      '2026-00-10',
      '2027-02-29',
      '2026-01-01T24:00:00Z',
      '2026-01-01T12:60:00Z',
      '2026-1-1',
      '2026-01-01 12:00:00',
      '不是日期',
      '',
    ]) {
      expect(isValidProvenanceDate(value), value).toBe(false);
    }
  });

  it('来源只接受 https 完整链接，并拒绝凭据、控制字符与本地/私有主机', () => {
    expect(normalizeSourceUrl('https://example.com/a?b=1#c')).toEqual({
      ok: true,
      url: 'https://example.com/a?b=1#c',
    });
    for (const raw of [
      'http://example.com',
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'https://user:pass@example.com/x',
      'https://example.com/\nnext',
      'https://example.com/ x',
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://10.0.0.1/x',
      'https://192.168.1.1/x',
      'https://[::1]/x',
      `https://example.com/${'a'.repeat(2048)}`,
    ]) {
      expect(normalizeSourceUrl(raw).ok, raw).toBe(false);
    }
  });

  it('日期格式化与本地“今天”稳定为 YYYY-MM-DD', () => {
    expect(formatProvenanceDate('2026-03-04')).toBe('2026-03-04');
    expect(formatProvenanceDate('2026-03-04T10:20:30Z')).toBe('2026-03-04 10:20:30Z');
    expect(formatProvenanceDate('2026-03-04T10:20:30+08:00')).toBe(
      '2026-03-04 10:20:30+08:00',
    );
    expect(todayLocalDate(new Date(2026, 2, 4))).toBe('2026-03-04');
  });
});

describe('依据说明与问题', () => {
  const today = '2026-06-01';

  it('类别文案区分真实输入、示例与未核验引用', () => {
    expect(BASIS_KIND_LABELS.user).toBe('用户提供');
    expect(BASIS_KIND_LABELS.example).toBe('示例数据');
    expect(BASIS_KIND_LABELS.estimate).toBe('估算');
    expect(BASIS_KIND_LABELS.reference).toBe('模型引用 · 未核验');
    expect(BASIS_KIND_LABELS.computed).toBe('计算结果');
    expect(BASIS_KIND_LABELS.unknown).toBe('未标注来源');
  });

  it('解析来源与说明，但不把声明说成已核验', () => {
    const basis: GenuiBasis = { kind: 'reference', sourceId: 'stats', asOf: '2026-01-02' };
    expect(findBasisSource(basis, [SOURCE])).toBe(SOURCE);
    const description = describeBasis(basis, [SOURCE]);
    expect(description.label).toBe('模型引用 · 未核验');
    expect(description.sourceLabel).toBe('统计公报');
  });

  it('引用缺来源、悬空来源、计算结果绑来源、过期与未来时点都给出明确说明', () => {
    expect(basisProblem({ kind: 'reference' }, [], today)).toBe(
      '标记为模型引用，但没有指定来源',
    );
    expect(basisProblem({ kind: 'reference', sourceId: 'missing' }, [], today)).toBe(
      '引用的来源 missing 未声明',
    );
    expect(basisProblem({ kind: 'computed', sourceId: 'stats' }, [SOURCE], today)).toBe(
      '计算结果不能绑定来源',
    );
    expect(basisProblem({ kind: 'unknown', sourceId: 'missing' }, [SOURCE], today)).toBe(
      '引用的来源 missing 未声明',
    );
    expect(
      basisProblem(
        { kind: 'reference', sourceId: 'stats', validUntil: '2026-05-31' },
        [SOURCE],
        today,
      ),
    ).toContain('已过期');
    expect(basisProblem({ kind: 'user', asOf: '2026-06-02' }, [], today)).toContain(
      '晚于今天',
    );
    expect(
      basisProblem(
        { kind: 'reference', sourceId: 'stats', asOf: '2026-01-02', validUntil: '2026-12-31' },
        [SOURCE],
        today,
      ),
    ).toBeUndefined();
  });

  it('有效期末尾按本地日期判断，带时间的截止按绝对时刻判断', () => {
    expect(isBasisExpired({ kind: 'example', validUntil: '2026-05-31' }, today)).toBe(true);
    expect(isBasisExpired({ kind: 'example', validUntil: '2026-06-01' }, today)).toBe(false);
    const sameDay = new Date('2026-06-01T10:00:00Z');
    expect(
      isBasisExpired(
        { kind: 'example', validUntil: '2026-06-01T09:00:00Z' },
        '2026-06-01',
        sameDay,
      ),
    ).toBe(true);
    expect(
      isBasisExpired(
        { kind: 'example', validUntil: '2026-06-01T11:00:00Z' },
        '2026-06-01',
        sameDay,
      ),
    ).toBe(false);
  });
});
