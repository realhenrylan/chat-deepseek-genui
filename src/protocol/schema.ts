import { LIMITS } from './types.ts';

/**
 * genui v1 JSON Schema（阶段 2）。
 *
 * 白名单原则：根与元素均 additionalProperties: false，未知字段一律判为
 * schema-violation——宁可回退到原始代码块，也不猜测模型的意图。
 * version 用 integer ≥ 1 表达「至少是 1」，具体是否等于当前版本由
 * validate 的后置检查决定（不等于 → unsupported-version）。
 */
export const genuiSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'version', 'elements'],
  properties: {
    type: { type: 'string', const: 'genui' },
    version: { type: 'integer', minimum: 1 },
    title: { type: 'string', maxLength: LIMITS.maxTitleLength },
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.maxElements,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'value'],
        properties: {
          kind: { type: 'string', const: 'text' },
          value: { type: 'string', maxLength: LIMITS.maxTextLength },
        },
      },
    },
  },
};
