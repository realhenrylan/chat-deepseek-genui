import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { GenuiDocument } from '../../src/protocol/types';
import { mountCard, type MountedCard } from '../../src/render/mount';

/**
 * issue #14：控件可读性与状态呈现。
 *
 * 只锁定结构、关联与语义，不把具体像素写进单测：
 * - 滑块顶行同时包含标签与当前值，range 独占下一行；
 * - 当前值不再作为 live region 与 aria-valuetext 重复播报；
 * - 数字输入的单位后缀与就地错误通过 aria-describedby 共存；
 * - 长标签和原生 label/htmlFor 关联在窄栏结构下不被拆散。
 */

const DOC: GenuiDocument = {
  type: 'genui',
  version: 2,
  title: '控件呈现',
  state: [
    {
      id: 'budget',
      label: '每月家庭固定生活支出预算',
      kind: 'number',
      initial: 5000,
      min: 0,
      max: 10000,
      step: 100,
      unit: '元',
    },
    { id: 'spent', label: '已支出', kind: 'number', initial: 1000, min: 0, max: 5000, step: 100, unit: '元' },
    {
      id: 'category',
      label: '主要支出类别',
      kind: 'select',
      initial: 'food',
      options: [{ label: '餐饮', value: 'food' }, { label: '交通', value: 'transport' }],
    },
  ],
  derived: [{
    id: 'remaining',
    label: '可用余额',
    unit: '元',
    expression: { op: 'subtract', left: { op: 'state', id: 'budget' }, right: { op: 'state', id: 'spent' } },
  }],
  elements: [
    { kind: 'slider', bind: 'budget' },
    { kind: 'number-input', bind: 'spent' },
    { kind: 'select', bind: 'category' },
    { kind: 'value', label: '当前类别', source: { kind: 'state', id: 'category' } },
    { kind: 'value', label: '可用余额', source: { kind: 'derived', id: 'remaining' } },
  ],
};

let mounted: MountedCard | null = null;

function mount(doc: GenuiDocument = DOC): ShadowRoot {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mounted = mountCard(host, { document: doc, rawJson: JSON.stringify(doc) });
  const root = host.shadowRoot;
  expect(root).not.toBeNull();
  return root!;
}

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function valueText(root: ShadowRoot, label: string): string | undefined {
  const row = [...root.querySelectorAll('.genui-value')].find(
    (item) => item.querySelector('.genui-value-label')?.textContent === label,
  );
  return row?.querySelector('.genui-value-output')?.textContent ?? undefined;
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.replaceChildren();
});

describe('issue #14 控件呈现', () => {
  it('滑块把标签与当前值放在顶行，range 独占下一行', () => {
    const root = mount();
    const slider = root.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider).not.toBeNull();
    const control = slider!.closest('.genui-control');
    const row = slider!.closest('.genui-slider-row');
    const head = control?.querySelector('.genui-control-head');
    const label = head?.querySelector('label.genui-control-label');
    const output = head?.querySelector('output.genui-control-current');

    expect(head).not.toBeNull();
    // #13 依赖该容器查找滑块与当前值；#14 在其内部纵向排列。
    expect(row).not.toBeNull();
    expect(row?.contains(head!)).toBe(true);
    expect(row?.contains(slider!)).toBe(true);
    expect(label?.textContent).toBe('每月家庭固定生活支出预算');
    expect(label?.getAttribute('for')).toBe(slider!.id);
    expect(output).not.toBeNull();
    expect(output?.getAttribute('for')).toBe(slider!.id);
    expect(output?.textContent).toBe('5000 元');
    expect(head?.contains(slider!)).toBe(false);
    expect(slider!.getAttribute('aria-valuetext')).toBe('5000 元');
    // 名称由真实 label 提供；当前值由 aria-valuetext 提供，output 不再作为 live region。
    expect(slider!.getAttribute('aria-label')).toBeNull();
    expect(output?.getAttribute('aria-live')).toBe('off');
    const unitHint = control?.querySelector<HTMLElement>('.genui-visually-hidden');
    expect(unitHint?.textContent).toBe('单位：元');
    expect(slider!.getAttribute('aria-describedby')).toBe(unitHint?.id);
  });

  it('数字输入的单位与错误通过 aria-describedby 共存，且错误不改变已提交值', async () => {
    const root = mount();
    const input = root.querySelector<HTMLInputElement>('input[type="number"]');
    expect(input).not.toBeNull();
    const field = input!.closest('.genui-number-field');
    const unit = field?.querySelector<HTMLElement>('.genui-number-unit');

    expect(field).not.toBeNull();
    expect(unit?.textContent).toContain('元');
    expect(input!.getAttribute('aria-describedby')).toBe(unit?.id);

    fireEvent.change(input!, { target: { value: '' } });
    await flushUi();

    const error = root.querySelector<HTMLElement>('.genui-input-error');
    expect(error?.getAttribute('role')).toBe('status');
    expect(error?.textContent).toContain('请输入有限数字');
    expect(input!.getAttribute('aria-invalid')).toBe('true');
    expect(input!.getAttribute('aria-describedby')?.split(' ')).toEqual([
      unit!.id,
      error!.id,
    ]);
    // 最后有效值继续驱动派生结果。
    expect(valueText(root, '可用余额')).toBe('4000 元');

    fireEvent.change(input!, { target: { value: '4000' } });
    await flushUi();
    expect(root.querySelector('.genui-input-error')).toBeNull();
    expect(input!.getAttribute('aria-invalid')).toBeNull();
    expect(input!.getAttribute('aria-describedby')).toBe(unit!.id);
    expect(valueText(root, '可用余额')).toBe('1000 元');
  });

  it('下拉选择保留原生 label 关联并同步值元素', async () => {
    const root = mount();
    const select = root.querySelector<HTMLSelectElement>('select.genui-select');
    const label = [...root.querySelectorAll('label.genui-control-label')].find(
      (item) => item.getAttribute('for') === select?.id,
    );
    expect(select).not.toBeNull();
    expect(label?.getAttribute('for')).toBe(select!.id);
    expect(select!.getAttribute('aria-describedby')).toBeNull();

    fireEvent.change(select!, { target: { value: 'transport' } });
    await flushUi();
    expect(select!.value).toBe('transport');
    expect(valueText(root, '当前类别')).toBe('交通');
  });

  it('输入法合成期间只回显草稿，合成结束后才显示就近错误', async () => {
    const root = mount();
    const input = root.querySelector<HTMLInputElement>('input[type="number"]');
    expect(input).not.toBeNull();

    fireEvent.compositionStart(input!);
    fireEvent.change(input!, { target: { value: '15' } });
    await flushUi();

    // 合成中的临时值可以显示，但不提交、不报错，最后有效值继续驱动结果。
    expect(input!.value).toBe('15');
    expect(root.querySelector('.genui-input-error')).toBeNull();
    expect(input!.getAttribute('aria-invalid')).toBeNull();
    expect(valueText(root, '可用余额')).toBe('4000 元');

    fireEvent.compositionEnd(input!, { data: '十五' });
    await flushUi();

    const error = root.querySelector<HTMLElement>('.genui-input-error');
    expect(error?.textContent).toContain('步长');
    expect(input!.getAttribute('aria-invalid')).toBe('true');
    expect(valueText(root, '可用余额')).toBe('4000 元');
  });

  it('超长单位仍作为数值的完整后缀，并保持输入框可访问名称', () => {
    const unit = '这是一个正好二十个字符的超长计量单位名称';
    const doc: GenuiDocument = {
      type: 'genui',
      version: 2,
      title: '超长单位',
      state: [{
        id: 'amount',
        label: '每月家庭固定生活支出预算合计',
        kind: 'number',
        initial: 1234.5,
        min: 0,
        max: 99999,
        step: 0.5,
        unit,
      }],
      derived: [],
      elements: [
        { kind: 'slider', bind: 'amount' },
        { kind: 'number-input', bind: 'amount' },
      ],
    };
    const root = mount(doc);
    const output = root.querySelector<HTMLOutputElement>('output.genui-control-current');
    const input = root.querySelector<HTMLInputElement>('input[type="number"]');
    const suffix = root.querySelector<HTMLElement>('.genui-number-unit');

    expect(output?.textContent).toBe(`1234.5 ${unit}`);
    expect(output?.querySelector('.genui-control-unit')?.textContent).toBe(` ${unit}`);
    expect(suffix?.textContent).toContain(unit);
    expect(input?.getAttribute('aria-describedby')).toBe(suffix?.id);
  });
});
