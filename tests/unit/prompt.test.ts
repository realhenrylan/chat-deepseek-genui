import { describe, expect, it } from 'vitest';
import {
  GENUI_PLAIN_PROMPT_NOTE,
  GENUI_PROMPT_END,
  GENUI_PROMPT_START,
  GENUI_PROMPT_TEXT,
  GENUI_PROMPT_TOOL_START,
  GENUI_PROMPT_VERSION,
  GENUI_TOOL_PROMPT_TEXT,
  GENUI_PROMPT_V30_START,
  GENUI_PROMPT_TOOL_V30_START,
  GENUI_PROMPT_V30_TEXT,
  GENUI_TOOL_PROMPT_V30_TEXT,
  appendGenuiPrompt,
  describeGenuiDraftPrompt,
  getGenuiPromptTextForMode,
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
    expect(GENUI_PROMPT_VERSION).toBe('3.1');
    expect(GENUI_PROMPT_START).toContain(`v${GENUI_PROMPT_VERSION}`);
    expect(GENUI_PROMPT_TEXT.startsWith(GENUI_PROMPT_START)).toBe(true);
    expect(GENUI_PROMPT_TEXT.endsWith(GENUI_PROMPT_END)).toBe(true);
    expect(hasGenuiPrompt(GENUI_PROMPT_TEXT)).toBe(true);
  });

  it('明确 section/columns 组合原则与容器可用宽度自适应说明', () => {
    expect(GENUI_PROMPT_TEXT).toContain('通过标题与留白组织逻辑分组');
    expect(GENUI_PROMPT_TEXT).toContain('按卡片容器实际可用宽度自动切换');
    expect(GENUI_PROMPT_TEXT).toContain('宽时并列、窄栏自动上下单列');
    expect(GENUI_PROMPT_TEXT).toContain('推荐将可调参数与核心结果放入 2 列 columns 并列对照');
    expect(GENUI_PROMPT_TEXT).toContain('关键说明、警告和假设保持直接可见');
  });

  it('只把显式 primary 描述为展示强调', () => {
    expect(GENUI_PROMPT_TEXT).toContain('前两个显式 primary');
    expect(GENUI_PROMPT_TEXT).toContain('不参与求值');
    expect(GENUI_PROMPT_TEXT).toContain('不要按数值大小、标签文字或派生顺序猜测业务重要性');
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
      'emphasis',
      'primary',
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
    expect(GENUI_PROMPT_TEXT).toContain('"selectable"');
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

describe('issue7 本轮模式变体', () => {
  const NL = String.fromCharCode(10);
  const OPEN = '```genui' + NL;
  const CLOSE = NL + '```';

  function parseFirstExample(text: string): ReturnType<typeof parseGenui> {
    const startIdx = text.indexOf(OPEN);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    const endIdx = text.indexOf(CLOSE, startIdx + OPEN.length);
    expect(endIdx).toBeGreaterThan(startIdx);
    return parseGenui(text.slice(startIdx + OPEN.length, endIdx));
  }

  it('auto 默认文本、tool 文本与 plain 说明按模式取值', () => {
    expect(getGenuiPromptTextForMode('auto')).toBe(GENUI_PROMPT_TEXT);
    expect(getGenuiPromptTextForMode('tool')).toBe(GENUI_TOOL_PROMPT_TEXT);
    expect(getGenuiPromptTextForMode('plain')).toBeNull();
    expect(GENUI_PLAIN_PROMPT_NOTE).toContain('普通回答');
    expect(GENUI_PLAIN_PROMPT_NOTE).toContain('不会向你的草稿追加任何');
  });

  it('tool 文本独立标记，且与 auto 逐字节共享协议主体', () => {
    expect(GENUI_TOOL_PROMPT_TEXT.startsWith(GENUI_PROMPT_TOOL_START)).toBe(true);
    expect(GENUI_TOOL_PROMPT_TEXT.endsWith(GENUI_PROMPT_END)).toBe(true);
    expect(hasGenuiPrompt(GENUI_TOOL_PROMPT_TEXT)).toBe(true);
    const sharedTail = (text: string): string => text.slice(text.indexOf('内容分工'));
    // 只有第一段表达策略不同；协议主体（内容分工→结束标记）逐字节一致。
    expect(sharedTail(GENUI_TOOL_PROMPT_TEXT)).toBe(sharedTail(GENUI_PROMPT_TEXT));
    expect(GENUI_TOOL_PROMPT_TEXT).toContain('本轮回答工具');
    expect(GENUI_TOOL_PROMPT_TEXT).toContain('不要硬造界面');
    expect(GENUI_PROMPT_TEXT).not.toContain('本轮回答工具');
  });

  it('tool 模式按标记追加且可去重；auto/tool 文本互不重复', () => {
    const toolFirst = appendGenuiPrompt(USER_DRAFT, 'tool');
    expect(toolFirst.inserted).toBe(true);
    expect(toolFirst.userLength).toBe(USER_DRAFT.length);
    expect(toolFirst.value.startsWith(USER_DRAFT)).toBe(true);
    expect(toolFirst.value).toContain(GENUI_TOOL_PROMPT_TEXT);

    expect(appendGenuiPrompt(toolFirst.value, 'tool').inserted).toBe(false);
    expect(appendGenuiPrompt(toolFirst.value, 'auto').inserted).toBe(false);

    const autoFirst = appendGenuiPrompt(USER_DRAFT, 'auto');
    expect(appendGenuiPrompt(autoFirst.value, 'tool').inserted).toBe(false);

    const toolSuffix = toolFirst.value.slice(USER_DRAFT.length);
    expect(toolSuffix).toContain(GENUI_PROMPT_TOOL_START);
    expect(toolSuffix).toContain(GENUI_PROMPT_END);
  });

  it('plain 模式不追加任何文本', () => {
    for (const draft of ['', USER_DRAFT, USER_DRAFT + NL]) {
      const result = appendGenuiPrompt(draft, 'plain');
      expect(result.inserted).toBe(false);
      expect(result.value).toBe(draft);
      expect(hasGenuiPrompt(result.value)).toBe(false);
    }
  });

  it('tool 文本中的示例同样可被本地协议解析', () => {
    const example = parseFirstExample(GENUI_TOOL_PROMPT_TEXT);
    expect(example).toMatchObject({ ok: true });
    if (example.ok) {
      expect(example.document.version).toBe(5);
      expect(example.document.elements.length).toBeGreaterThan(0);
    }
  });
});

describe('issue7 草稿说明识别', () => {
  const NL = String.fromCharCode(10);
  const SEP = NL + NL;

  it('无标记时报 none', () => {
    expect(describeGenuiDraftPrompt('随便写的内容')).toEqual({ kind: 'none' });
    expect(describeGenuiDraftPrompt('')).toEqual({ kind: 'none' });
  });

  it('末尾是完整 auto/tool 文本时报 intact，并给出尾部内容', () => {
    const auto = describeGenuiDraftPrompt(`草稿${SEP}${GENUI_PROMPT_TEXT}`);
    expect(auto.kind).toBe('intact');
    expect(auto.suffix).toBe(GENUI_PROMPT_TEXT);
    expect(auto.start).toBe(GENUI_PROMPT_START);

    const tool = describeGenuiDraftPrompt(`草稿${SEP}${GENUI_TOOL_PROMPT_TEXT}`);
    expect(tool.kind).toBe('intact');
    expect(tool.suffix).toBe(GENUI_TOOL_PROMPT_TEXT);
    expect(tool.start).toBe(GENUI_PROMPT_TOOL_START);
  });

  it('说明在中间但不完整时报 edited', () => {
    const edited = describeGenuiDraftPrompt(`草稿${SEP}${GENUI_PROMPT_TEXT.slice(0, 80)}`);
    expect(edited.kind).toBe('edited');
    expect(edited.start).toBe(GENUI_PROMPT_START);

    const toolEdited = describeGenuiDraftPrompt(`草稿${SEP}${GENUI_TOOL_PROMPT_TEXT}尾注`);
    expect(toolEdited.kind).toBe('edited');
    expect(toolEdited.start).toBe(GENUI_PROMPT_TOOL_START);
  });
});

describe('旧版 v3.0 兼容草稿识别与平滑切换', () => {
  const NL = String.fromCharCode(10);
  const SEP = NL + NL;

  it('旧版 v3.0 auto 与 tool 说明均能被 hasGenuiPrompt 正确识别', () => {
    expect(hasGenuiPrompt(GENUI_PROMPT_V30_TEXT)).toBe(true);
    expect(hasGenuiPrompt(GENUI_TOOL_PROMPT_V30_TEXT)).toBe(true);
    expect(hasGenuiPrompt(`草稿${SEP}${GENUI_PROMPT_V30_START}`)).toBe(true);
    expect(hasGenuiPrompt(`草稿${SEP}${GENUI_PROMPT_TOOL_V30_START}`)).toBe(true);
  });

  it('草稿包含旧版 v3.0 说明（无论完整还是已编辑）时不重复追加 v3.1', () => {
    const intactV30Draft = `${USER_DRAFT}${SEP}${GENUI_PROMPT_V30_TEXT}`;
    const autoResult = appendGenuiPrompt(intactV30Draft, 'auto');
    expect(autoResult.inserted).toBe(false);
    expect(autoResult.value).toBe(intactV30Draft);

    const toolResult = appendGenuiPrompt(intactV30Draft, 'tool');
    expect(toolResult.inserted).toBe(false);
    expect(toolResult.value).toBe(intactV30Draft);

    const intactV30ToolDraft = `${USER_DRAFT}${SEP}${GENUI_TOOL_PROMPT_V30_TEXT}`;
    expect(appendGenuiPrompt(intactV30ToolDraft, 'auto').inserted).toBe(false);
    expect(appendGenuiPrompt(intactV30ToolDraft, 'tool').inserted).toBe(false);

    const editedV30Draft = `${USER_DRAFT}${SEP}${GENUI_PROMPT_V30_TEXT.slice(0, 100)}`;
    expect(appendGenuiPrompt(editedV30Draft, 'auto').inserted).toBe(false);
    expect(appendGenuiPrompt(editedV30Draft, 'tool').inserted).toBe(false);
  });

  it('完整 v3.0 自动模式与工具模式提示词识别为 intact，并提供精确后缀', () => {
    const autoInfo = describeGenuiDraftPrompt(`${USER_DRAFT}${SEP}${GENUI_PROMPT_V30_TEXT}`);
    expect(autoInfo.kind).toBe('intact');
    expect(autoInfo.suffix).toBe(GENUI_PROMPT_V30_TEXT);
    expect(autoInfo.start).toBe(GENUI_PROMPT_V30_START);

    const toolInfo = describeGenuiDraftPrompt(`${USER_DRAFT}${SEP}${GENUI_TOOL_PROMPT_V30_TEXT}`);
    expect(toolInfo.kind).toBe('intact');
    expect(toolInfo.suffix).toBe(GENUI_TOOL_PROMPT_V30_TEXT);
    expect(toolInfo.start).toBe(GENUI_PROMPT_TOOL_V30_START);
  });

  it('被用户修改过的 v3.0 提示词识别为 edited，保护用户编辑不被误覆盖', () => {
    const editedAuto = describeGenuiDraftPrompt(`${USER_DRAFT}${SEP}${GENUI_PROMPT_V30_TEXT}用户补充要求`);
    expect(editedAuto.kind).toBe('edited');
    expect(editedAuto.start).toBe(GENUI_PROMPT_V30_START);

    const partialTool = describeGenuiDraftPrompt(`${USER_DRAFT}${SEP}${GENUI_TOOL_PROMPT_V30_TEXT.slice(0, 150)}`);
    expect(partialTool.kind).toBe('edited');
    expect(partialTool.start).toBe(GENUI_PROMPT_TOOL_V30_START);
  });
});
