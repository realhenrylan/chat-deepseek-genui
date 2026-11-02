import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

// 阶段 1 工具链验证：JSON Schema 验证（Ajv）可用。
// 正式的 genui 协议 Schema 在阶段 2 定义，此处用最小样本验证工具行为本身。

const sampleSchema = {
  type: 'object',
  properties: {
    type: { const: 'genui' },
    version: { type: 'integer', minimum: 1 },
    label: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['type', 'version'],
  additionalProperties: false,
} as const;

function createValidator() {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(sampleSchema);
}

describe('Schema 验证工具链（Ajv）', () => {
  it('接受合法样本', () => {
    const validate = createValidator();
    expect(validate({ type: 'genui', version: 1, label: '你好' })).toBe(true);
  });

  it('拒绝缺失必填字段的样本', () => {
    const validate = createValidator();
    expect(validate({ type: 'genui' })).toBe(false);
  });

  it('拒绝未知字段（additionalProperties: false）', () => {
    const validate = createValidator();
    expect(validate({ type: 'genui', version: 1, evil: 'x' })).toBe(false);
  });

  it('拒绝错误的 version 取值', () => {
    const validate = createValidator();
    expect(validate({ type: 'genui', version: 0 })).toBe(false);
  });

  it('启用 ajv-formats 后校验 date-time 格式', () => {
    const validate = createValidator();
    expect(validate({ type: 'genui', version: 1, createdAt: '2026-11-02T00:00:00Z' })).toBe(true);
    expect(validate({ type: 'genui', version: 1, createdAt: 'not-a-date' })).toBe(false);
  });
});
