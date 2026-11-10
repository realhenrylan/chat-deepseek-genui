import { afterEach, describe, expect, it } from 'vitest';
import type { ExtensionSettingsStore } from '../../src/content/settings.ts';
import {
  BRIDGE_ENABLED_ATTR,
  BRIDGE_MODE_ATTR,
  BRIDGE_PENDING_REPAIR_ATTR,
  REQUEST_DELIVERED_EVENT,
  REQUEST_SENT_EVENT,
  readPendingRepairPrompt,
  writePendingRepairPrompt,
} from '../../src/content/bridge.ts';
import { createPageLifecycle } from '../../src/content/controller.ts';
import { GENUI_PROMPT_TEXT, SHORT_REPAIR_TRIGGER_TEXT } from '../../src/content/prompt.ts';

interface Harness {
  doc: Document;
  lifecycle: ReturnType<typeof createPageLifecycle>;
  shadow: ShadowRoot;
  saved: boolean[];
  emitStore: (enabled: boolean) => void;
  statusLine: () => string;
  modeButton: () => HTMLButtonElement;
  preview: () => string;
  draft: () => HTMLTextAreaElement;
  typeDraft: (value: string) => void;
}

const buildDoc = (): Document => {
  const doc = document.implementation.createHTMLDocument('genui-controller-augment');
  doc.body.innerHTML =
    '<textarea name="search" placeholder="给 DeepSeek 发送消息"></textarea><button id="send" type="button">发送</button>';
  return doc;
};

const makeStore = (initial: boolean): ExtensionSettingsStore => {
  const listeners = new Set<(enabled: boolean) => void>();
  return {
    async loadGenuiEnabled() {
      return initial;
    },
    async saveGenuiEnabled() {
      // 由测试 harness 记录，见 createHarness。
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const createHarness = async (initial = true): Promise<Harness> => {
  const doc = buildDoc();
  const saved: boolean[] = [];
  const store = makeStore(initial);
  const originalSave = store.saveGenuiEnabled.bind(store);
  store.saveGenuiEnabled = async (enabled: boolean) => {
    saved.push(enabled);
    await originalSave(enabled);
  };
  const listeners = new Set<(enabled: boolean) => void>();
  const lifecycle = createPageLifecycle(doc, {
    store: {
      ...store,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    window: (doc.defaultView ?? window) as Window & typeof globalThis,
    debounceMs: 10,
    settleMs: 20,
    augmentDelayMs: 30,
  });
  await lifecycle.start();

  const shadow = doc.querySelector('[data-genui-control]')?.shadowRoot;
  if (!shadow) throw new Error('浮标 shadow root 未创建');
  const statusLine = (): string => shadow.querySelector('.status')?.textContent ?? '';
  const modeButton = (): HTMLButtonElement => {
    const button = [...shadow.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.startsWith('本轮：'),
    );
    if (!button) throw new Error('缺少本轮模式按钮');
    return button;
  };
  const preview = (): string => shadow.querySelector('#genui-panel pre')?.textContent ?? '';
  const draft = (): HTMLTextAreaElement => doc.querySelector('textarea') as HTMLTextAreaElement;

  return {
    doc,
    lifecycle,
    shadow,
    saved,
    emitStore: (enabled) => {
      for (const listener of listeners) listener(enabled);
    },
    statusLine,
    modeButton,
    preview,
    draft,
    typeDraft: (value) => {
      const input = draft();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
  };
};

const sentEvent = (repairStashId: string | null): CustomEvent =>
  new CustomEvent(REQUEST_SENT_EVENT, {
    detail: { mode: 'auto', modeRevision: 1, injected: true, repairStashId },
  });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('页面生命周期：静默增强接线', () => {
  it('启动后同步桥接属性，并展示静默就绪状态', async () => {
    const harness = await createHarness();
    try {
      expect(harness.doc.documentElement.getAttribute(BRIDGE_ENABLED_ATTR)).toBe('true');
      expect(harness.doc.documentElement.getAttribute(BRIDGE_MODE_ATTR)).toBe('auto');
      expect(harness.statusLine()).toContain('静默增强已就绪');
      expect(harness.statusLine()).toContain('不占用输入框');
      expect(harness.modeButton().textContent).toBe('本轮：自动适配');
      expect(harness.preview()).toBe(GENUI_PROMPT_TEXT);
    } finally {
      harness.lifecycle.stop();
    }
  });

  it('输入草稿保持原文，不会追加协议文本', async () => {
    const harness = await createHarness();
    try {
      harness.typeDraft('保留的本地草稿');
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(harness.draft().value).toBe('保留的本地草稿');
      expect(harness.preview()).not.toContain('保留的本地草稿');
    } finally {
      harness.lifecycle.stop();
    }
  });

  it('本轮模式按钮循环切换并写入桥接属性', async () => {
    const harness = await createHarness();
    try {
      harness.modeButton().click();
      expect(harness.doc.documentElement.getAttribute(BRIDGE_MODE_ATTR)).toBe('tool');
      expect(harness.modeButton().textContent).toBe('本轮：明确生成工具');

      harness.modeButton().click();
      expect(harness.doc.documentElement.getAttribute(BRIDGE_MODE_ATTR)).toBe('plain');
      expect(harness.modeButton().textContent).toBe('本轮：普通回答');
      expect(harness.statusLine()).toContain('普通回答');
      expect(harness.statusLine()).toContain('不会附加增强协议');

      harness.modeButton().click();
      expect(harness.doc.documentElement.getAttribute(BRIDGE_MODE_ATTR)).toBe('auto');
      expect(harness.modeButton().textContent).toBe('本轮：自动适配');
      expect(harness.statusLine()).toContain('静默增强已就绪');
    } finally {
      harness.lifecycle.stop();
    }
  });

  it('关闭开关后状态为 disabled，并持久化设置', async () => {
    const harness = await createHarness();
    try {
      const toggle = harness.shadow.querySelector('button') as HTMLButtonElement;
      toggle.click();
      expect(harness.doc.documentElement.getAttribute(BRIDGE_ENABLED_ATTR)).toBe('false');
      expect(harness.statusLine()).toContain('增强已关闭');
      expect(harness.statusLine()).toContain('不会附加协议');
      expect(harness.saved).toEqual([false]);

      toggle.click();
      expect(harness.doc.documentElement.getAttribute(BRIDGE_ENABLED_ATTR)).toBe('true');
      expect(harness.statusLine()).toContain('静默增强已就绪');
    } finally {
      harness.lifecycle.stop();
    }
  });

  it('设置存储变化会同步桥接属性与状态', async () => {
    const harness = await createHarness();
    try {
      harness.emitStore(false);
      expect(harness.doc.documentElement.getAttribute(BRIDGE_ENABLED_ATTR)).toBe('false');
      expect(harness.statusLine()).toContain('增强已关闭');

      harness.emitStore(true);
      expect(harness.doc.documentElement.getAttribute(BRIDGE_ENABLED_ATTR)).toBe('true');
      expect(harness.statusLine()).toContain('静默增强已就绪');
    } finally {
      harness.lifecycle.stop();
    }
  });

  it('收到发送事件后复位单轮模式，暂存详情在送达后才清除', async () => {
    const harness = await createHarness();
    try {
      harness.modeButton().click();
      expect(harness.doc.documentElement.getAttribute(BRIDGE_MODE_ATTR)).toBe('tool');
      const stash = writePendingRepairPrompt(harness.doc.documentElement, '完整修复请求');
      expect(stash).not.toBeNull();

      harness.doc.dispatchEvent(
        new CustomEvent(REQUEST_SENT_EVENT, {
          detail: { mode: 'tool', modeRevision: 1, injected: true, repairStashId: stash?.id ?? null },
        }),
      );

      expect(harness.doc.documentElement.getAttribute(BRIDGE_MODE_ATTR)).toBe('auto');
      expect(harness.modeButton().textContent).toBe('本轮：自动适配');
      expect(harness.statusLine()).toContain('静默增强已就绪');
      // 请求尚未成功返回：暂存不能被提前消费。
      expect(readPendingRepairPrompt(harness.doc.documentElement)).toBe('完整修复请求');

      harness.doc.dispatchEvent(
        new CustomEvent(REQUEST_DELIVERED_EVENT, { detail: { repairStashId: stash?.id ?? null } }),
      );
      expect(harness.doc.documentElement.getAttribute(BRIDGE_PENDING_REPAIR_ATTR)).toBeNull();
    } finally {
      harness.lifecycle.stop();
    }
  });

  it('草稿不再包含短触发文本时，暂存详情立即失效', async () => {
    const harness = await createHarness();
    try {
      writePendingRepairPrompt(harness.doc.documentElement, '完整修复详情');
      harness.typeDraft('用户改成了别的问题');
      expect(harness.doc.documentElement.getAttribute(BRIDGE_PENDING_REPAIR_ATTR)).toBeNull();

      writePendingRepairPrompt(harness.doc.documentElement, '完整修复详情');
      harness.typeDraft(`补充说明\n\n${SHORT_REPAIR_TRIGGER_TEXT}`);
      expect(readPendingRepairPrompt(harness.doc.documentElement)).toBe('完整修复详情');
    } finally {
      harness.lifecycle.stop();
    }
  });

  it('提交后两秒内的空草稿视为站点清空，不清除本次暂存', async () => {
    const harness = await createHarness();
    try {
      const stash = writePendingRepairPrompt(harness.doc.documentElement, '完整修复详情');
      harness.doc.dispatchEvent(sentEvent(stash?.id ?? null));
      harness.typeDraft('');
      expect(readPendingRepairPrompt(harness.doc.documentElement)).toBe('完整修复详情');
    } finally {
      harness.lifecycle.stop();
    }
  });

  it('超过两秒后的空草稿视为用户取消，暂存立即清除', async () => {
    const harness = await createHarness();
    try {
      const stash = writePendingRepairPrompt(harness.doc.documentElement, '完整修复详情');
      harness.doc.dispatchEvent(sentEvent(stash?.id ?? null));
      const restore = freezeNow(Date.now() + 3000);
      try {
        harness.typeDraft('');
      } finally {
        restore();
      }
      expect(harness.doc.documentElement.getAttribute(BRIDGE_PENDING_REPAIR_ATTR)).toBeNull();
    } finally {
      harness.lifecycle.stop();
    }
  });

  it('普通发送后的清空不会豁免新的修复暂存', async () => {
    const harness = await createHarness();
    try {
      // 普通请求提交：本次没有暂存参与。
      harness.doc.dispatchEvent(sentEvent(null));
      // 之后用户新生成修复请求又主动清空草稿：这属于取消，应清理暂存。
      writePendingRepairPrompt(harness.doc.documentElement, '新的修复详情');
      harness.typeDraft('');
      expect(harness.doc.documentElement.getAttribute(BRIDGE_PENDING_REPAIR_ATTR)).toBeNull();
    } finally {
      harness.lifecycle.stop();
    }
  });

  it('为旧暂存的发送不会保护后来新生成的暂存', async () => {
    const harness = await createHarness();
    try {
      const oldStash = writePendingRepairPrompt(harness.doc.documentElement, '旧修复详情');
      harness.doc.dispatchEvent(sentEvent(oldStash?.id ?? null));
      // 用户清空后重新生成了一份新的修复请求：旧请求的清空豁免不适用。
      writePendingRepairPrompt(harness.doc.documentElement, '新的修复详情');
      harness.typeDraft('');
      expect(harness.doc.documentElement.getAttribute(BRIDGE_PENDING_REPAIR_ATTR)).toBeNull();
    } finally {
      harness.lifecycle.stop();
    }
  });
});

/** 临时把 `Date.now` 推到指定时刻，返回恢复函数。 */
function freezeNow(value: number): () => void {
  const original = Date.now;
  Date.now = () => value;
  return () => {
    Date.now = original;
  };
}
