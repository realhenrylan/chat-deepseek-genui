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

function buttonsOf(root: ShadowRoot): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')] as HTMLButtonElement[];
}

function buttonByText(root: ShadowRoot, text: string): HTMLButtonElement {
  const button = buttonsOf(root).find((candidate) => candidate.textContent === text);
  if (!button) throw new Error(`缺少按钮：${text}`);
  return button;
}

function modeButtonOf(root: ShadowRoot): HTMLButtonElement {
  const button = buttonsOf(root).find((candidate) => candidate.textContent?.startsWith('本轮：'));
  if (!button) throw new Error('缺少本轮模式按钮');
  return button;
}

function menuOf(root: ShadowRoot): HTMLElement {
  const menu = root.querySelector<HTMLElement>('#genui-toolbar-menu');
  if (!menu) throw new Error('缺少工具栏折叠菜单');
  return menu;
}

function menuToggleOf(root: ShadowRoot): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>('button.menu-toggle');
  if (!button) throw new Error('缺少工具菜单箭头按钮');
  return button;
}

/** 菜单内实际可显示的行项文案，用于校验三行顺序。 */
function rowsOf(root: ShadowRoot): string[] {
  return [...menuOf(root).querySelectorAll('button')]
    .filter((button) => !button.hidden)
    .map((button) => button.textContent ?? '');
}

function disposeAll(): void {
  document.querySelectorAll('[data-genui-control]').forEach((host) => host.remove());
  document.body.innerHTML = '';
}

describe('本地诊断面板', () => {
  afterEach(disposeAll);

  it('新增独立行项，打开时只显示诊断面板并渲染脱敏预览', () => {
    const source = makeSource();
    const control = createToggleControl(document, true, () => undefined, { diagnostics: source });
    const shadow = shadowOf();
    const menu = menuOf(shadow);

    expect(menu.hidden).toBe(true);
    expect(shadow.querySelector<HTMLElement>('.panel')?.id).toBe('genui-panel');

    menuToggleOf(shadow).click();
    expect(menu.hidden).toBe(false);

    const diagnosticsButton = buttonByText(shadow, '本地诊断');
    diagnosticsButton.click();

    const diagnostics = shadow.querySelector<HTMLElement>('#genui-diagnostics')!;
    const info = shadow.querySelector<HTMLElement>('#genui-panel')!;
    expect(diagnostics.hidden).toBe(false);
    expect(info.hidden).toBe(true);
    expect(diagnosticsButton.getAttribute('aria-expanded')).toBe('true');
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
    menuToggleOf(shadow).click();

    buttonByText(shadow, '查看增强说明').click();
    expect(shadow.querySelector<HTMLElement>('#genui-panel')!.hidden).toBe(false);

    buttonByText(shadow, '本地诊断').click();
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
    menuToggleOf(shadow).click();
    buttonByText(shadow, '本地诊断').click();

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

  it('没有诊断来源时行项与面板保持隐藏', () => {
    const control = createToggleControl(document, true, () => undefined);
    const shadow = shadowOf();
    const diagnosticsButton = buttonByText(shadow, '本地诊断');

    expect(diagnosticsButton.hidden).toBe(true);
    expect(shadow.querySelector<HTMLElement>('#genui-diagnostics')!.hidden).toBe(true);
    // 三行全部隐藏时没有可展开内容，箭头按钮随之隐藏。
    expect(rowsOf(shadow)).toEqual([]);
    expect(menuToggleOf(shadow).hidden).toBe(true);
    expect(menuOf(shadow).hidden).toBe(true);

    control.dispose();
  });
});

describe('工具栏折叠面板', () => {
  afterEach(disposeAll);

  const fullOptions = () => ({
    promptText: '测试说明',
    promptTexts: { tool: '工具协议', plain: '简短说明' },
    diagnostics: makeSource(),
  });

  it('默认收起：菜单隐藏，主胶囊只切换开关不展开菜单', () => {
    const changes: boolean[] = [];
    const control = createToggleControl(document, true, (enabled) => changes.push(enabled), fullOptions());
    try {
      const shadow = shadowOf();
      const menu = menuOf(shadow);
      const arrow = menuToggleOf(shadow);
      const main = shadow.querySelector('button') as HTMLButtonElement;

      // 主开关必须仍是 shadow DOM 中的第一个 button，兼容既有按位置查找的调用方。
      expect(shadow.querySelector('button')).toBe(main);
      expect(main.textContent).toBe('GenUI 已开启');
      expect(menu.hidden).toBe(true);
      expect(arrow.getAttribute('aria-expanded')).toBe('false');
      expect(arrow.getAttribute('aria-controls')).toBe('genui-toolbar-menu');
      expect(arrow.getAttribute('aria-label')).toBe('展开 GenUI 工具菜单');

      main.click();

      expect(main.textContent).toBe('GenUI 已关闭');
      expect(changes).toEqual([false]);
      expect(menu.hidden).toBe(true);
      expect(arrow.getAttribute('aria-expanded')).toBe('false');
      expect(shadow.querySelector('button')).toBe(main);

      // 箭头只控制菜单，绝不触发开关。
      arrow.click();
      expect(menu.hidden).toBe(false);
      expect(arrow.getAttribute('aria-expanded')).toBe('true');
      expect(arrow.getAttribute('aria-label')).toBe('收起 GenUI 工具菜单');
      expect(main.textContent).toBe('GenUI 已关闭');
      expect(changes).toEqual([false]);
      expect(shadow.querySelector('button')).toBe(main);
    } finally {
      control.dispose();
    }
  });

  it('展开后三行严格依次为「本轮」「查看增强说明」「本地诊断」', () => {
    const control = createToggleControl(document, true, () => undefined, fullOptions());
    try {
      const shadow = shadowOf();
      const menu = menuOf(shadow);
      const arrow = menuToggleOf(shadow);

      arrow.click();

      expect(menu.hidden).toBe(false);
      expect(arrow.getAttribute('aria-expanded')).toBe('true');
      expect(rowsOf(shadow)).toEqual(['本轮：自动适配', '查看增强说明', '本地诊断']);
      // 行项宽度撑满菜单，便于整行点击。
      const rows = [...menu.querySelectorAll('button')];
      expect(rows.map((row) => row.textContent)).toEqual(rowsOf(shadow));

      // 行内切换模式只改文案，不收起菜单。
      modeButtonOf(shadow).click();
      expect(rowsOf(shadow)[0]).toBe('本轮：明确生成工具');
      expect(menu.hidden).toBe(false);

      // 菜单展开时点击主胶囊仍只切换开关，菜单保持展开。
      (shadow.querySelector('button') as HTMLButtonElement).click();
      expect((shadow.querySelector('button') as HTMLButtonElement).textContent).toBe('GenUI 已关闭');
      expect(menu.hidden).toBe(false);
    } finally {
      control.dispose();
    }
  });

  it('再次点击箭头收起菜单并一并关闭浮层；菜单内 Escape 归还焦点', () => {
    const control = createToggleControl(document, true, () => undefined, fullOptions());
    try {
      const shadow = shadowOf();
      const menu = menuOf(shadow);
      const arrow = menuToggleOf(shadow);
      const panel = shadow.querySelector<HTMLElement>('#genui-panel')!;
      const diagnostics = shadow.querySelector<HTMLElement>('#genui-diagnostics')!;

      // 展开 → 打开说明面板 → 收起菜单时一并收起说明面板。
      arrow.click();
      buttonByText(shadow, '查看增强说明').click();
      expect(panel.hidden).toBe(false);
      expect(buttonByText(shadow, '查看增强说明').getAttribute('aria-expanded')).toBe('true');

      arrow.click();
      expect(menu.hidden).toBe(true);
      expect(panel.hidden).toBe(true);
      expect(buttonByText(shadow, '查看增强说明').getAttribute('aria-expanded')).toBe('false');
      expect(arrow.getAttribute('aria-expanded')).toBe('false');

      // 展开 → 打开诊断面板 → 收起菜单时一并收起诊断面板。
      arrow.click();
      buttonByText(shadow, '本地诊断').click();
      expect(diagnostics.hidden).toBe(false);

      arrow.click();
      expect(menu.hidden).toBe(true);
      expect(diagnostics.hidden).toBe(true);

      // 焦点在菜单内且子浮层未打开时，Escape 收起菜单并把焦点还给箭头。
      arrow.click();
      expect(menu.hidden).toBe(false);
      const row = modeButtonOf(shadow);
      row.focus();
      expect(shadow.activeElement).toBe(row);

      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(menu.hidden).toBe(true);
      expect(arrow.getAttribute('aria-expanded')).toBe('false');
      expect(shadow.activeElement).toBe(arrow);
    } finally {
      control.dispose();
    }
  });
});
