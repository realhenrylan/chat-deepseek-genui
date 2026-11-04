import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { GenuiV4Document } from '../../src/protocol/types';
import { parsePlanImport, serializePlan } from '../../src/protocol/plan';
import { mountCard, type MountedCard } from '../../src/render/mount';

const DOC: GenuiV4Document = {
  type: 'genui',
  version: 4,
  title: '方案导入导出',
  sources: [{ id: 'stats', label: '统计公报', url: 'https://example.com/report' }],
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
      basis: { kind: 'reference', sourceId: 'stats', asOf: '2026-01-02' },
    },
  ],
  derived: [
    {
      id: 'remaining',
      label: '余额',
      unit: '元',
      expression: { op: 'state', id: 'budget' },
      basis: { kind: 'computed' },
    },
  ],
  elements: [
    { kind: 'slider', bind: 'budget' },
    { kind: 'number-input', bind: 'budget' },
    { kind: 'value', label: '余额', source: { kind: 'derived', id: 'remaining' }, unit: '元' },
  ],
};

let mounted: MountedCard | null = null;
let host: HTMLElement;

function mount(): ShadowRoot {
  host = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(host);
  mounted = mountCard(host, { document: DOC, rawJson: JSON.stringify(DOC) });
  return host.shadowRoot!;
}

const flush = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  host?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('方案导出与导入', () => {
  it('导出当前界面、依据与状态，生成可导入的方案', async () => {
    const blobs: Blob[] = [];
    const OriginalURL = URL;
    class StubURL extends OriginalURL {
      static override createObjectURL = (blob: Blob) => {
        blobs.push(blob);
        return 'blob:test';
      };
      static override revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', StubURL);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const shadow = mount();
    await flush();
    fireEvent.click(shadow.querySelector('.genui-plan-export')!);
    await flush();

    expect(click).toHaveBeenCalledTimes(1);
    expect(blobs).toHaveLength(1);
    expect(shadow.querySelector('.genui-plan-feedback')?.textContent).toBe(
      '方案已导出：包含界面、来源/依据与当前状态。',
    );

    const raw = await blobs[0].text();
    const parsed = parsePlanImport(raw);
    expect(parsed.ok, parsed.ok ? '' : parsed.detail).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.plan.document.version).toBe(4);
    expect(parsed.plan.state).toEqual({ budget: 100 });
    if (parsed.plan.document.version === 4) {
      expect(parsed.plan.document.sources?.[0]?.label).toBe('统计公报');
    }
  });

  it('导入方案后恢复状态、显示来源依据并可恢复原始界面', async () => {
    const shadow = mount();
    await flush();

    const exported = serializePlan(DOC, { budget: 140 }, new Date('2026-06-01T10:00:00+08:00'));
    const file = new File([exported], '上个月的方案.json', { type: 'application/json' });
    const input = shadow.querySelector<HTMLInputElement>('input.genui-plan-file')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    fireEvent.change(input);
    await flush(80);

    const card = shadow.querySelector('.genui-card')!;
    expect(card.getAttribute('data-plan-imported')).toBe('true');
    expect(shadow.querySelector('.genui-plan-feedback')?.textContent).toBe(
      '已恢复方案与当前状态；来源、依据和适用时间随方案载入。',
    );
    expect(shadow.querySelector('.genui-plan-origin')?.textContent).toContain('上个月的方案.json');
    expect(shadow.querySelector<HTMLInputElement>('input[type="range"]')?.value).toBe('140');
    expect(shadow.querySelector('.genui-provenance')?.textContent).toContain('统计公报');

    fireEvent.click(shadow.querySelector('.genui-plan-restore')!);
    await flush();
    expect(shadow.querySelector('.genui-card')?.getAttribute('data-plan-imported')).toBeNull();
    expect(shadow.querySelector<HTMLInputElement>('input[type="range"]')?.value).toBe('100');
  });

  it('拒绝不支持的方案版本并保留当前界面', async () => {
    const shadow = mount();
    await flush();

    const bad = JSON.stringify({
      type: 'genui-plan',
      formatVersion: 1,
      exportedAt: '2026-06-01T10:00:00+08:00',
      document: { type: 'genui', version: 5, state: [], derived: [], elements: [] },
      state: {},
    });
    const file = new File([bad], 'bad.json', { type: 'application/json' });
    const input = shadow.querySelector<HTMLInputElement>('input.genui-plan-file')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    fireEvent.change(input);
    await flush(80);

    expect(shadow.querySelector('.genui-plan-feedback')?.textContent).toContain('导入失败：');
    expect(shadow.querySelector('.genui-card')?.getAttribute('data-plan-imported')).toBeNull();
    expect(shadow.querySelector('.genui-value-output')?.textContent).toBe('100 元');
  });

  it('导出时记录用户修改过的输入，导入时恢复', async () => {
    const blobs: Blob[] = [];
    const OriginalURL = URL;
    class StubURL extends OriginalURL {
      static override createObjectURL = (blob: Blob) => {
        blobs.push(blob);
        return 'blob:test';
      };
      static override revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', StubURL);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const roundtrip = parsePlanImport(
      serializePlan(DOC, { budget: 100 }, new Date('2026-06-01T10:00:00+08:00'), ['budget']),
    );
    expect(roundtrip.ok).toBe(true);
    if (roundtrip.ok) expect(roundtrip.plan.editedState).toEqual(['budget']);

    const shadow = mount();
    await flush();
    fireEvent.change(shadow.querySelector<HTMLInputElement>('input[type="range"]')!, {
      target: { value: '120' },
    });
    await flush();
    expect(shadow.querySelector('.genui-edit-banner')).not.toBeNull();

    fireEvent.click(shadow.querySelector('.genui-plan-export')!);
    await flush();
    const parsed = parsePlanImport(await blobs[0].text());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.plan.state).toEqual({ budget: 120 });
    expect(parsed.plan.editedState).toEqual(['budget']);
  });

  it('存在无效输入时阻止导出与继续讨论', async () => {
    const createObjectURL = vi.fn();
    const OriginalURL = URL;
    class StubURL extends OriginalURL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', StubURL);

    const shadow = mount();
    await flush();
    const numberInput = shadow.querySelector<HTMLInputElement>('input.genui-number-input');
    expect(numberInput).not.toBeNull();
    fireEvent.change(numberInput!, { target: { value: '' } });
    await flush();
    expect(shadow.querySelector('.genui-input-error')).not.toBeNull();

    fireEvent.click(shadow.querySelector('.genui-plan-export')!);
    await flush();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(shadow.querySelector('.genui-plan-feedback')?.textContent).toBe(
      '存在未确认的输入：请先修正或恢复有效值，再导出方案。',
    );

    fireEvent.click(shadow.querySelector('.genui-card-followup')!);
    await flush();
    expect(shadow.querySelector('.genui-card-followup-feedback')?.textContent).toBe(
      '存在未确认的输入：请先修正或恢复有效值，再继续讨论。',
    );
  });
});
