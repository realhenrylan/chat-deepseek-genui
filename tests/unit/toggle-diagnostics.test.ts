import { afterEach, describe, expect, it } from 'vitest';
import { createToggleControl, type DiagnosticsPanelSource } from '../../src/content/toggle';

function makeSource(): DiagnosticsPanelSource & { calls: number } {
  const source = {
    calls: 0,
    summary() {
      source.calls += 1;
      return '本地诊断：共 2 次本地信号（识别 1 次、协议 1 次），明细见下方预览';
    },
    preview() {
      return '{\n  "schema": "genui-diagnostics/v1",\n  "entries": []\n}';
    },
  };
  return source;
}

function shadowOf(): ShadowRoot {
  const host = document.querySelector('[data-genui-control]');
  expect(host).not.toBeNull();
  return host!.shadowRoot!;
}

describe('本地诊断面板', () => {
  afterEach(() => {
    document
      .querySelectorAll('[data-genui-control]')
      .forEach((host) => host.remove());
    document.body.innerHTML = '';
  });

  it('新增独立按钮，打开时只显示诊断面板并渲染脱敏预览', () => {
    const source = makeSource();
    const control = createToggleControl(document, true, () => undefined, { diagnostics: source });
    const shadow = shadowOf();
    const buttons = [...shadow.querySelectorAll('button')];

    expect(buttons[3]?.textContent).toBe('本地诊断');
    expect(shadow.querySelector<HTMLElement>('.panel')?.id).toBe('genui-panel');

    buttons[3].click();

    const diagnostics = shadow.querySelector<HTMLElement>('#genui-diagnostics')!;
    const info = shadow.querySelector<HTMLElement>('#genui-panel')!;
    expect(diagnostics.hidden).toBe(false);
    expect(info.hidden).toBe(true);
    expect(buttons[3].getAttribute('aria-expanded')).toBe('true');
    expect(diagnostics.querySelector('.status')?.textContent).toContain('共 2 次本地信号');
    expect(diagnostics.querySelector('.diag-preview')?.textContent).toBe(source.preview());
    expect(source.calls).toBe(1);

    control.dispose();
    expect(document.querySelector('[data-genui-control]')).toBeNull();
  });

  it('说明面板与诊断面板互斥，Escape 关闭诊断', () => {
    const control = createToggleControl(document, true, () => undefined, {
      promptText: '测试说明',
      diagnostics: makeSource(),
    });
    const shadow = shadowOf();

    shadow.querySelectorAll('button')[1].click();
    expect(shadow.querySelector<HTMLElement>('#genui-panel')!.hidden).toBe(false);

    shadow.querySelectorAll('button')[3].click();
    expect(shadow.querySelector<HTMLElement>('#genui-panel')!.hidden).toBe(true);
    const diagnostics = shadow.querySelector<HTMLElement>('#genui-diagnostics')!;
    expect(diagnostics.hidden).toBe(false);

    diagnostics.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(diagnostics.hidden).toBe(true);

    control.dispose();
  });

  it('刷新重新读取来源；jsdom 无 Blob URL 时下载回退为提示复制', async () => {
    const source = makeSource();
    const control = createToggleControl(document, true, () => undefined, { diagnostics: source });
    const shadow = shadowOf();
    shadow.querySelectorAll('button')[3].click();

    const diagnostics = shadow.querySelector<HTMLElement>('#genui-diagnostics')!;
    const [refresh, copy, download, close] = [
      ...diagnostics.querySelectorAll('button'),
    ] as HTMLButtonElement[];

    refresh.click();
    expect(source.calls).toBe(2);
    expect(diagnostics.querySelectorAll('.status')[1]?.textContent).toBe(
      '已刷新（仅本机读取）',
    );

    const originalCreate = URL.createObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    try {
      download.click();
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: originalCreate,
      });
    }
    expect(diagnostics.querySelectorAll('.status')[1]?.textContent).toContain(
      '当前环境不支持文件下载',
    );

    copy.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(diagnostics.querySelectorAll('.status')[1]?.textContent).toMatch(/已复制|复制失败/);

    close.click();
    expect(diagnostics.hidden).toBe(true);

    control.dispose();
  });

  it('没有诊断来源时按钮与面板保持隐藏', () => {
    const control = createToggleControl(document, true, () => undefined);
    const shadow = shadowOf();
    const diagnosticsButton = [...shadow.querySelectorAll('button')].find(
      (button) => button.textContent === '本地诊断',
    );

    expect(diagnosticsButton?.hidden).toBe(true);
    expect(shadow.querySelector<HTMLElement>('#genui-diagnostics')!.hidden).toBe(true);

    control.dispose();
  });
});
