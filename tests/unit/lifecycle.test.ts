import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GENUI_ATTR,
  initContentScript,
  resolveRuntimeId,
  type ContentScope,
} from '../../src/content/lifecycle';

describe('内容脚本生命周期标记', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(GENUI_ATTR);
    vi.restoreAllMocks();
  });

  it('首次初始化在 documentElement 写入标记并返回 runtime id', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const scope: ContentScope = {};

    const result = initContentScript(scope, document);

    expect(result.alreadyLoaded).toBe(false);
    expect(document.documentElement.getAttribute(GENUI_ATTR)).toBe(result.runtimeId);
    expect(debugSpy).toHaveBeenCalledTimes(1);
  });

  it('重复初始化被跳过，不重复写标记、不重复输出日志', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const scope: ContentScope = {};
    initContentScript(scope, document);

    const second = initContentScript(scope, document);

    expect(second.alreadyLoaded).toBe(true);
    expect(debugSpy).toHaveBeenCalledTimes(1);
  });

  it('不同作用域互不影响（隔离世界的初始化状态由各自作用域持有）', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const firstScope: ContentScope = {};
    const secondScope: ContentScope = {};
    initContentScript(firstScope, document);

    const second = initContentScript(secondScope, document);

    expect(second.alreadyLoaded).toBe(false);
  });

  it('无 chrome.runtime 的环境（如测试环境）返回 runtime-unavailable', () => {
    expect(resolveRuntimeId()).toBe('runtime-unavailable');
  });

  it('documentElement 缺失时抛出可诊断错误', () => {
    const brokenDoc = { documentElement: null } as unknown as Document;

    expect(() => initContentScript({}, brokenDoc)).toThrow('documentElement 不存在');
  });
});
