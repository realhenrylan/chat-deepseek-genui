import { describe, expect, it } from 'vitest';
import {
  GENUI_PROMPT_END,
  GENUI_PROMPT_START,
  GENUI_PROMPT_TEXT,
  GENUI_PROMPT_VERSION,
  appendGenuiPrompt,
  hasGenuiPrompt,
} from '../../src/content/prompt';
import { parseGenui } from '../../src/protocol/validate';

/**
 * 阶段 7：默认增强提示词是用户可见文本，必须可识别、可去重、不改动原草稿，
 * 并且只描述扩展真实支持的 v5 协议能力（含语义模型与函数曲线系列）。
 */

const USER_DRAFT = '帮我算一下每月能存多少钱';

describe('默认增强提示词', () => {
  it('版本化标记与完整文本首尾一致', () => {
    expect(GENUI_PROMPT_VERSION).toBe(2.4);
    expect(GENUI_PROMPT_START).toContain(`v${GENUI_PROMPT_VERSION}`);
    expect(GENUI_PROMPT_TEXT.startsWith(GENUI_PROMPT_START)).toBe(true);
    expect(GENUI_PROMPT_TEXT.endsWith(GENUI_PROMPT_END)).toBe(true);
    expect(hasGenuiPrompt(GENUI_PROMPT_TEXT)).toBe(true);
  });

  it('包含真实协议的核心组件、绑定、运算与限制说明', () => {
    const required = [
      'version',
      'state',
      'derived',
      'models',
      'budget',
      'cost',
      'preference',
      'explain',
      '"model"',
      'elements',
      'number',
      'select',
      'slider',
      'number-input',
      'value',
      'visibleIf',
      'section',
      'columns',
      'chart',
      'smooth',
      'function',
      '"op":"x"',
      '"zero"',
      'table',
      'add',
      'subtract',
      'multiply',
      'divide',
      '64KiB',
    ];
    for (const token of required) expect(GENUI_PROMPT_TEXT).toContain(token);
    expect(GENUI_PROMPT_TEXT).toContain('"initialSort"');
    expect(GENUI_PROMPT_TEXT).toContain('不能写 direction');
    expect(GENUI_PROMPT_TEXT).toContain('elements 必填，且至少包含 1 个元素');
    expect(GENUI_PROMPT_TEXT).toContain('不要为了展示而强行生成界面');
    expect(GENUI_PROMPT_TEXT).toContain('可见');
  });

  it('空草稿不追加，已有提示词不重复追加', () => {
    expect(appendGenuiPrompt('')).toEqual({ value: '', inserted: false, userLength: 0 });
    expect(appendGenuiPrompt('  \n  ')).toEqual({
      value: '  \n  ',
      inserted: false,
      userLength: 5,
    });

    const first = appendGenuiPrompt(USER_DRAFT);
    expect(first.inserted).toBe(true);
    expect(first.userLength).toBe(USER_DRAFT.length);
    expect(first.value.startsWith(USER_DRAFT)).toBe(true);
    expect(first.value).toContain(GENUI_PROMPT_TEXT);

    const second = appendGenuiPrompt(first.value);
    expect(second.inserted).toBe(false);
    expect(second.value).toBe(first.value);
  });

  it('用户草稿逐字节保留，只在末尾按需补换行', () => {
    for (const draft of ['abc', 'abc\n', 'abc\n\n', '  草稿  ']) {
      const result = appendGenuiPrompt(draft);
      expect(result.inserted).toBe(true);
      expect(result.value.startsWith(draft)).toBe(true);
      expect(result.value.slice(result.userLength)).toContain(GENUI_PROMPT_START);
    }
  });

  it('提示词中的示例是合法 v5 文档，可被本地协议直接解析', () => {
    const match = /```genui\n([\s\S]*?)\n```/.exec(GENUI_PROMPT_TEXT);
    expect(match).not.toBeNull();
    const example = parseGenui(match?.[1] ?? '');
    expect(example).toMatchObject({ ok: true });
    if (example.ok) {
      expect(example.document.version).toBe(5);
      expect(example.document.elements.length).toBeGreaterThan(0);
    }
  });
});
