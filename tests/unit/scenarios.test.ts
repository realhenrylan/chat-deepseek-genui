import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { parseGenui } from '../../src/protocol/validate';
import type { GenuiV3Document } from '../../src/protocol/types';
import { mountCard, type MountedCard } from '../../src/render/mount';

/**
 * 阶段 5：三个产品场景的端到端交互回归。
 *
 * 直接挂载 docs/examples 中的示例文档，模拟用户拖动/输入/切换，
 * 验证参数变化会同时更新图表、表格与条件说明，而不是各组件各算各的。
 */

const EXAMPLES_DIR = join(process.cwd(), 'docs', 'examples');

function load(name: string): GenuiV3Document {
  const result = parseGenui(readFileSync(join(EXAMPLES_DIR, name), 'utf8'));
  expect(result.ok, `${name} 应通过协议校验`).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.document as GenuiV3Document;
}

let mounted: MountedCard | null = null;

function mount(doc: GenuiV3Document): ShadowRoot {
  const host = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(host);
  mounted = mountCard(host, { document: doc, rawJson: JSON.stringify(doc) });
  expect(host.shadowRoot).not.toBeNull();
  return host.shadowRoot!;
}

function fieldByLabel(root: ShadowRoot, text: string): HTMLInputElement {
  const label = [...root.querySelectorAll('label.genui-control-label')].find((item) =>
    item.textContent?.includes(text),
  );
  expect(label, `应存在标签「${text}」`).toBeTruthy();
  const id = label!.getAttribute('for');
  const field = [...root.querySelectorAll('input, select')].find(
    (item): item is HTMLInputElement => item.id === id,
  );
  expect(field, `应存在与「${text}」关联的控件`).toBeTruthy();
  return field!;
}

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  globalThis.document.body.replaceChildren();
});

describe('产品场景：示例文档交互', () => {
  it('抛物线：a 变化时退化提示、开口方向与交点说明同步切换', async () => {
    const root = mount(load('parabola-v3.json'));
    expect(root.textContent).toContain('参数与判别式');

    // 初始 a=-1、b=0、c=1：判别式 4，开口向下且有两个交点。
    expect(root.textContent).toContain('a < 0：抛物线开口向下。');
    expect(root.textContent).toContain('抛物线与 x 轴有两个交点。');

    const a = fieldByLabel(root, '二次项系数 a');
    fireEvent.change(a, { target: { value: '0' } });
    await flushUi();
    expect(root.textContent).toContain('退化为一次函数');
    expect(root.textContent).not.toContain('开口向下');

    fireEvent.change(a, { target: { value: '2' } });
    await flushUi();
    expect(root.textContent).toContain('a > 0：抛物线开口向上。');
    expect(root.textContent).toContain('判别式小于 0：抛物线与 x 轴没有交点。');
    // 平滑系列只渲染穿过 5 个采样点的三次曲线（4 段 C 命令），不再绘制散点圆点。
    const chart = root.querySelector('.genui-line-chart');
    expect(chart?.querySelectorAll('circle')).toHaveLength(0);
    const smoothPath = chart?.querySelector('path.genui-line-path');
    expect(smoothPath).not.toBeNull();
    expect(smoothPath?.getAttribute('d')?.match(/C /g)).toHaveLength(4);
  });

  it('选购比较：预算不足时两张排名表切换为空状态，资料缺失单独标注', async () => {
    const root = mount(load('shopping-comparison-v3.json'));

    const budget = fieldByLabel(root, '预算');
    fireEvent.change(budget, { target: { value: '1000' } });
    await flushUi();

    expect(root.textContent).toContain('三款候选都超出预算');
    expect(root.textContent).toContain('没有符合预算的候选，请提高预算。');
    expect(root.textContent).toContain('资料不完整');
    expect(root.textContent).toContain('笔记本 D');
    // 两张排名表由 visibleIf 互斥，只显示当前偏好的一张，另有静态资料表。
    expect(root.querySelectorAll('table.genui-table')).toHaveLength(2);

    const priority = fieldByLabel(root, '优先考虑');
    fireEvent.change(priority, { target: { value: 'price' } });
    await flushUi();
    expect(root.textContent).toContain('价格优先（预算内）');
    expect(root.textContent).not.toContain('综合分优先（预算内）');
  });

  it('预算规划：房租增加触发超支提示，收入清零显示空输入提示', async () => {
    const root = mount(load('budget-v3.json'));
    expect(root.textContent).toContain('储蓄后仍有余量');

    const rent = fieldByLabel(root, '房租');
    fireEvent.change(rent, { target: { value: '20000' } });
    await flushUi();
    expect(root.textContent).toContain('预算超支');
    expect(root.querySelector('.genui-table')?.textContent).toContain('20000');

    const income = fieldByLabel(root, '月收入');
    fireEvent.change(income, { target: { value: '0' } });
    await flushUi();
    expect(root.textContent).toContain('尚未输入收入');
    expect(root.querySelector('.genui-chart')).not.toBeNull();
  });
});
