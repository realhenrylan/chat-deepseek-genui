import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Edge Add-ons 商店语言检测：Partner Center 只列出「manifest 以 __MSG_ 引用、
 * 且 /_locales/<locale>/messages.json 提供对应译文」的语言；缺任一条件时列表页
 * 只会出现默认语言，Add a language 不可用。本测试在源码层锁定该结构，与
 * scripts/check-dist.mjs 的产物校验互补。
 */

const PUBLIC_DIR = join(process.cwd(), 'public');
const LOCALES_DIR = join(PUBLIC_DIR, '_locales');

type Manifest = { name?: string; description?: string; default_locale?: string };
type Messages = Record<string, { message?: string }>;

const MANIFEST = JSON.parse(readFileSync(join(PUBLIC_DIR, 'manifest.json'), 'utf8')) as Manifest;

const messageKey = (value: unknown): string | null => {
  const match = typeof value === 'string' ? /^__MSG_([A-Za-z0-9_@]+)__$/.exec(value) : null;
  return match ? match[1] : null;
};

const descriptionKey = (): string => {
  const key = messageKey(MANIFEST.description);
  if (!key) throw new Error('manifest.description 不是 __MSG_<key>__ 引用');
  return key;
};

const localeNames = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const readMessages = (locale: string): Messages =>
  JSON.parse(readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf8')) as Messages;

describe('Edge 商店国际化：manifest 与 _locales 结构', () => {
  it('manifest.name / manifest.description 使用 __MSG__ 引用', () => {
    expect(messageKey(MANIFEST.name)).toBeTruthy();
    expect(messageKey(MANIFEST.description)).toBeTruthy();
  });

  it('default_locale 指向存在的语言目录', () => {
    expect(MANIFEST.default_locale).toBeTruthy();
    expect(localeNames).toContain(MANIFEST.default_locale);
  });

  it('同时提供英语与简体中文（商店列表双语言）', () => {
    expect(localeNames).toEqual(expect.arrayContaining(['en', 'zh_CN']));
  });

  it('每个语言都为 manifest 引用的键提供非空译文', () => {
    const keys = [messageKey(MANIFEST.name), messageKey(MANIFEST.description)].filter(
      (key): key is string => key !== null,
    );
    expect(keys.length).toBeGreaterThan(0);
    for (const locale of localeNames) {
      const messages = readMessages(locale);
      for (const key of keys) {
        expect(messages[key]?.message?.trim(), `${locale} 缺少 ${key}`).toBeTruthy();
      }
    }
  });

  it('简短描述符合商店 132 字符上限', () => {
    const key = descriptionKey();
    for (const locale of localeNames) {
      expect(readMessages(locale)[key]?.message?.length ?? 0).toBeLessThanOrEqual(132);
    }
  });

  it('英文与中文描述确实不同（说明存在实际翻译）', () => {
    const key = descriptionKey();
    const en = readMessages('en')[key]?.message;
    const zh = readMessages('zh_CN')[key]?.message;
    expect(en).toBeTruthy();
    expect(zh).toBeTruthy();
    expect(en).not.toBe(zh);
  });

  it('messages.json 键名符合浏览器要求（字母、数字、下划线、@）', () => {
    for (const locale of localeNames) {
      for (const key of Object.keys(readMessages(locale))) {
        expect(key, `${locale} 的键名不合法`).toMatch(/^[A-Za-z0-9_@]+$/);
      }
    }
  });
});
