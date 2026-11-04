import { describe, expect, it } from 'vitest';
import type {
  GenuiBasis,
  GenuiSource,
  GenuiV4Document,
  ParseGenuiResult,
} from '../../src/protocol/types';
import { parseGenui } from '../../src/protocol/validate';

const SOURCE: GenuiSource = {
  id: 'stats',
  label: '统计公报',
  url: 'https://example.com/report',
  publisher: '统计局',
  publishedAt: '2026-01-02',
  retrievedAt: '2026-01-03',
  note: '示例来源，插件不访问',
};

function base(overrides: Partial<GenuiV4Document> = {}): GenuiV4Document {
  return {
    type: 'genui',
    version: 4,
    title: '依据测试',
    sources: [SOURCE],
    state: [
      {
        id: 'amount',
        label: '金额',
        kind: 'number',
        initial: 10,
        min: 0,
        max: 100,
        step: 1,
        unit: '元',
        basis: { kind: 'reference', sourceId: 'stats', asOf: '2026-01-02', validUntil: '2026-12-31' },
      },
    ],
    derived: [
      {
        id: 'double',
        label: '翻倍',
        expression: { op: 'multiply', left: { op: 'state', id: 'amount' }, right: { op: 'const', value: 2 } },
        basis: { kind: 'computed' },
      },
    ],
    elements: [
      { kind: 'slider', bind: 'amount' },
      { kind: 'value', label: '翻倍结果', source: { kind: 'derived', id: 'double' }, unit: '元', basis: { kind: 'computed' } },
      {
        kind: 'table',
        title: '明细',
        basis: { kind: 'example', note: '整体为示例' },
        columns: [
          { key: 'name', label: '项目' },
          { key: 'value', label: '金额', numeric: true, unit: '元', basis: { kind: 'estimate' } },
        ],
        rows: [{ cells: { name: '缺失项', value: null }, basis: { kind: 'unknown', note: '未提供数据' } }],
      },
      {
        kind: 'chart',
        chartType: 'bar',
        title: '来源对比',
        basis: { kind: 'computed' },
        items: [
          { label: '金额', value: { op: 'state', id: 'amount' }, basis: { kind: 'reference', sourceId: 'stats' } },
        ],
      },
    ],
    ...overrides,
  };
}

function parse(document: unknown): ParseGenuiResult {
  return parseGenui(JSON.stringify(document));
}

function expectFailure(result: ParseGenuiResult, code: string): string {
  expect(result.ok, `期望失败 ${code}，实际成功`).toBe(false);
  if (result.ok) throw new Error('期望失败');
  expect(result.code).toBe(code);
  return result.detail;
}

describe('genui v4：来源与依据', () => {
  it('接受带来源、依据、缺失单元格与图表依据的 v4 文档', () => {
    const result = parse(base());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.version).toBe(4);
      if (result.document.version === 4) {
        expect(result.document.sources?.[0]?.id).toBe('stats');
        expect(result.document.state[0]?.basis?.kind).toBe('reference');
      }
    }
  });

  it('v4 可以不声明 sources/basis，旧 v1/v2/v3 仍正常解析', () => {
    const minimal: GenuiV4Document = {
      type: 'genui',
      version: 4,
      state: [],
      derived: [],
      elements: [{ kind: 'text', value: '无依据字段' }],
    };
    expect(parse(minimal).ok).toBe(true);
    expect(parse({ type: 'genui', version: 1, elements: [{ kind: 'text', value: 'x' }] }).ok).toBe(true);
    expect(
      parse({ type: 'genui', version: 2, state: [], derived: [], elements: [{ kind: 'text', value: 'x' }] }).ok,
    ).toBe(true);
    expect(
      parse({ type: 'genui', version: 3, state: [], derived: [], elements: [{ kind: 'text', value: 'x' }] }).ok,
    ).toBe(true);
  });

  it('模型引用缺少 sourceId 或引用未声明来源时拒绝', () => {
    const missing: GenuiBasis = { kind: 'reference' };
    const doc = base();
    doc.state[0] = { ...doc.state[0], basis: missing };
    expect(expectFailure(parse(doc), 'semantic-violation')).toContain('sourceId');

    const dangling = base();
    dangling.state[0] = { ...dangling.state[0], basis: { kind: 'reference', sourceId: 'nope' } };
    expect(expectFailure(parse(dangling), 'invalid-reference')).toContain('nope');
  });

  it('derived 只能标记 computed，计算结果不得绑定来源', () => {
    const wrongKind = base();
    wrongKind.derived[0] = { ...wrongKind.derived[0], basis: { kind: 'user' } };
    expect(expectFailure(parse(wrongKind), 'semantic-violation')).toContain('计算结果');

    const withSource = base();
    withSource.derived[0] = { ...withSource.derived[0], basis: { kind: 'computed', sourceId: 'stats' } } as never;
    expect(expectFailure(parse(withSource), 'semantic-violation')).toContain('来源');
  });

  it('非法日期与超出来源上限被拒绝；非 https 链接交由界面标注', () => {
    const badDate = base();
    badDate.state[0] = {
      ...badDate.state[0],
      basis: { kind: 'reference', sourceId: 'stats', asOf: '2026-02-30' },
    };
    expect(expectFailure(parse(badDate), 'semantic-violation')).toContain('时点');

    // 非 https 不再让整份界面回退；由依据面板按纯文本标注不可靠形式。
    const http = base();
    http.sources = [{ ...SOURCE, url: 'http://example.com/report' }];
    expect(parse(http).ok).toBe(true);

    const tooLongUrl = base();
    tooLongUrl.sources = [
      { ...SOURCE, url: `https://example.com/${'a'.repeat(2048)}` },
    ];
    expect(expectFailure(parse(tooLongUrl), 'schema-violation')).toContain('sources');

    const tooMany = base();
    tooMany.sources = Array.from({ length: 21 }, (_, index) => ({
      id: `s${index}`,
      label: `来源 ${index}`,
    }));
    expect(expectFailure(parse(tooMany), 'schema-violation')).toContain('sources');
  });

  it('v3 文档不接受 v4 的 basis/sources 字段', () => {
    expect(
      expectFailure(
        parse({
          type: 'genui',
          version: 3,
          state: [],
          derived: [],
          elements: [{ kind: 'text', value: 'x', basis: { kind: 'user' } }],
        }),
        'schema-violation',
      ),
    ).toContain('basis');
  });
});
