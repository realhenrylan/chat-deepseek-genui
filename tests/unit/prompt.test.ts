import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GENUI_PLAIN_PROMPT_NOTE,
  GENUI_PROMPT_END,
  GENUI_PROMPT_START,
  GENUI_PROMPT_TEXT,
  GENUI_PROMPT_TOOL_START,
  GENUI_PROMPT_VERSION,
  GENUI_PROMPT_V32_TEXT,
  GENUI_TOOL_PROMPT_TEXT,
  GENUI_TOOL_PROMPT_V32_TEXT,
  GENUI_PROMPT_V31_TEXT,
  GENUI_TOOL_PROMPT_V31_TEXT,
  GENUI_PROMPT_V30_START,
  GENUI_PROMPT_TOOL_V30_START,
  GENUI_PROMPT_V30_TEXT,
  GENUI_TOOL_PROMPT_V30_TEXT,
  GENUI_REPAIR_DETAIL_END,
  GENUI_REPAIR_DETAIL_START,
  SHORT_REPAIR_TRIGGER_TEXT,
  appendGenuiPrompt,
  describeGenuiDraftPrompt,
  getGenuiPromptTextForMode,
  hasGenuiPrompt,
  mergeRepairDetails,
  stripGenuiPrompt,
} from '../../src/content/prompt';
import { parseGenui } from '../../src/protocol/validate';

/**
 * 阶段 7：默认增强提示词是用户可见文本，必须可识别、可去重、不改动原草稿，
 * 并且只描述扩展真实支持的 v5 协议能力（含语义模型与函数曲线系列）。
 */

const USER_DRAFT = '帮我算一下每月能存多少钱';

describe('默认增强提示词', () => {
  it('保留旧版提示词的原文，避免把未编辑草稿当成用户修改', () => {
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    expect(hash(GENUI_PROMPT_V31_TEXT)).toBe('668c3181f9a238768f2d2ed807b117c97e809727979cb7f8916b9aa27b132bb3');
    expect(hash(GENUI_TOOL_PROMPT_V31_TEXT)).toBe('c818f37eadcbf63a18190d0286f315bedfcca11cf51a4d4b4716ba81ad630d63');
    for (const text of [GENUI_PROMPT_V31_TEXT, GENUI_TOOL_PROMPT_V31_TEXT]) {
      expect(describeGenuiDraftPrompt(`${USER_DRAFT}\n\n${text}`).kind).toBe('intact');
      expect(appendGenuiPrompt(`${USER_DRAFT}\n\n${text}`).inserted).toBe(false);
      expect(describeGenuiDraftPrompt(`${USER_DRAFT}\n\n${text}修改`).kind).toBe('edited');
    }
  });

  it('版本化标记与完整文本首尾一致', () => {
    expect(GENUI_PROMPT_VERSION).toBe('4.0');
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
    expect(GENUI_PLAIN_PROMPT_NOTE).toContain('不会在后台附加');
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


describe('v4.0 智能界面内联穿插协议提示词特性', () => {
  it('覆盖 7 种 w1 原子小组件语法与自然穿插引导', () => {
    expect(GENUI_PROMPT_TEXT).toContain('穿插排版');
    expect(GENUI_PROMPT_TEXT).toContain('0 到 3 个轻量小组件');
    expect(GENUI_PROMPT_TEXT).toContain('"w":"quiz"');
    expect(GENUI_PROMPT_TEXT).toContain('"w":"card"');
    expect(GENUI_PROMPT_TEXT).toContain('"w":"compare"');
    expect(GENUI_PROMPT_TEXT).toContain('"w":"checklist"');
    expect(GENUI_PROMPT_TEXT).toContain('"w":"slider"');
    expect(GENUI_PROMPT_TEXT).toContain('"w":"result"');
    expect(GENUI_PROMPT_TEXT).toContain('"w":"note"');
  });

  it('提示词中的所有示例代码块均能被 parseGenui 正确解析', () => {
    const regex = /```genui\r?\n([\s\S]*?)\r?\n```/g;
    const blocks: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(GENUI_PROMPT_TEXT)) !== null) {
      blocks.push(match[1]);
    }
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const block of blocks) {
      const parsed = parseGenui(block);
      expect(parsed.ok).toBe(true);
    }
  });
});

describe('stripGenuiPrompt：响应剥离与 DOM 兜底共用同一实现', () => {
  const DRAFT = '把这段话总结成三点';
  const NL = String.fromCharCode(10);
  const PROTOCOL_TEXTS = [
    GENUI_PROMPT_TEXT,
    GENUI_TOOL_PROMPT_TEXT,
    GENUI_PROMPT_V32_TEXT,
    GENUI_TOOL_PROMPT_V32_TEXT,
    GENUI_PROMPT_V31_TEXT,
    GENUI_TOOL_PROMPT_V31_TEXT,
    GENUI_PROMPT_V30_TEXT,
    GENUI_TOOL_PROMPT_V30_TEXT,
  ];
  const REPAIR_DETAILS = [
    '请修复下面这段 GenUI（genui）界面内容的格式错误，并只返回修复后的完整 `genui` 代码块。',
    '',
    '错误路径：/elements/0',
    '错误摘要：缺少 elements',
    '',
    '修复要求：',
    '- 只返回一个 genui 代码块',
  ].join(NL);

  it('移除任意版本的尾部协议块并逐字节保留用户原文', () => {
    for (const text of PROTOCOL_TEXTS) {
      const result = stripGenuiPrompt(`${DRAFT}${NL}${NL}${text}`);
      expect(result).toEqual({ text: DRAFT, stripped: true });
      // 幂等：清洗后的文本再次剥离不产生变化。
      expect(stripGenuiPrompt(result.text)).toEqual({ text: DRAFT, stripped: false });
    }
  });

  it('移除末尾协议块后不留多余空白', () => {
    expect(stripGenuiPrompt(`${DRAFT}${NL}${NL}${GENUI_PROMPT_TEXT}${NL}${NL}`)).toEqual({
      text: DRAFT,
      stripped: true,
    });
  });

  it('纯用户消息、行内引用与残缺标记都不做改动', () => {
    expect(stripGenuiPrompt(DRAFT)).toEqual({ text: DRAFT, stripped: false });
    expect(stripGenuiPrompt('')).toEqual({ text: '', stripped: false });

    const inline = `第一段${GENUI_PROMPT_START} 第二段${NL}${NL}${GENUI_PROMPT_END}`;
    expect(stripGenuiPrompt(inline).stripped).toBe(false);

    const partial = `${DRAFT}${NL}${NL}${GENUI_PROMPT_START}${NL}未写完`;
    expect(stripGenuiPrompt(partial)).toEqual({ text: partial, stripped: false });
  });

  it('用户引用首尾标记、但内容不是扩展协议时不会被截断', () => {
    const quotedRepair = `${DRAFT}${NL}${GENUI_REPAIR_DETAIL_START}${NL}这是用户自己引用的内容${NL}${GENUI_REPAIR_DETAIL_END}`;
    expect(stripGenuiPrompt(quotedRepair)).toEqual({ text: quotedRepair, stripped: false });

    const quotedProtocol = `${DRAFT}${NL}${GENUI_PROMPT_START}${NL}用户自己的段落${NL}${GENUI_PROMPT_END}`;
    expect(stripGenuiPrompt(quotedProtocol).stripped).toBe(false);
  });

  it('修复详情缺少校验码或校验码不匹配时保留原文', () => {
    const forged = [
      DRAFT,
      GENUI_REPAIR_DETAIL_START,
      '请修复下面这段 GenUI（genui）界面内容的格式错误，并只返回修复后的完整 `genui` 代码块。',
      '',
      '修复要求：',
      '- 保留我的原文',
      GENUI_REPAIR_DETAIL_END,
    ].join(NL);
    expect(stripGenuiPrompt(forged)).toEqual({ text: forged, stripped: false });

    const merged = mergeRepairDetails(SHORT_REPAIR_TRIGGER_TEXT, REPAIR_DETAILS);
    const tampered = merged.replace(/〔GenUI 修复详情校验：[0-9a-z]+〕/, '〔GenUI 修复详情校验：zzzz〕');
    expect(tampered).not.toBe(merged);
    expect(stripGenuiPrompt(tampered).stripped).toBe(false);
  });

  it('修复详情块可被剥离，只保留短触发文本', () => {
    const merged = mergeRepairDetails(SHORT_REPAIR_TRIGGER_TEXT, REPAIR_DETAILS);
    expect(merged).toContain(GENUI_REPAIR_DETAIL_START);
    expect(merged.endsWith(GENUI_REPAIR_DETAIL_END)).toBe(true);
    expect(stripGenuiPrompt(merged)).toEqual({
      text: SHORT_REPAIR_TRIGGER_TEXT,
      stripped: true,
    });
  });

  it('修复详情与协议块相邻时会被逐个移除', () => {
    const merged = mergeRepairDetails(SHORT_REPAIR_TRIGGER_TEXT, REPAIR_DETAILS);
    const outgoing = `${merged}${NL}${NL}${GENUI_PROMPT_TEXT}`;
    expect(stripGenuiPrompt(outgoing)).toEqual({
      text: SHORT_REPAIR_TRIGGER_TEXT,
      stripped: true,
    });
    const cleaned = SHORT_REPAIR_TRIGGER_TEXT;
    expect(stripGenuiPrompt(cleaned)).toEqual({ text: cleaned, stripped: false });
  });
});

describe('mergeRepairDetails：发送时静默合并修复详情', () => {
  const DETAILS = [
    '请修复下面这段 GenUI（genui）界面内容的格式错误，并只返回修复后的完整 `genui` 代码块。',
    '',
    '错误路径：/elements/0',
    '期望：至少包含 1 个元素',
    '',
    '修复要求：',
    '- 只返回一个 genui 代码块',
  ].join(String.fromCharCode(10));

  it('只在短触发文本中出现时合并，且不重复追加', () => {
    const plainDraft = '帮我改一下这段代码';
    expect(mergeRepairDetails(plainDraft, DETAILS)).toBe(plainDraft);

    const merged = mergeRepairDetails(SHORT_REPAIR_TRIGGER_TEXT, DETAILS);
    expect(merged.startsWith(SHORT_REPAIR_TRIGGER_TEXT)).toBe(true);
    expect(merged).toContain(GENUI_REPAIR_DETAIL_START);
    expect(merged).toContain(DETAILS);

    expect(mergeRepairDetails(merged, DETAILS)).toBe(merged);
    expect(mergeRepairDetails(SHORT_REPAIR_TRIGGER_TEXT, null)).toBe(SHORT_REPAIR_TRIGGER_TEXT);
    expect(mergeRepairDetails(SHORT_REPAIR_TRIGGER_TEXT, '   ')).toBe(SHORT_REPAIR_TRIGGER_TEXT);
  });

  it('用户保留的草稿在触发文本之前时，详情仍追加到末尾', () => {
    const draft = `保留的补充说明${String.fromCharCode(10)}${String.fromCharCode(10)}${SHORT_REPAIR_TRIGGER_TEXT}`;
    const merged = mergeRepairDetails(draft, DETAILS);
    expect(merged.startsWith(draft)).toBe(true);
    expect(stripGenuiPrompt(merged).text).toBe(draft);
  });
});
