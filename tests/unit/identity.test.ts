import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_ACCOUNT_ID,
  UNKNOWN_SESSION_ID,
  accountScope,
  computeCardIdentities,
  createCardKey,
  readAccountId,
  readSessionId,
  type CardIdentity,
} from '../../src/content/identity';
import type { GenuiBlockCandidate } from '../../src/content/detect';

/**
 * issue #2：卡片稳定身份。
 *
 * 身份必须能区分「同标题、不同消息」；消息键重复、文本指纹兜底或同消息
 * 出现完全相同的文档时，不能再共享状态键，改为元素级一次性键；账号/会话
 * 不可验证时禁止本机保存，但页面内恢复仍可继续。
 */

const RAW = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"同标题"}]}';
const ACCOUNT = 'user-1';

function blockMarkup(raw: string = RAW): string {
  return `<div class="md-code-block"><div class="md-code-block-banner-wrap"><span class="d813de27">genui</span></div><pre><span>${raw}</span></pre></div>`;
}

function buildDoc(body: string): Document {
  return new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body>${body}</body></html>`,
    'text/html',
  );
}

function candidates(doc: Document): GenuiBlockCandidate[] {
  const list: GenuiBlockCandidate[] = [];
  for (const container of doc.querySelectorAll('div.ds-assistant-message-main-content')) {
    for (const block of container.querySelectorAll<HTMLElement>('div.md-code-block')) {
      list.push({
        container,
        block,
        pre: block.querySelector('pre'),
        labelSource: 'primary',
      });
    }
  }
  return list;
}

function identitiesFor(
  doc: Document,
  options: { sessionId?: string; accountId?: string } = {},
): CardIdentity[] {
  const list = candidates(doc);
  const map = computeCardIdentities(list, { document: doc, ...options });
  return list.map((candidate) => {
    const identity = map.get(candidate.block);
    if (!identity) throw new Error('缺少身份');
    return identity;
  });
}

describe('卡片身份：会话与消息', () => {
  it('不同虚拟列表消息、同标题同内容也互不串用', () => {
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>` +
        `<div data-virtual-list-item-key="v2"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>`,
    );

    const [first, second] = identitiesFor(doc, { sessionId: '/a/chat/s/session-1' });
    expect(first?.messageKey).toBe('vl:v1');
    expect(second?.messageKey).toBe('vl:v2');
    expect(first?.key).not.toBe(second?.key);
    expect(first?.ambiguous).toBe(false);
    expect(second?.ambiguous).toBe(false);
  });

  it('同一元素跨扫描键稳定，节点替换前可恢复状态', () => {
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>`,
    );

    expect(identitiesFor(doc, { sessionId: '/a/chat/s/a' })[0]?.key).toBe(
      identitiesFor(doc, { sessionId: '/a/chat/s/a' })[0]?.key,
    );
  });

  it('同一会话切换路由后键不同；未知会话只禁止本机保存', () => {
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>`,
    );

    const first = identitiesFor(doc, { sessionId: '/a/chat/s/a' })[0];
    const second = identitiesFor(doc, { sessionId: '/a/chat/s/b' })[0];
    expect(first?.key).not.toBe(second?.key);

    const unknown = identitiesFor(doc)[0];
    expect(unknown?.sessionId).toBe(UNKNOWN_SESSION_ID);
    expect(unknown?.ambiguous).toBe(false);
    expect(unknown?.persistable).toBe(false);
  });

  it('消息键优先虚拟列表 key，其次 data-message-id', () => {
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1" data-message-id="m1"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>` +
        `<div data-message-id="m2"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>`,
    );

    const [first, second] = identitiesFor(doc, { sessionId: '/a/chat/s/s' });
    expect(first?.messageKey).toBe('vl:v1');
    expect(second?.messageKey).toBe('mid:m2');
  });

  it('同一消息内完全相同的文档不再靠序号区分，转为元素级键', () => {
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1"><div class="ds-assistant-message-main-content">${blockMarkup()}${blockMarkup()}</div></div>`,
    );

    const first = identitiesFor(doc, { sessionId: '/a/chat/s/s' });
    const second = identitiesFor(doc, { sessionId: '/a/chat/s/s' });
    expect(first).toHaveLength(2);
    expect(first[0]?.ambiguous).toBe(true);
    expect(first[1]?.ambiguous).toBe(true);
    expect(first[0]?.key).not.toBe(first[1]?.key);
    // 元素级键仍在同一元素上跨扫描稳定（WeakMap），但节点替换后即失效。
    expect(first[0]?.key).toBe(second[0]?.key);
    expect(first[1]?.key).toBe(second[1]?.key);
    expect(first[0]?.persistable).toBe(false);
  });

  it('删除前面的重复卡不会让后面的卡片继承状态', () => {
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1"><div class="ds-assistant-message-main-content">${blockMarkup()}${blockMarkup()}</div></div>`,
    );

    const before = identitiesFor(doc, { sessionId: '/a/chat/s/s' });
    const secondBlock = doc.querySelectorAll('div.md-code-block')[1];
    secondBlock?.remove();

    const after = identitiesFor(doc, { sessionId: '/a/chat/s/s' });
    expect(after).toHaveLength(1);
    expect(after[0]?.key).toBe(before[0]?.key);
    expect(after[0]?.key).not.toBe(before[1]?.key);
    expect(after[0]?.ambiguous).toBe(true);
  });

  it('同一消息的多张不同文档都从 0 编号，不按卡片序号漂移', () => {
    const other = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"另一张"}]}';
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1"><div class="ds-assistant-message-main-content">${blockMarkup()}${blockMarkup(other)}</div></div>`,
    );

    const [first, second] = identitiesFor(doc, { sessionId: '/a/chat/s/s' });
    expect(first?.duplicateIndex).toBe(0);
    expect(second?.duplicateIndex).toBe(0);
    expect(first?.ambiguous).toBe(false);
    expect(second?.ambiguous).toBe(false);
  });
});

describe('卡片身份：不可靠标记的保守处理', () => {
  it('缺少稳定消息标记时使用文本指纹并标记 ambiguous', () => {
    const doc = buildDoc(
      `<div class="ds-assistant-message-main-content">${blockMarkup()}</div>`,
    );
    const identity = identitiesFor(doc, { sessionId: '/a/chat/s/s' })[0];

    expect(identity?.messageKey.startsWith('fp:')).toBe(true);
    expect(identity?.ambiguous).toBe(true);
    expect(identity?.key.startsWith('amb|')).toBe(true);
    expect(identity?.persistable).toBe(false);
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

    const first = identitiesFor(spaced, { sessionId: '/s' })[0];
    const second = identitiesFor(compact, { sessionId: '/s' })[0];
    const third = identitiesFor(changed, { sessionId: '/s' })[0];
    expect(first?.messageKey).toBe(second?.messageKey);
    expect(first?.messageKey).not.toBe(third?.messageKey);
  });

  it('两条消息共用同一 data-message-id 时全部转元素级键，互不共享', () => {
    const doc = buildDoc(
      `<div data-message-id="dup"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>` +
        `<div data-message-id="dup"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>`,
    );

    const [first, second] = identitiesFor(doc, { sessionId: '/a/chat/s/s' });
    expect(first?.ambiguous).toBe(true);
    expect(second?.ambiguous).toBe(true);
    expect(first?.key).not.toBe(second?.key);
  });

  it('没有候选时返回空映射', () => {
    expect(computeCardIdentities([]).size).toBe(0);
  });
});

describe('卡片身份：账号作用域', () => {
  it('账号标记哈希后进入键，原始 id 不落盘', () => {
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1" data-user-id="${ACCOUNT}"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>`,
    );

    expect(readAccountId(doc)).toBe(ACCOUNT);
    const identity = identitiesFor(doc, { sessionId: '/a/chat/s/s' })[0];
    expect(identity?.accountId).toBe(accountScope(ACCOUNT));
    expect(identity?.accountId).not.toContain(ACCOUNT);
    expect(identity?.persistable).toBe(true);
  });

  it('账号标记缺失时禁止本机保存，但页面内键仍稳定', () => {
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>`,
    );

    const identity = identitiesFor(doc, { sessionId: '/a/chat/s/s' })[0];
    expect(identity?.accountId).toBe(UNKNOWN_ACCOUNT_ID);
    expect(identity?.ambiguous).toBe(false);
    expect(identity?.persistable).toBe(false);
    expect(identitiesFor(doc, { sessionId: '/a/chat/s/s' })[0]?.key).toBe(identity?.key);
  });

  it('不同账号的同一消息得到不同键', () => {
    const doc = buildDoc(
      `<div data-virtual-list-item-key="v1"><div class="ds-assistant-message-main-content">${blockMarkup()}</div></div>`,
    );

    const first = identitiesFor(doc, { sessionId: '/a/chat/s/s', accountId: 'u1' })[0];
    const second = identitiesFor(doc, { sessionId: '/a/chat/s/s', accountId: 'u2' })[0];
    expect(first?.key).not.toBe(second?.key);
    expect(first?.persistable).toBe(true);
  });
});

describe('卡片身份：键格式与路由读取', () => {
  it('createCardKey 转义分隔符并带上账号段与状态版本', () => {
    const key = createCardKey({
      accountId: 'acct',
      sessionId: 'a|b',
      messageKey: 'vl:x|y',
      duplicateIndex: 2,
      documentHash: 'hash',
    });

    expect(key).toBe('card|1|acct|a%7Cb|vl:x%7Cy|2|hash');
  });

  it('readSessionId 只接受会话路由，其他路由与末尾斜杠都归一或拒绝', () => {
    const routed = { location: { pathname: '/a/chat/s/abc/' } } as Document;
    expect(readSessionId(routed)).toBe('/a/chat/s/abc');
    expect(readSessionId({ location: { pathname: '/' } } as Document)).toBe(
      UNKNOWN_SESSION_ID,
    );
    expect(readSessionId({ location: { pathname: '/a/chat' } } as Document)).toBe(
      UNKNOWN_SESSION_ID,
    );
    expect(readSessionId({ location: { pathname: '/a/chat/s/a/b' } } as Document)).toBe(
      UNKNOWN_SESSION_ID,
    );
  });
});
