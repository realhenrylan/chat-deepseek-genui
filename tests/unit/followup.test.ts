import { afterEach, describe, expect, it } from 'vitest';
import { fillContinueIntoInput } from '../../src/content/followup';

/**
 * 阶段 6：继续讨论 → 带入输入框。
 *
 * 取证依据（docs/compatibility-investigation.md §3.5 / §5）：
 * - DeepSeek 输入框本体是 `textarea[name="search"]`（placeholder「给 DeepSeek 发送消息」）；
 * - 草稿按会话保留且绝不覆盖——「继续讨论」只能追加，不得替换或清除；
 * - 发送必须由用户完成：只写值并派发 input，不提交。
 */

const SUMMARY_A = '继续讨论「本地预算计算」：\n- 总预算：100 元\n请基于以上当前条件与结果继续讨论。';
const SUMMARY_B = '继续讨论「选购比较」：\n- 预算：80 元\n请基于以上当前条件与结果继续讨论。';

function createTextarea(value = ''): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  textarea.setAttribute('name', 'search');
  textarea.value = value;
  document.body.append(textarea);
  return textarea;
}

describe('fillContinueIntoInput', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('空输入框时直接填入摘要并派发 bubbles 的 input 事件', () => {
    const textarea = createTextarea('');
    const events: { bubbles: boolean }[] = [];
    textarea.addEventListener('input', (event) => {
      events.push({ bubbles: (event as InputEvent).bubbles });
    });

    const status = fillContinueIntoInput(document, SUMMARY_A);

    expect(status).toBe('filled');
    expect(textarea.value).toBe(SUMMARY_A);
    expect(events).toEqual([{ bubbles: true }]);
  });

  it('已有草稿时追加，且原草稿完整保留', () => {
    const textarea = createTextarea('保留的草稿');
    const status = fillContinueIntoInput(document, SUMMARY_A);
    expect(status).toBe('appended');
    expect(textarea.value.startsWith('保留的草稿')).toBe(true);
    expect(textarea.value).toContain(SUMMARY_A);
    expect(textarea.value).toContain('保留的草稿\n\n');
  });

  it('重复点击不重复追加同一份摘要', () => {
    const textarea = createTextarea('');
    fillContinueIntoInput(document, SUMMARY_A);
    const afterFirst = textarea.value;
    const status = fillContinueIntoInput(document, SUMMARY_A);
    expect(status).toBe('appended');
    expect(textarea.value).toBe(afterFirst);
  });

  it('追加第二张卡片的摘要，两份摘要并存且互不覆盖', () => {
    const textarea = createTextarea('');
    fillContinueIntoInput(document, SUMMARY_A);
    const status = fillContinueIntoInput(document, SUMMARY_B);
    expect(status).toBe('appended');
    expect(textarea.value).toContain(SUMMARY_A);
    expect(textarea.value).toContain(SUMMARY_B);
  });

  it('草稿只有空白字符时仍逐字保留，只追加摘要', () => {
    const textarea = createTextarea('  \n  ');
    const status = fillContinueIntoInput(document, SUMMARY_A);
    expect(status).toBe('appended');
    expect(textarea.value).toBe(`  \n  \n\n${SUMMARY_A}`);
  });

  it('name=search 与 placeholder 候选并存时视为歧义，不猜测写入', () => {
    const search = createTextarea('');
    const fallback = document.createElement('textarea');
    fallback.setAttribute('placeholder', '给 DeepSeek 发送消息');
    document.body.append(fallback);

    const status = fillContinueIntoInput(document, SUMMARY_A);
    expect(status).toBe('no-input');
    expect(search.value).toBe('');
    expect(fallback.value).toBe('');
  });

  it('唯一 placeholder「发送消息」的 textarea 可作为回退目标', () => {
    const fallback = document.createElement('textarea');
    fallback.setAttribute('placeholder', '给 DeepSeek 发送消息');
    document.body.append(fallback);

    const status = fillContinueIntoInput(document, SUMMARY_A);
    expect(status).toBe('filled');
    expect(fallback.value).toBe(SUMMARY_A);
  });

  it('无确定标记（无 name、placeholder 不含「发送消息」）时返回 no-input，不猜测最后一个 textarea', () => {
    const first = document.createElement('textarea');
    const second = document.createElement('textarea');
    second.id = 'unrelated-control';
    document.body.append(first, second);

    const status = fillContinueIntoInput(document, SUMMARY_A);
    expect(status).toBe('no-input');
    expect(first.value).toBe('');
    expect(second.value).toBe('');
  });

  it('草稿以换行结尾时直接另起一行追加，草稿全文逐字节保留', () => {
    const textarea = createTextarea('第一行草稿\n');
    const status = fillContinueIntoInput(document, SUMMARY_A);
    expect(status).toBe('appended');
    expect(textarea.value).toBe(`第一行草稿\n${SUMMARY_A}`);
  });

  it('草稿末尾的空白逐字节保留（不裁剪），仅非换行结尾时补空行分隔', () => {
    const textarea = createTextarea('草稿   ');
    const status = fillContinueIntoInput(document, SUMMARY_A);
    expect(status).toBe('appended');
    expect(textarea.value).toBe(`草稿   \n\n${SUMMARY_A}`);
  });

  it('页面没有输入框时返回 no-input', () => {
    const status = fillContinueIntoInput(document, SUMMARY_A);
    expect(status).toBe('no-input');
  });
});
