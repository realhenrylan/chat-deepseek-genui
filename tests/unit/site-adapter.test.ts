import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEEPSEEK_SITE_ADAPTER,
  STOP_GENERATION_PATH_PREFIX,
  UNKNOWN_SESSION_ID,
} from '../../src/content/site-adapter';
import { findGenuiBlocks } from '../../src/content/detect';

const FIXTURES = join(process.cwd(), 'tests/fixtures/site-variants');

function fixture(name: string): Document {
  return new DOMParser().parseFromString(
    readFileSync(join(FIXTURES, name), 'utf8'),
    'text/html',
  );
}

function withBody(html: string): Document {
  const doc = document.implementation.createHTMLDocument('adapter test');
  doc.body.innerHTML = html;
  return doc;
}

describe('站点适配层', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  describe('页面结构变体', () => {
    it('语言标签哈希类名轮换时仍通过文本识别，标记为 fallback', () => {
      const doc = fixture('rotated-label.html');
      const candidates = DEEPSEEK_SITE_ADAPTER.findCandidates(doc);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].labelSource).toBe('fallback');
      expect(candidates[0].pre?.textContent).toContain('类名轮换变体');
    });

    it('延迟渲染的空 pre 先保留候选，内容补齐后同一适配器读出完整文本', () => {
      const doc = fixture('empty-pre.html');
      const first = DEEPSEEK_SITE_ADAPTER.findCandidates(doc);
      expect(first).toHaveLength(1);
      expect(first[0].pre).not.toBeNull();
      expect(first[0].pre?.textContent).toBe('');

      const content = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"补齐"}]}';
      doc.querySelector('pre')!.textContent = content;
      const second = DEEPSEEK_SITE_ADAPTER.findCandidates(doc);
      expect(second).toHaveLength(1);
      expect(second[0].pre?.textContent).toBe(content);
    });

    it('标签存在但找不到回答容器时，自检区分出「容器外孤立块」', () => {
      const doc = fixture('orphan-label.html');
      const probe = DEEPSEEK_SITE_ADAPTER.probe(doc);

      expect(DEEPSEEK_SITE_ADAPTER.findCandidates(doc)).toEqual([]);
      expect(probe.assistantContainers).toBe(0);
      expect(probe.candidates).toBe(0);
      expect(probe.labelledBlocksOutsideContainers).toBe(1);
      expect(probe.route).toBe('other');
    });

    it('findGenuiBlocks 委托给传入的适配器，默认适配器行为不变', () => {
      const doc = fixture('rotated-label.html');
      expect(findGenuiBlocks(doc)).toHaveLength(1);
      expect(findGenuiBlocks(doc, DEEPSEEK_SITE_ADAPTER)).toHaveLength(1);
    });
  });

  describe('输入框识别（不确定时不猜测）', () => {
    it('唯一的 name=search 是确定目标', () => {
      const doc = withBody('<textarea name="search"></textarea>');
      expect(DEEPSEEK_SITE_ADAPTER.findChatInput(doc)?.getAttribute('name')).toBe('search');
    });

    it('name=search 与 placeholder 候选并存时返回 null（歧义不猜测）', () => {
      const doc = withBody(
        '<textarea name="search"></textarea><textarea placeholder="给 DeepSeek 发送消息"></textarea>',
      );
      expect(DEEPSEEK_SITE_ADAPTER.findChatInput(doc)).toBeNull();
    });

    it('多个同标记候选返回 null，而不是取第一个', () => {
      const doc = withBody(
        '<textarea name="search"></textarea><textarea name="search"></textarea>',
      );
      expect(DEEPSEEK_SITE_ADAPTER.findChatInput(doc)).toBeNull();
    });

    it('隐藏或停用的旧输入框不参与候选', () => {
      const doc = withBody(
        '<textarea name="search" hidden></textarea><textarea placeholder="给 DeepSeek 发送消息"></textarea>',
      );
      const input = DEEPSEEK_SITE_ADAPTER.findChatInput(doc);
      expect(input?.getAttribute('placeholder')).toContain('发送消息');
      expect(DEEPSEEK_SITE_ADAPTER.probe(doc).inputCandidates).toBe(1);
    });

    it('缺少 name 时只回退到取证过的 placeholder 文案', () => {
      const doc = withBody('<textarea placeholder="给 DeepSeek 发送消息"></textarea>');
      expect(DEEPSEEK_SITE_ADAPTER.findChatInput(doc)).not.toBeNull();
    });

    it('无确定标记的 textarea 返回 null，绝不写入反馈框等无关控件', () => {
      const doc = withBody(
        '<textarea placeholder="输入反馈"></textarea><textarea></textarea>',
      );
      expect(DEEPSEEK_SITE_ADAPTER.findChatInput(doc)).toBeNull();
    });
  });

  describe('生成状态信号', () => {
    it('语义标签、停止图标路径与 tooltip 均可识别', () => {
      const labelled = withBody('<button aria-label="停止生成"></button>');
      expect(DEEPSEEK_SITE_ADAPTER.isGenerationActive(labelled)).toBe(true);

      const icon = withBody(
        `<button><svg><path d="${STOP_GENERATION_PATH_PREFIX} rest" /></svg></button>`,
      );
      expect(DEEPSEEK_SITE_ADAPTER.isGenerationActive(icon)).toBe(true);

      const tooltip = withBody('<div class="ds-tooltip">停止生成</div>');
      expect(DEEPSEEK_SITE_ADAPTER.isGenerationActive(tooltip)).toBe(true);

      const idle = withBody('<button aria-label="发送"></button><div class="ds-tooltip">复制</div>');
      expect(DEEPSEEK_SITE_ADAPTER.isGenerationActive(idle)).toBe(false);
    });
  });

  describe('身份标记', () => {
    it('会话只接受 /a/chat/s/<id>，其他路由保守返回未知', () => {
      window.history.replaceState({}, '', '/a/chat/s/abc/');
      expect(DEEPSEEK_SITE_ADAPTER.readSessionId(document)).toBe('/a/chat/s/abc');

      window.history.replaceState({}, '', '/a/chat');
      expect(DEEPSEEK_SITE_ADAPTER.readSessionId(document)).toBe(UNKNOWN_SESSION_ID);
    });

    it('账号标记按稳定属性顺序读取，缺失时为空字符串', () => {
      expect(DEEPSEEK_SITE_ADAPTER.readAccountId(document)).toBe('');

      document.body.innerHTML = '<div data-account-id="acct-9"></div><div data-user-id="user-1"></div>';
      expect(DEEPSEEK_SITE_ADAPTER.readAccountId(document)).toBe('user-1');

      document.body.innerHTML = '<div data-account-id="acct-9"></div>';
      expect(DEEPSEEK_SITE_ADAPTER.readAccountId(document)).toBe('acct-9');
    });

    it('消息键优先虚拟列表 key，其次 message id，都没有时由身份层兜底', () => {
      const doc = withBody(
        '<div data-virtual-list-item-key="v1"><div data-message-id="m1"><div class="ds-assistant-message-main-content"></div></div></div>',
      );
      const container = doc.querySelector('.ds-assistant-message-main-content')!;
      expect(DEEPSEEK_SITE_ADAPTER.readMessageKey(container)).toEqual({
        key: 'vl:v1',
        stable: true,
      });

      doc
        .querySelector('[data-virtual-list-item-key]')!
        .removeAttribute('data-virtual-list-item-key');
      expect(DEEPSEEK_SITE_ADAPTER.readMessageKey(container)).toEqual({
        key: 'mid:m1',
        stable: true,
      });

      const bare = withBody('<div class="ds-assistant-message-main-content"></div>');
      expect(
        DEEPSEEK_SITE_ADAPTER.readMessageKey(
          bare.querySelector('.ds-assistant-message-main-content')!,
        ),
      ).toBeNull();
    });
  });

  describe('自检探针', () => {
    it('只输出数量/布尔值与路由归类', () => {
      const doc = fixture('rotated-label.html');
      const probe = DEEPSEEK_SITE_ADAPTER.probe(doc);

      expect(probe).toMatchObject({
        assistantContainers: 1,
        codeBlocks: 1,
        labelledBlocks: 1,
        candidates: 1,
        candidatesWithPre: 1,
        inputFound: true,
        generationActive: false,
        route: 'other',
      });
      for (const value of Object.values(probe)) {
        expect(['number', 'boolean', 'string']).toContain(typeof value);
      }
      // route 是唯一的字符串字段，且只有两个固定取值。
      expect(['chat', 'other']).toContain(probe.route);
    });

    it('聊天路由归类为 chat', () => {
      window.history.replaceState({}, '', '/a/chat/s/abc');
      document.body.innerHTML = '';
      expect(DEEPSEEK_SITE_ADAPTER.probe(document).route).toBe('chat');
    });
  });
});
