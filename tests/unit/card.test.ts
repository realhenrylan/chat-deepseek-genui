import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenuiDocument } from '../../src/protocol/types';
import { ElementRegistry } from '../../src/render/registry';
import { mountCard, type MountedCard } from '../../src/render/mount';

/**
 * 阶段 2：Card 渲染与 Shadow DOM 样式隔离（Red → Green）。
 *
 * 覆盖：基本呈现、未知 kind 占位（防御层）、单元素异常隔离、
 * 查看原始 JSON 切换、卡片级渲染异常回滚、模型字符串不作 HTML 解释。
 */

const RAW = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"你好"}]}';

const DOC: GenuiDocument = {
  type: 'genui',
  version: 1,
  title: '预算规划',
  elements: [{ kind: 'text', value: '合计 100 元' }],
};

let mounted: MountedCard | null = null;

function mount(
  doc: GenuiDocument,
  options: { registry?: ElementRegistry; onToggleRaw?: (show: boolean) => void; onFatal?: (error: Error) => void } = {},
  rawJson = RAW,
): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mounted = mountCard(host, {
    document: doc,
    rawJson,
    ...options,
  });
  return host;
}

function shadowText(host: HTMLElement): string {
  const shadow = host.shadowRoot;
  expect(shadow).not.toBeNull();
  return shadow?.textContent ?? '';
}

/** 等待 React 把点击触发的状态更新刷入 DOM（React 19 调度在后续任务）。 */
function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.replaceChildren();
});

describe('Card 渲染（Shadow DOM 隔离）', () => {
  it('渲染标题、文本元素、说明与查看入口', () => {
    const host = mount(DOC);
    const text = shadowText(host);

    expect(host.shadowRoot?.querySelector('style')).not.toBeNull();
    expect(text).toContain('GenUI');
    expect(text).toContain('预算规划');
    expect(text).toContain('合计 100 元');
    expect(text).toContain('查看原始 JSON');
    expect(text).toContain('透明增强');
  });

  it('无 title 时不渲染标题节点', () => {
    const doc: GenuiDocument = { ...DOC, title: undefined, elements: [{ kind: 'text', value: '只有文本' }] };
    const host = mount(doc);

    expect(host.shadowRoot?.querySelector('.genui-card-title')).toBeNull();
    expect(shadowText(host)).toContain('只有文本');
  });

  it('模型输出的 HTML 字面量按纯文本呈现，不产生真实元素（不作 HTML 解释）', () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const doc: GenuiDocument = {
      type: 'genui',
      version: 1,
      elements: [{ kind: 'text', value: hostile }],
    };
    const host = mount(doc);

    expect(host.shadowRoot?.querySelector('img')).toBeNull();
    expect(host.shadowRoot?.querySelector('script')).toBeNull();
    expect(shadowText(host)).toContain(hostile);
  });

  it('注册表缺失的 kind 渲染占位而不是崩溃（防御层）', () => {
    const doc = {
      type: 'genui',
      version: 1,
      elements: [{ kind: 'chart', value: 'x' }],
    } as unknown as GenuiDocument;
    const host = mount(doc);
    const text = shadowText(host);

    expect(text).toContain('暂不支持的元素类型：chart');
    expect(text).toContain('GenUI');
    expect(text).toContain('查看原始 JSON');
  });

  it('单个元素组件抛错时由元素级边界接管，卡片其余部分存活', () => {
    const registry = ElementRegistry.withDefaults().register('text', () => {
      throw new Error('element-boom');
    });
    const host = mount(DOC, { registry });
    const text = shadowText(host);

    expect(text).toContain('该元素渲染失败');
    expect(text).toContain('GenUI');
    expect(text).toContain('查看原始 JSON');
  });

  it('点击「查看原始 JSON」回调 show=true 并切换按钮文案', async () => {
    const onToggleRaw = vi.fn();
    const host = mount(DOC, { onToggleRaw });

    const button = host.shadowRoot?.querySelector('button');
    expect(button).not.toBeNull();
    button?.click();
    await flushUi();

    expect(onToggleRaw).toHaveBeenCalledWith(true);
    expect(shadowText(host)).toContain('收起原始 JSON');

    button?.click();
    await flushUi();
    expect(onToggleRaw).toHaveBeenLastCalledWith(false);
    expect(shadowText(host)).toContain('查看原始 JSON');
  });

  it('卡片级渲染异常触发 onFatal（由挂载方恢复原始块）', async () => {
    const onFatal = vi.fn();
    const broken = { type: 'genui', version: 1, elements: null } as unknown as GenuiDocument;
    mount(broken, { onFatal });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
