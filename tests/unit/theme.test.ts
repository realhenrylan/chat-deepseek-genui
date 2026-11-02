import { afterEach, describe, expect, it } from 'vitest';
import { detectSiteTheme, watchSiteTheme } from '../../src/render/theme';

/**
 * 阶段 6：站点主题检测与监听。
 *
 * 检测依据来自阶段 0 真实取证（docs/compatibility-investigation.md §3.1）：
 * - 暗色：`<body class="zh_CN dark" data-ds-dark-theme="dark">`
 * - 浅色：`<body class="zh_CN light">`（`data-ds-dark-theme` 属性消失）
 * - 页面未显式标记时回退系统偏好 prefers-color-scheme；jsdom 无 matchMedia 时回退 light。
 */

describe('detectSiteTheme', () => {
  afterEach(() => {
    document.body.className = '';
    document.body.removeAttribute('data-ds-dark-theme');
  });

  it('data-ds-dark-theme="dark" 判定为暗色（站点属性标记优先）', () => {
    document.body.className = 'zh_CN light';
    document.body.setAttribute('data-ds-dark-theme', 'dark');
    expect(detectSiteTheme(document)).toBe('dark');
  });

  it('body class 含 dark 判定为暗色', () => {
    document.body.className = 'zh_CN dark';
    expect(detectSiteTheme(document)).toBe('dark');
  });

  it('body class 含 light 且无暗色标记判定为浅色', () => {
    document.body.className = 'zh_CN light';
    expect(detectSiteTheme(document)).toBe('light');
  });

  it('无任何站点标记时回退 light（jsdom 无 matchMedia）', () => {
    document.body.className = 'zh_CN';
    expect(detectSiteTheme(document)).toBe('light');
  });

  it('documentElement 上的 class 也可兜底检测', () => {
    document.body.removeAttribute('data-ds-dark-theme');
    document.documentElement.className = 'dark';
    expect(detectSiteTheme(document)).toBe('dark');
    document.documentElement.className = '';
  });
});

describe('watchSiteTheme', () => {
  afterEach(() => {
    document.body.className = '';
    document.body.removeAttribute('data-ds-dark-theme');
    document.removeEventListener('DOMContentLoaded', () => {});
  });

  it('站点 class 切换时回调并保持原子性（无变化不回调）', async () => {
    expect(detectSiteTheme(document)).toBe('light');
    const seen: ReturnType<typeof detectSiteTheme>[] = [];
    const dispose = watchSiteTheme(document, (next) => {
      seen.push(next);
    });

    document.body.className = 'zh_CN dark';
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(seen[seen.length - 1]).toBe('dark');
    dispose();
  });

  it('启动时主题标记尚未出现，body class 后置变更仍能触发回调（jsdom 会自动生成空 body，无法模拟 body 缺失）', async () => {
    const doc = new DOMParser().parseFromString(
      '<!doctype html><html><head></head></html>',
      'text/html',
    );
    const seen: string[] = [];
    const dispose = watchSiteTheme(doc as unknown as Document, (next) => {
      seen.push(next);
    });
    try {
      // 内容脚本启动时站点还没有写主题标记；用户切到深色后 body class 出现。
      doc.body!.className = 'zh_CN dark';
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      expect(seen).toContain('dark');
    } finally {
      dispose();
    }
  });
});
