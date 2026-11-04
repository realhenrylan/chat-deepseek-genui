import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { GenuiV3Document, GenuiV6Document } from '../../src/protocol/types';
import { mountCard, type MountedCard } from '../../src/render/mount';

/**
 * Issue 8：v4 依据界面的渲染与联动。
 *
 * 覆盖：来源与依据徽标、依据面板、来源 URL 仅作文本、假设编辑后结果同步、
 * 缺失值不等于 0、旧 v3 无依据字段时保持原样。
 */

const DOC: GenuiV6Document = {
  type: 'genui',
  version: 6,
  models: [],
  title: '带依据的月度预算',
  sources: [
    {
      id: 'stats',
      label: '统计公报',
      url: 'https://example.com/report',
      publisher: '统计局',
      publishedAt: '2026-01-02',
      note: '模型提供，插件未访问',
    },
  ],
  state: [
    {
      id: 'budget',
      label: '总预算',
      kind: 'number',
      initial: 100,
      min: 0,
      max: 200,
      step: 10,
      unit: '元',
    },
    {
      id: 'spent',
      label: '已支出',
      kind: 'number',
      initial: 40,
      min: 0,
      max: 100,
      step: 10,
      unit: '元',
    },
  ],
  derived: [
    {
      id: 'remaining',
      label: '可用余额',
      unit: '元',
      expression: {
        op: 'subtract',
        left: { op: 'state', id: 'budget' },
        right: { op: 'state', id: 'spent' },
      },
    },
  ],
  basis: {
    'state.budget': {
      kind: 'reference',
      sourceId: 'stats',
      asOf: '2026-01-02',
      validUntil: '2026-12-31',
    },
    'state.spent': { kind: 'example', note: '按常见水平示意' },
    'derived.remaining': { kind: 'computed' },
    'element.2': { kind: 'computed' },
    'element.3': { kind: 'example', note: '表格整体为示例' },
    'element.3.col.1': { kind: 'estimate' },
    'element.3.row.0': { kind: 'unknown', note: '未提供数据' },
  },
  elements: [
    { kind: 'slider', bind: 'budget' },
    { kind: 'number-input', bind: 'spent' },
    {
      kind: 'value',
      label: '可用余额',
      source: { kind: 'derived', id: 'remaining' },
      unit: '元',
    },
    {
      kind: 'table',
      title: '明细',
      columns: [
        { key: 'name', label: '项目' },
        { key: 'price', label: '价格', numeric: true, unit: '元' },
      ],
      rows: [
        {
          cells: { name: '缺失项', price: null },
        },
        { cells: { name: '已知项', price: 12 } },
      ],
    },
  ],
};

let mounted: MountedCard | null = null;

function mount(doc: GenuiV6Document | GenuiV3Document): HTMLElement {
  const host = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(host);
  mounted = mountCard(host, { document: doc, rawJson: JSON.stringify(doc) });
  return host;
}

function shadowOf(host: HTMLElement): ShadowRoot {
  const shadow = host.shadowRoot;
  expect(shadow).not.toBeNull();
  return shadow!;
}

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  globalThis.document.body.replaceChildren();
});

describe('v4 依据界面', () => {
  it('显示来源、依据徽标与未核验声明，来源只作文本', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const host = mount(DOC);
    await flushUi();
    const shadow = shadowOf(host);

    expect(shadow.querySelector('.genui-provenance')).not.toBeNull();
    expect(shadow.querySelector('.genui-provenance-title')?.textContent).toContain('依据与适用范围');
    expect(shadow.textContent).toContain('模型声明 · 插件未访问网络');
    expect(shadow.textContent).toContain('「模型引用」一律标为未核验');
    expect(shadow.querySelector('.genui-source-label')?.textContent).toBe('统计公报');
    expect(shadow.querySelector('.genui-source-url')?.textContent).toBe('https://example.com/report');
    expect(shadow.querySelector('.genui-source-trust')?.textContent).toContain('未核验');
    expect(shadow.querySelector('.genui-provenance a')).toBeNull();
    expect(shadow.querySelector('.genui-basis-reference')?.textContent).toContain('模型引用 · 未核验');
    expect(shadow.querySelector('.genui-basis-example')?.textContent).toContain('示例数据');
    expect(shadow.querySelector('.genui-basis-computed')?.textContent).toContain('计算结果');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('链接形式不可靠时明确标注，但不拒绝整份界面', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const doc: GenuiV6Document = {
      ...DOC,
      sources: [
        {
          ...DOC.sources![0],
          id: 'stats',
          label: '带凭据的链接',
          url: 'https://user:pass@example.com/report',
        },
      ],
    };
    const host = mount(doc);
    await flushUi();
    const shadow = shadowOf(host);

    expect(shadow.querySelector('.genui-provenance')).not.toBeNull();
    expect(shadow.querySelector('.genui-source-url-warning')?.textContent).toContain(
      '链接形式不可靠',
    );
    expect(shadow.querySelector('.genui-provenance a')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('修改依据面板中的假设后派生结果同步更新', async () => {
    const host = mount(DOC);
    await flushUi();
    const shadow = shadowOf(host);

    expect(shadow.querySelector('output.genui-value-output')?.textContent).toBe('60 元');

    const panelInput = shadow.querySelector<HTMLInputElement>(
      '.genui-provenance input.genui-assumption-input',
    );
    expect(panelInput).not.toBeNull();
    fireEvent.change(panelInput!, { target: { value: '120' } });
    await flushUi();

    expect(shadow.querySelector('output.genui-value-output')?.textContent).toBe('80 元');
    expect(panelInput!.value).toBe('120');
    expect(shadow.querySelector('.genui-assumption-meta')?.textContent).toContain('2026-01-02');
  });

  it('修改假设后标记用户修改，并提示静态文字可能过时', async () => {
    const doc: GenuiV6Document = {
      ...DOC,
      elements: [
        { kind: 'text', value: '初始预算为 100 元。' },
        { kind: 'note', text: '以上说明按初始值生成。', tone: 'info' },
        ...DOC.elements,
      ],
    };
    const host = mount(doc);
    await flushUi();
    const shadow = shadowOf(host);

    expect(shadow.querySelector('.genui-basis-edited')).toBeNull();
    expect(shadow.querySelector('.genui-edit-banner')).toBeNull();
    expect(shadow.querySelectorAll('.genui-static-notice')).toHaveLength(0);

    const panelInput = shadow.querySelector<HTMLInputElement>(
      '.genui-provenance input.genui-assumption-input',
    );
    fireEvent.change(panelInput!, { target: { value: '120' } });
    await flushUi();

    const edited = shadow.querySelector('.genui-basis-edited');
    expect(edited).not.toBeNull();
    expect(edited?.getAttribute('data-edited')).toBe('true');
    expect(edited?.textContent).toContain('用户修改');
    expect(edited?.textContent).toContain('原依据');
    expect(shadow.querySelector('.genui-edit-banner')?.textContent).toContain('输入已修改');
    const notices = shadow.querySelectorAll('.genui-static-notice');
    expect(notices).toHaveLength(2);
    expect(notices[0]?.textContent).toContain('静态文字按初始条件生成');
    expect(notices[1]?.textContent).toContain('静态说明按初始条件生成');
    expect(shadow.textContent).toContain('初始预算为 100 元。');
    expect(shadow.querySelector('output.genui-value-output')?.textContent).toBe('80 元');
  });

  it('表格缺失单元格显示破折号并明确说明不是 0', async () => {
    const host = mount(DOC);
    await flushUi();
    const shadow = shadowOf(host);

    const missingCell = shadow.querySelector<HTMLTableCellElement>('td[title="缺失值（不是 0）"]');
    expect(missingCell?.textContent).toBe('—');
    expect(shadow.querySelector('.genui-table-missing-note')?.textContent).toContain(
      '缺失值，不是 0',
    );
    expect(shadow.querySelector('.genui-table-basis')?.textContent).toContain('示例数据');
    expect(shadow.querySelector('.genui-table-row-bases')?.textContent).toContain('未标注来源');
    expect(shadow.textContent).not.toContain('缺失项：0');
  });

  it('旧 v3 文档不渲染依据面板或徽标', async () => {
    const v3: GenuiV3Document = {
      type: 'genui',
      version: 3,
      title: '旧版界面',
      state: [
        { id: 'amount', label: '金额', kind: 'number', initial: 10, min: 0, max: 100, step: 1 },
      ],
      derived: [],
      elements: [
        { kind: 'slider', bind: 'amount' },
        { kind: 'text', value: '保持原样' },
      ],
    };
    const host = mount(v3);
    await flushUi();
    const shadow = shadowOf(host);

    expect(shadow.querySelector('.genui-provenance')).toBeNull();
    expect(shadow.querySelector('.genui-basis')).toBeNull();
    expect(shadow.textContent).toContain('保持原样');
  });
});
