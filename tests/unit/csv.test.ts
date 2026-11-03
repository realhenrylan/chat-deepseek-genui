import { describe, expect, it } from 'vitest';
import { buildCsv, buildTablesCsv, CSV_BOM, CSV_EOL, escapeCsvCell } from '../../src/runtime/csv';
import type { GenuiV3Document } from '../../src/protocol/types';

/**
 * issue #6：表格 CSV 导出。
 *
 * 验收重点是不可信单元格的处理：分隔符、引号、换行与公式前缀
 * （= + - @）必须被转义或加前缀，避免打开表格时被当作公式执行。
 */

function tableDoc(overrides: Partial<GenuiV3Document> = {}): GenuiV3Document {
  return {
    type: 'genui',
    version: 3,
    title: '预算规划',
    state: [{ id: 'budget', label: '预算', kind: 'number', initial: 100, min: 0, max: 1000, step: 1 }],
    derived: [
      { id: 'total', label: '合计', expression: { op: 'state', id: 'budget' } },
    ],
    elements: [
      {
        kind: 'table',
        title: '供应商',
        columns: [
          { key: 'name', label: '名称' },
          { key: 'amount', label: '金额', numeric: true, unit: '元' },
        ],
        rows: [{ cells: { name: '甲', amount: 10 } }],
      },
    ],
    ...overrides,
  };
}

describe('escapeCsvCell：不可信单元格', () => {
  it('逗号、引号与换行按 RFC 4180 引号包裹', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('他说"好"')).toBe('"他说""好"""');
    expect(escapeCsvCell('第一行\n第二行')).toBe('"第一行\n第二行"');
  });

  it('公式前缀（= + - @）加单引号，纯数字保持原样', () => {
    expect(escapeCsvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(escapeCsvCell('+1+2')).toBe("'+1+2");
    expect(escapeCsvCell('-cmd')).toBe("'-cmd");
    expect(escapeCsvCell('@import')).toBe("'@import");
    // 前导空白不影响判定：原样保留并加前缀，公式仍被中和。
    expect(escapeCsvCell('  =EVIL()')).toBe("'  =EVIL()");
    // 纯数字（含负号与科学计数）不加前缀，导出后仍可继续计算。
    expect(escapeCsvCell('-42')).toBe('-42');
    expect(escapeCsvCell('1.5e3')).toBe('1.5e3');
  });

  it('普通文本原样输出', () => {
    expect(escapeCsvCell('供应商甲')).toBe('供应商甲');
    expect(escapeCsvCell('')).toBe('');
  });
});

describe('buildCsv', () => {
  it('行内逗号、行间 CRLF，含 BOM 由导出方拼接', () => {
    expect(buildCsv([['a', 'b'], ['c', 'd']])).toBe(`a,b${CSV_EOL}c,d`);
    expect(CSV_BOM).toBe('﻿');
  });
});

describe('buildTablesCsv', () => {
  it('按文档顺序导出表格，单位并入表头，空单元格留空', () => {
    const csv = buildTablesCsv(tableDoc(), { budget: 100 });
    expect(csv).not.toBeNull();
    expect(csv!).toContain('供应商');
    expect(csv!).toContain('名称');
    expect(csv!).toContain('金额（元）');
    expect(csv!).toContain('甲,10');
    // 开头带 BOM（Excel 识别 UTF-8）；派生结果不进 CSV（表格单元格口径）。
    expect(csv!.split(CSV_EOL)[0]).toBe(`${CSV_BOM}供应商`);
  });

  it('表达式单元格按当前状态求值，求值失败输出空', () => {
    const doc = tableDoc({
      elements: [
        {
          kind: 'table',
          columns: [
            { key: 'name', label: '名称' },
            { key: 'expr', label: '计算' },
          ],
          rows: [
            { cells: { name: 'ok', expr: { op: 'add', left: { op: 'state', id: 'budget' }, right: { op: 'const', value: 5 } } } },
            { cells: { name: 'bad', expr: { op: 'state', id: 'missing' } } },
            { cells: { name: 'null', expr: null } },
          ],
        },
      ],
    });
    const csv = buildTablesCsv(doc, { budget: 100 })!;
    expect(csv).toContain('ok,105');
    expect(csv).toContain('bad,');
    expect(csv).toContain('null,');
  });

  it('行 visibleIf 过滤不可见行，失败时保留该行', () => {
    const doc = tableDoc({
      elements: [
        {
          kind: 'table',
          columns: [{ key: 'name', label: '名称' }],
          rows: [
            { cells: { name: 'always' } },
            { cells: { name: 'hidden' }, visibleIf: { op: 'num-lt', left: { op: 'state', id: 'budget' }, right: { op: 'const', value: 0 } } },
            { cells: { name: 'broken' }, visibleIf: { op: 'num-lt', left: { op: 'state', id: 'missing' }, right: { op: 'const', value: 0 } } },
          ],
        },
      ],
    });
    const csv = buildTablesCsv(doc, { budget: 100 })!;
    expect(csv).toContain('always');
    expect(csv).not.toContain('hidden');
    expect(csv).toContain('broken');
  });

  it('恶意单元格在 CSV 内被转义或加前缀', () => {
    const doc = tableDoc({
      elements: [
        {
          kind: 'table',
          columns: [{ key: 'name', label: '名称' }],
          rows: [{ cells: { name: '=HYPERLINK("http://evil")' } }],
        },
      ],
    });
    const csv = buildTablesCsv(doc, { budget: 100 })!;
    expect(csv).toContain(`'=HYPERLINK(""http://evil"")`);
  });

  it('无表格的 v3 文档与非 v3 文档返回 null', () => {
    expect(buildTablesCsv(tableDoc({ elements: [{ kind: 'text', value: '仅文本' }] }), {})).toBeNull();
    expect(buildTablesCsv({ type: 'genui', version: 2, state: [], derived: [], elements: [] }, {})).toBeNull();
  });
});
