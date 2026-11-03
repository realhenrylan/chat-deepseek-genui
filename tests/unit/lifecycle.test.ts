import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GENUI_ATTR,
  GENUI_VERSION_ATTR,
  initContentScript,
  resolveContentVersion,
  resolveRuntimeId,
  type ContentScope,
} from '../../src/content/lifecycle';

describe('内容脚本生命周期标记', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(GENUI_ATTR);
    document.documentElement.removeAttribute(GENUI_VERSION_ATTR);
    vi.restoreAllMocks();
  });

  it('首次初始化在 documentElement 写入标记并返回 runtime id', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const scope: ContentScope = {};

    const result = initContentScript(scope, document);

    expect(result.alreadyLoaded).toBe(false);
    expect(document.documentElement.getAttribute(GENUI_ATTR)).toBe(result.runtimeId);
    expect(document.documentElement.getAttribute(GENUI_VERSION_ATTR)).toBe(result.version);
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

describe('内容脚本版本标记（vite define 对账）', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(GENUI_VERSION_ATTR);
    vi.restoreAllMocks();
  });

  it('resolveContentVersion 返回构建期版本或占位值，且不抛错', () => {
    const version = resolveContentVersion();
    expect(version).toBe(typeof __DSGENUI_VERSION__ !== 'undefined' ? __DSGENUI_VERSION__ : version);
    expect(version).toMatch(/^(0\.0\.0-dev|\d+\.\d+\.\d+.*)$/);
  });

  it('initContentScript 同步写出 data-genui-version 属性，便于真实页面核对加载版本', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const result = initContentScript({}, document);

    expect(document.documentElement.getAttribute(GENUI_VERSION_ATTR)).toBe(result.version);
    expect(result.version).toBe(resolveContentVersion());
  });

  it('重复初始化返回已首次写出的版本，不改写属性', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const scope: ContentScope = {};
    const first = initContentScript(scope, document);
    document.documentElement.setAttribute(
      GENUI_VERSION_ATTR,
      `${first.version}-stale`,
    );

    const second = initContentScript(scope, document);

    expect(second.alreadyLoaded).toBe(true);
    expect(second.version).toBe(first.version);
    // 幂等路径不重写属性：真实页面看到的就是最初注入时的值。
    expect(document.documentElement.getAttribute(GENUI_VERSION_ATTR)).toBe(
      `${first.version}-stale`,
    );
  });
});
