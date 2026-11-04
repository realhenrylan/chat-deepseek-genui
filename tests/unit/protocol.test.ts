import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  PROTOCOL_VERSION,
  type GenuiFailureCode,
  type ParseGenuiResult,
} from '../../src/protocol/types';
import { parseGenui } from '../../src/protocol/validate';

/**
 * 阶段 2：genui v1 协议解析与验证（Red → Green 先行测试）。
 *
 * 覆盖开发任务要求的边界：
 * 合法/非法 JSON、未知类型（root type 与 element kind）、额外字段、规模限制
 * （原始体积、嵌套深度、元素数量、字符串长度），以及协议版本检查。
 */

const VALID = '{"type":"genui","version":1,"elements":[{"kind":"text","value":"你好"}]}';

/** 断言失败结果并返回 detail，便于继续检查错误信息内容。 */
function expectFailure(result: ParseGenuiResult, code: GenuiFailureCode): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('期望失败，实际成功');
  expect(result.code).toBe(code);
  expect(result.detail.length).toBeGreaterThan(0);
  return result.detail;
}

describe('genui 协议解析与验证', () => {
  describe('合法输入', () => {
    it('接受阶段 0 实测的模型输出样本', () => {
      const result = parseGenui(VALID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.document.type).toBe('genui');
      expect(result.document.version).toBe(1);
      expect(result.document.elements).toEqual([{ kind: 'text', value: '你好' }]);
    });

    it('接受带 title 的文档', () => {
      const result = parseGenui(
        '{"type":"genui","version":1,"title":"预算规划","elements":[{"kind":"text","value":"合计 100"}]}',
      );

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.document.title).toBe('预算规划');
    });

    it('接受格式化的多行 JSON（代码块跨行渲染时行间换行不影响解析）', () => {
      const pretty = [
        '{',
        '  "type": "genui",',
        '  "version": 1,',
        '  "elements": [',
        '    { "kind": "text", "value": "第一行" }',
        '  ]',
        '}',
      ].join('\n');

      expect(parseGenui(pretty).ok).toBe(true);
    });

    it('接受恰好达到元素数量上限的文档', () => {
      const elements = Array.from({ length: LIMITS.maxElements }, (_, index) => ({
        kind: 'text',
        value: `第 ${index} 项`,
      }));

      const result = parseGenui(JSON.stringify({ type: 'genui', version: 1, elements }));

      expect(result.ok).toBe(true);
    });

    it('接受恰好达到长度上限的 title 与 value', () => {
      const result = parseGenui(
        JSON.stringify({
          type: 'genui',
          version: 1,
          title: 't'.repeat(LIMITS.maxTitleLength),
          elements: [{ kind: 'text', value: 'a'.repeat(LIMITS.maxTextLength) }],
        }),
      );

      expect(result.ok).toBe(true);
    });
  });

  describe('非法 JSON', () => {
    it('截断的 JSON 返回 invalid-json', () => {
      expectFailure(parseGenui('{"type":"genui",'), 'invalid-json');
    });

    it('非 JSON 文本返回 invalid-json', () => {
      expectFailure(parseGenui('这不是 JSON'), 'invalid-json');
    });

    it('空字符串返回 invalid-json', () => {
      expectFailure(parseGenui(''), 'invalid-json');
    });

    it('根为数组返回 schema-violation 而非解析错误', () => {
      expectFailure(parseGenui('["genui",1]'), 'schema-violation');
    });

    it('根为字符串返回 schema-violation', () => {
      expectFailure(parseGenui('"genui"'), 'schema-violation');
    });
  });

  describe('协议字段与未知类型', () => {
    it('未知 root type 返回 schema-violation 并指出字段路径', () => {
      const detail = expectFailure(
        parseGenui('{"type":"widget","version":1,"elements":[{"kind":"text","value":"x"}]}'),
        'schema-violation',
      );
      expect(detail).toContain('/type');
    });

    it('未知 element kind 返回 schema-violation 并指出元素路径', () => {
      const detail = expectFailure(
        parseGenui('{"type":"genui","version":1,"elements":[{"kind":"chart","value":"x"}]}'),
        'schema-violation',
      );
      expect(detail).toContain('/elements/0/kind');
    });

    it('元素不是对象返回 schema-violation', () => {
      expectFailure(
        parseGenui('{"type":"genui","version":1,"elements":["text"]}'),
        'schema-violation',
      );
    });

    it('缺少 elements 返回 schema-violation', () => {
      expectFailure(parseGenui('{"type":"genui","version":1}'), 'schema-violation');
    });

    it('空 elements 返回 schema-violation（卡片必须至少有一个元素）', () => {
      expectFailure(
        parseGenui('{"type":"genui","version":1,"elements":[]}'),
        'schema-violation',
      );
    });

    it('版本为字符串返回 schema-violation', () => {
      expectFailure(
        parseGenui('{"type":"genui","version":"1","elements":[{"kind":"text","value":"x"}]}'),
        'schema-violation',
      );
    });

    it('版本 0 返回 schema-violation（schema 要求 integer ≥ 1）', () => {
      expectFailure(
        parseGenui('{"type":"genui","version":0,"elements":[{"kind":"text","value":"x"}]}'),
        'schema-violation',
      );
    });

    it('未来版本返回 unsupported-version 并在 detail 中给出版本号', () => {
      const detail = expectFailure(
        parseGenui('{"type":"genui","version":7,"elements":[{"kind":"text","value":"x"}]}'),
        'unsupported-version',
      );
      expect(detail).toContain('7');
      expect(detail).toContain(String(PROTOCOL_VERSION));
    });
  });

  describe('额外字段', () => {
    it('根上的未知字段返回 schema-violation 并指出字段名', () => {
      const detail = expectFailure(
        parseGenui(
          '{"type":"genui","version":1,"elements":[{"kind":"text","value":"x"}],"evil":1}',
        ),
        'schema-violation',
      );
      expect(detail).toContain('evil');
    });

    it('元素上的未知字段返回 schema-violation 并指出字段名', () => {
      const detail = expectFailure(
        parseGenui(
          '{"type":"genui","version":1,"elements":[{"kind":"text","value":"x","onClick":"alert(1)"}]}',
        ),
        'schema-violation',
      );
      expect(detail).toContain('onClick');
    });
  });

  describe('规模限制', () => {
    it('原始内容超过长度上限返回 too-large（先于解析检查）', () => {
      const oversized = ' '.repeat(LIMITS.maxRawLength + 1) + VALID;

      expectFailure(parseGenui(oversized), 'too-large');
    });

    it('嵌套深度超过上限返回 too-deep（先于解析检查）', () => {
      const tooDeep =
        '['.repeat(LIMITS.maxDepth + 1) + ']'.repeat(LIMITS.maxDepth + 1);

      expectFailure(parseGenui(tooDeep), 'too-deep');
    });

    it('单个 value 超长返回 schema-violation 并指出元素路径', () => {
      const detail = expectFailure(
        parseGenui(
          JSON.stringify({
            type: 'genui',
            version: 1,
            elements: [{ kind: 'text', value: 'a'.repeat(LIMITS.maxTextLength + 1) }],
          }),
        ),
        'schema-violation',
      );
      expect(detail).toContain('/elements/0/value');
    });

    it('title 超长返回 schema-violation', () => {
      const detail = expectFailure(
        parseGenui(
          JSON.stringify({
            type: 'genui',
            version: 1,
            title: 't'.repeat(LIMITS.maxTitleLength + 1),
            elements: [{ kind: 'text', value: 'x' }],
          }),
        ),
        'schema-violation',
      );
      expect(detail).toContain('/title');
    });

    it('元素数量超过上限返回 schema-violation', () => {
      const elements = Array.from({ length: LIMITS.maxElements + 1 }, (_, index) => ({
        kind: 'text',
        value: `第 ${index} 项`,
      }));

      expectFailure(
        parseGenui(JSON.stringify({ type: 'genui', version: 1, elements })),
        'schema-violation',
      );
    });
  });
});
