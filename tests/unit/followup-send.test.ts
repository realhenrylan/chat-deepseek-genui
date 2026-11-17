import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_ENABLED_ATTR,
  REQUEST_SENT_EVENT,
} from '../../src/content/bridge';
import { createPageLifecycle, STOP_GENERATION_PATH_PREFIX } from '../../src/content/controller';
import { createSendCoordinator, requestSend } from '../../src/content/followup';
import {
  GENUI_DIRECT_SEND_NOTICED_KEY,
  GENUI_ENABLED_KEY,
  GENUI_FOLLOWUP_MODE_KEY,
  createExtensionSettingsStore,
  type ExtensionSettingsStore,
  type FollowupDeliveryMode,
} from '../../src/content/settings';
import { SEND_BUTTON_PATH_PREFIX } from '../../src/content/site-adapter';
import { createToggleControl } from '../../src/content/toggle';

function setupDom(options: {
  draft?: string;
  sendButton?: 'enabled' | 'disabled' | 'enables-on-input' | 'none';
  generating?: boolean;
  onSendClick?: (value: string, doc: Document) => void;
} = {}): {
  doc: Document;
  textarea: HTMLTextAreaElement;
  sendBtn: HTMLElement | null;
  clicks: string[];
} {
  const doc = document.implementation.createHTMLDocument('followup send test');
  const textarea = doc.createElement('textarea');
  textarea.setAttribute('name', 'search');
  textarea.value = options.draft ?? '';
  doc.body.append(textarea);

  const clicks: string[] = [];
  let sendBtn: HTMLElement | null = null;
  const btnMode = options.sendButton ?? 'enabled';

  if (btnMode !== 'none') {
    const btn = doc.createElement('div');
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', '发送');
    btn.className = 'ds-button';
    btn.innerHTML = `<svg><path d="${SEND_BUTTON_PATH_PREFIX} 10Z" /></svg>`;
    if (btnMode === 'disabled' || btnMode === 'enables-on-input') {
      btn.classList.add('ds-button--disabled');
      btn.setAttribute('aria-disabled', 'true');
    }
    if (btnMode === 'enables-on-input') {
      textarea.addEventListener('input', () => {
        if (textarea.value.length > 0) {
          btn.classList.remove('ds-button--disabled');
          btn.removeAttribute('aria-disabled');
        }
      });
    }
    btn.addEventListener('click', () => {
      clicks.push(textarea.value);
      options.onSendClick?.(textarea.value, doc);
    });
    doc.body.append(btn);
    sendBtn = btn;
  }

  if (options.generating) {
    const stop = doc.createElement('button');
    stop.setAttribute('aria-label', '停止生成');
    stop.innerHTML = `<svg><path d="${STOP_GENERATION_PATH_PREFIX} rest" /></svg>`;
    doc.body.append(stop);
  }

  return { doc, textarea, sendBtn, clicks };
}

describe('P0-a 一键回流发送链路与护栏 G1–G9', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
    document.body.innerHTML = '';
  });

  it('G1: 拒绝非信任点击（isTrusted === false），不写入也不点击发送', async () => {
    const { doc, textarea, clicks } = setupDom();
    const res = await requestSend(
      doc,
      '你好',
      { directSendNoticed: true },
      { isTrusted: false },
    );
    expect(res).toEqual({ status: 'untrusted' });
    expect(textarea.value).toBe('');
    expect(clicks).toEqual([]);
  });

  it('G2: 模型生成中拒绝发送（busy），不触碰输入框', async () => {
    const { doc, textarea, clicks } = setupDom({ generating: true });
    const res = await requestSend(
      doc,
      '继续分析',
      { directSendNoticed: true },
      { isTrusted: true },
    );
    expect(res).toEqual({ status: 'busy' });
    expect(textarea.value).toBe('');
    expect(clicks).toEqual([]);
  });

  it('G3: 输入框已有草稿（含纯空白）时不覆盖、不自动发送，只追加到草稿末尾', async () => {
    const { doc, textarea, clicks } = setupDom({ draft: '保留草稿  ' });
    const res = await requestSend(
      doc,
      '表单结论',
      { directSendNoticed: true },
      { isTrusted: true },
    );
    expect(res).toEqual({ status: 'draft-protected' });
    expect(textarea.value).toBe('保留草稿  \n\n表单结论');
    expect(clicks).toEqual([]);
  });

  it('G4: 1 秒内重复点击被防抖拦截，不会重复发送', async () => {
    let clock = 10_000;
    const { doc, textarea, clicks } = setupDom({
      onSendClick: (_, d) => {
        textarea.value = '';
        d.dispatchEvent(new CustomEvent(REQUEST_SENT_EVENT));
      },
    });
    const coordinator = createSendCoordinator(doc, {
      now: () => clock,
      isDirectSendNoticed: () => true,
    });

    const first = await coordinator.send('消息 1', { isTrusted: true });
    expect(first).toEqual({ status: 'sent' });
    expect(clicks).toEqual(['消息 1']);

    clock += 500;
    const second = await coordinator.send('消息 1', { isTrusted: true });
    expect(second).toEqual({ status: 'debounced' });
    expect(clicks).toEqual(['消息 1']);

    clock += 600;
    const third = await coordinator.send('消息 2', { isTrusted: true });
    expect(third).toEqual({ status: 'sent' });
    expect(clicks).toEqual(['消息 1', '消息 2']);
  });

  it('G9: 首次使用直接发送先提示一次，再次点击才发送，之后不再提示', async () => {
    let noticed = false;
    const noticeCalls: number[] = [];
    const { doc, textarea, clicks } = setupDom({
      onSendClick: (_, d) => {
        textarea.value = '';
        d.dispatchEvent(new CustomEvent(REQUEST_SENT_EVENT));
      },
    });
    let clock = 10_000;
    const coordinator = createSendCoordinator(doc, {
      now: () => clock,
      isDirectSendNoticed: () => noticed,
      onFirstDirectSendNotice: () => {
        noticed = true;
        noticeCalls.push(1);
      },
    });

    const first = await coordinator.send('第一条消息', { isTrusted: true });
    expect(first).toEqual({ status: 'first-time-notice' });
    expect(noticeCalls).toHaveLength(1);
    expect(clicks).toEqual([]);
    expect(textarea.value).toBe('');

    const second = await coordinator.send('第一条消息', { isTrusted: true });
    expect(second).toEqual({ status: 'sent' });
    expect(clicks).toEqual(['第一条消息']);

    clock += 1500;
    const third = await coordinator.send('第二条消息', { isTrusted: true });
    expect(third).toEqual({ status: 'sent' });
    expect(noticeCalls).toHaveLength(1);
  });

  it('G7: mode="fill" 时只填入或追加到输入框，不点击发送按钮', async () => {
    const { doc, textarea, clicks } = setupDom();
    const res = await requestSend(
      doc,
      '仅填入内容',
      { mode: 'fill', directSendNoticed: false },
      { isTrusted: true },
    );
    expect(res).toEqual({ status: 'filled' });
    expect(textarea.value).toBe('仅填入内容');
    expect(clicks).toEqual([]);
  });

  it('G8 / §5.2 降级：找不到发送按钮时填入输入框并上报 onSendButtonMissing', async () => {
    const onSendButtonMissing = vi.fn();
    const { doc, textarea } = setupDom({ sendButton: 'none' });
    const res = await requestSend(
      doc,
      '待手动发送',
      { directSendNoticed: true, onSendButtonMissing },
      { isTrusted: true },
    );
    expect(res).toEqual({ status: 'fallback-filled', reason: 'missing-send-button' });
    expect(onSendButtonMissing).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe('待手动发送');
  });

  it('G8 / §5.2 降级：发送按钮在写入后仍禁用时退回手动发送', async () => {
    const { doc, textarea, clicks } = setupDom({ sendButton: 'disabled' });
    const res = await requestSend(
      doc,
      '按钮禁用测试',
      { directSendNoticed: true },
      { isTrusted: true },
    );
    expect(res).toEqual({ status: 'fallback-filled', reason: 'send-button-disabled' });
    expect(textarea.value).toBe('按钮禁用测试');
    expect(clicks).toEqual([]);
  });

  it('输入事件使原本禁用的发送按钮解除禁用后，顺利点击并完成发送', async () => {
    const { doc, clicks } = setupDom({
      sendButton: 'enables-on-input',
      onSendClick: (_, d) => {
        d.dispatchEvent(new CustomEvent(REQUEST_SENT_EVENT));
      },
    });
    const res = await requestSend(
      doc,
      '激活并发送',
      { directSendNoticed: true },
      { isTrusted: true },
    );
    expect(res).toEqual({ status: 'sent' });
    expect(clicks).toEqual(['激活并发送']);
  });

  it('G8 / §5.2 降级：点击后超时未收到请求信号时退回手动发送，不重试不重复写入', async () => {
    const { doc, textarea, clicks } = setupDom({ sendButton: 'enabled' });
    const promise = requestSend(
      doc,
      '超时未发',
      { directSendNoticed: true, confirmTimeoutMs: 500 },
      { isTrusted: true },
    );
    await vi.advanceTimersByTimeAsync(600);
    const res = await promise;
    expect(res).toEqual({ status: 'fallback-filled', reason: 'send-timeout' });
    expect(textarea.value).toBe('超时未发');
    expect(clicks).toEqual(['超时未发']);
  });

  it('settings.ts: 正确读写与订阅回流方式和首次直接发送提示键', async () => {
    const storageData: Record<string, unknown> = {};
    const changeListeners: Array<
      (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void
    > = [];

    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          async get(key: string) {
            return { [key]: storageData[key] };
          },
          async set(items: Record<string, unknown>) {
            Object.assign(storageData, items);
          },
        },
        onChanged: {
          addListener(fn: (typeof changeListeners)[number]) {
            changeListeners.push(fn);
          },
          removeListener(fn: (typeof changeListeners)[number]) {
            const idx = changeListeners.indexOf(fn);
            if (idx >= 0) changeListeners.splice(idx, 1);
          },
        },
      },
    };

    const store = createExtensionSettingsStore()!;
    expect(store).not.toBeNull();
    expect(await store.loadFollowupMode?.()).toBeUndefined();
    expect(await store.loadDirectSendNoticed?.()).toBeUndefined();

    await store.saveFollowupMode?.('fill');
    await store.saveDirectSendNoticed?.(true);
    await store.saveGenuiEnabled(false);

    expect(storageData[GENUI_FOLLOWUP_MODE_KEY]).toBe('fill');
    expect(storageData[GENUI_DIRECT_SEND_NOTICED_KEY]).toBe(true);
    expect(storageData[GENUI_ENABLED_KEY]).toBe(false);
    expect(await store.loadFollowupMode?.()).toBe('fill');
    expect(await store.loadDirectSendNoticed?.()).toBe(true);

    const modes: FollowupDeliveryMode[] = [];
    const unsub = store.subscribeFollowupMode?.((m) => modes.push(m));
    for (const listener of changeListeners) {
      listener({ [GENUI_FOLLOWUP_MODE_KEY]: { newValue: 'send' } }, 'local');
    }
    expect(modes).toEqual(['send']);
    unsub?.();
  });

  it('toggle.ts: 工具菜单支持切换「回流方式：直接发送 / 仅填入输入框」', () => {
    const selected: FollowupDeliveryMode[] = [];
    const control = createToggleControl(document, true, () => undefined, {
      initialFollowupMode: 'send',
      onFollowupModeSelect: (mode) => selected.push(mode),
    });

    try {
      const shadow = document.querySelector('[data-genui-control]')!.shadowRoot!;
      const menuBtn = shadow.querySelector<HTMLButtonElement>('button.menu-toggle')!;
      expect(menuBtn.hidden).toBe(false);
      menuBtn.click();

      const modeToggle = [...shadow.querySelectorAll('#genui-toolbar-menu button')].find((b) =>
        b.textContent?.startsWith('回流方式：'),
      ) as HTMLButtonElement;
      expect(modeToggle.textContent).toBe('回流方式：直接发送');

      modeToggle.click();
      expect(modeToggle.textContent).toBe('回流方式：仅填入输入框');
      expect(selected).toEqual(['fill']);

      control.setFollowupMode('send');
      expect(modeToggle.textContent).toBe('回流方式：直接发送');
    } finally {
      control.dispose();
    }
  });

  it('控制器集成：表单随生成态自动禁用、草稿出现自动切回带入输入框、缺发送按钮记入诊断', async () => {
    const formJson = JSON.stringify({
      w: 'form',
      title: '选择风格',
      fields: [{ id: 'style', type: 'radio', label: '风格', options: ['写实', '动漫'], default: '动漫' }],
      submit: { label: '查找壁纸', prompt: '风格：{style}' },
    });

    const doc = document.implementation.createHTMLDocument('controller integration');
    doc.body.innerHTML =
      `<textarea name="search"></textarea>` +
      `<div class="ds-assistant-message-main-content"><div class="md-code-block"><div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div><pre><span>${formJson}</span></pre></div></div>`;

    let noticed = false;
    const store: ExtensionSettingsStore = {
      async loadGenuiEnabled() {
        return true;
      },
      async saveGenuiEnabled() {},
      subscribe: () => () => undefined,
      async loadFollowupMode() {
        return 'send';
      },
      async saveFollowupMode() {},
      async loadDirectSendNoticed() {
        return noticed;
      },
      async saveDirectSendNoticed(val) {
        noticed = val;
      },
    };

    const lifecycle = createPageLifecycle(doc, {
      store,
      window,
      debounceMs: 10,
      settleMs: 20,
      requireTrustedClick: false,
    });

    await lifecycle.start();
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();

    expect(doc.documentElement.getAttribute(BRIDGE_ENABLED_ATTR)).toBe('true');
    const host = doc.querySelector<HTMLElement>('.genui-card-host')!;
    expect(host).not.toBeNull();
    const btn = () => host.shadowRoot!.querySelector<HTMLButtonElement>('.inline-primary-btn')!;
    expect(btn().textContent).toBe('查找壁纸 →');
    expect(btn().disabled).toBe(false);

    // G2: 页面开始流式生成新回答 -> 历史消息里的表单主按钮立即禁用并提示等待
    const streamingReply = doc.createElement('div');
    streamingReply.className = 'ds-assistant-message-main-content';
    streamingReply.textContent = '新回答正在生成中…';
    const stop = doc.createElement('button');
    stop.setAttribute('aria-label', '停止生成');
    doc.body.append(streamingReply, stop);
    await vi.advanceTimersByTimeAsync(20);
    expect(btn().disabled).toBe(true);
    expect(btn().textContent).toBe('等待当前回答结束');

    // 生成结束 -> 按钮恢复
    stop.remove();
    streamingReply.remove();
    await vi.advanceTimersByTimeAsync(20);
    expect(btn().disabled).toBe(false);
    expect(btn().textContent).toBe('查找壁纸 →');

    // G3: 用户输入草稿 -> 主按钮自动变为「带入输入框」
    const textarea = doc.querySelector<HTMLTextAreaElement>('textarea[name="search"]')!;
    textarea.value = '我的草稿';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(20);
    expect(btn().textContent).toBe('查找壁纸（带入输入框）');

    // 清空草稿 -> 恢复直接发送
    textarea.value = '';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(20);
    expect(btn().textContent).toBe('查找壁纸 →');

    // G9: 首次点击 -> 触发首次提示并保存状态
    btn().click();
    await vi.advanceTimersByTimeAsync(20);
    expect(noticed).toBe(true);
    expect(host.shadowRoot!.querySelector('[role="status"]')?.textContent).toContain('点击此类按钮会直接发送消息');

    // 第 2 次点击 -> 无发送按钮降级填入输入框，且诊断记入 detection/send-button-missing
    btn().click();
    await vi.advanceTimersByTimeAsync(20);
    expect(textarea.value).toBe('风格：动漫');
    expect(host.shadowRoot!.querySelector('[role="status"]')?.textContent).toContain('未找到发送按钮');
    const diagCodes = lifecycle
      .buildDiagnostics()
      .entries.map((entry) => `${entry.category}/${entry.code}`);
    expect(diagCodes).toContain('detection/send-button-missing');

    lifecycle.dispose();
  });
});
