import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_SESSION_ID,
  computeCardIdentities,
  createCardKey,
  readSessionId,
  type CardIdentity,
} from '../../src/content/identity';
import type { GenuiBlockCandidate } from '../../src/content/detect';

/**
 * issue #2：卡片稳定身份。
 *
 * 身份必须能区分「同标题、不同消息」，并识别出不可靠的消息标记，
 * 以便保存路径拒绝写入，避免跨会话串值。
 */

const RAW = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"同标题"}]}';

function blockMarkup(raw: string = RAW): string {
  return `<div class="md-code-block"><div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div><pre><span>${raw}</span></pre></div>`;
}

function buildDoc(body: string): Document {
  return new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body>${body}</body></html>`,
    'text/html',
  );
}

function candidates(doc: Document): {
  candidates: GenuiBlockCandidate[];
  byContainer: Map<Element, GenuiBlockCandidate[]>;
} {
  const list: GenuiBlockCandidate[] = [];
  const byContainer = new Map<Element, GenuiBlockCandidate[]>();
  for (const container of doc.querySelectorAll('div.ds-assistant-message-main-content')) {
    for (const block of container.querySelectorAll<HTMLElement>('div.md-code-block')) {
      const candidate: GenuiBlockCandidate = {
        container,
        block,
        pre: block.querySelector('pre'),
        labelSource: 'primary',
      };
      list.push(candidate);
      const grouped = byContainer.get(container) ?? [];
      grouped.push(candidate);
      byContainer.set(container, grouped);
    }
  }
  return { candidates: list, byContainer };
}

function identityFor(doc: Document, index = 0, sessionId?: string): CardIdentity {
  const { candidates: list } = candidates(doc);
  const map = computeCardIdentities(list, { document: doc, sessionId });
  const target = list[index];
  const identity = target ? map.get(target.block) : undefined;
  if (!identity) throw new Error('缺少身份');
  return identity;
}

describe('卡片身份：会话与消息', () => {
  it('不同虚拟列表消息、同标题同内容也互不串用', () => {
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>` +
        `<div data-virtual-list-item-key="v2"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>`,
    );

    const first = identityFor(doc, 0, '/a/chat/s/session-1');
    const second = identityFor(doc, 1, '/a/chat/s/session-1');

    expect(first.messageKey).toBe('vl:v1');
    expect(second.messageKey).toBe('vl:v2');
    expect(first.key).not.toBe(second.key);
    expect(first.ambiguous).toBe(false);
    expect(second.ambiguous).toBe(false);
  });

  it('同一会话切换路由后键不同；未知会话标记 ambiguous', () => {
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>`,
    );

    expect(identityFor(doc, 0, '/a/chat/s/a').key).not.toBe(
      identityFor(doc, 0, '/a/chat/s/b').key,
    );
    expect(identityFor(doc, 0).ambiguous).toBe(true);
    expect(identityFor(doc, 0, UNKNOWN_SESSION_ID).sessionId).toBe(UNKNOWN_SESSION_ID);
  });

  it('消息键优先虚拟列表 key，其次 data-message-id', () => {
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1" data-message-id="m1"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>` +
        `<div data-message-id="m2"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>`,
    );

    expect(identityFor(doc, 0, '/s').messageKey).toBe('vl:v1');
    expect(identityFor(doc, 1, '/s').messageKey).toBe('mid:m2');
  });

  it('同一消息内重复的原始文档按出现顺序编号', () => {
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1"><div class="ds-assistant-message-main-content">${blockMarkup()}${blockMarkup()}</div></div>`,
    );

    const first = identityFor(doc, 0, '/s');
    const second = identityFor(doc, 1, '/s');
    expect(first.duplicateIndex).toBe(0);
    expect(second.duplicateIndex).toBe(1);
    expect(first.documentHash).toBe(second.documentHash);
    expect(first.key).not.toBe(second.key);
  });

  it('同一消息的多张不同文档都从 0 编号，不按卡片序号漂移', () => {
    const other = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"另一张"}]}';
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1"><div class="ds-assistant-message-main-content">${blockMarkup()}${blockMarkup(other)}</div></div>`,
    );

    expect(identityFor(doc, 0, '/s').duplicateIndex).toBe(0);
    expect(identityFor(doc, 1, '/s').duplicateIndex).toBe(0);
  });
});

describe('卡片身份：不可靠标记的保守处理', () => {
  it('缺少稳定消息标记时使用文本指纹并标记 ambiguous', () => {
    const doc = buildDoc(
      `<div class="ds-assistant-message-main-content">${blockMarkup()}</div>`,
    );
    const identity = identityFor(doc, 0, '/s');

    expect(identity.messageKey.startsWith('fp:')).toBe(true);
    expect(identity.ambiguous).toBe(true);
  });

  it('文本指纹会忽略空白差异，但消息内容变化会更换指纹', () => {
    const spaced = buildDoc(
      `<div class="ds-assistant-message-main-content"><p>第一段\n\n 说明</p>${blockMarkup()}</div>`,
    );
    const compact = buildDoc(
      `<div class="ds-assistant-message-main-content"><p>第一段 说明</p>${blockMarkup()}</div>`,
    );
    const changed = buildDoc(
      `<div class="ds-assistant-message-main-content"><p>第二段 说明</p>${blockMarkup()}</div>`,
    );

    expect(identityFor(spaced, 0, '/s').messageKey).toBe(identityFor(compact, 0, '/s').messageKey);
    expect(identityFor(spaced, 0, '/s').messageKey).not.toBe(
      identityFor(changed, 0, '/s').messageKey,
    );
  });

  it('两条消息共用同一 data-message-id 时全部标记 ambiguous', () => {
    const doc = buildDoc(
      `<div data-message-id="dup"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>` +
        `<div data-message-id="dup"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>`,
    );

    expect(identityFor(doc, 0, '/s').ambiguous).toBe(true);
    expect(identityFor(doc, 1, '/s').ambiguous).toBe(true);
  });

  it('没有候选时返回空映射', () => {
    expect(computeCardIdentities([]).size).toBe(0);
  });
});

describe('卡片身份：键格式与路由读取', () => {
  it('createCardKey 转义分隔符并带上状态版本', () => {
    const key = createCardKey({
      sessionId: 'a|b',
      messageKey: 'vl:x|y',
      duplicateIndex: 2,
      documentHash: 'hash',
    });

    expect(key).toBe('card|1|a%7Cb|vl:x%7Cy|2|hash');
  });

  it('readSessionId 去掉末尾斜杠，无法读取时使用占位符', () => {
    const routed = { location: { pathname: '/a/chat/s/abc/' } } as Document;
    expect(readSessionId(routed)).toBe('/a/chat/s/abc');
    expect(readSessionId({ location: { pathname: '/' } } as Document)).toBe(
      UNKNOWN_SESSION_ID,
    );
  });
});
