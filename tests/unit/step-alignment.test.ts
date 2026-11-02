import { describe, expect, it } from 'vitest';
import { isStepAligned } from '../../src/protocol/step';

describe('isStepAligned', () => {
  it.each([
    [1_000_000_000.5, 0, 1],
    [1_000_000_000_000.5, 0, 1],
    [999_999_999_999.5, 0, 1],
  ])('拒绝大步数范围中的半步 value=%s min=%s step=%s', (value, min, step) => {
    expect(isStepAligned(value, min, step)).toBe(false);
  });

  it.each([
    [1_000_000_000_000, 0, 1],
    [0.3, 0, 0.1],
    [0.30000000000000004, 0, 0.1],
    [1_005, 5, 10],
    [1_015, 5, 10],
    [-999.5, -1_000, 0.5],
    [-1_000_000_000_000, -1_000_000_000_000, 1],
    [1_000_000_000_010, 1_000_000_000_000, 1],
    [1_000_000_000_000, 0, 0.1],
    [1_000_000_000_000, 0, 0.01],
    [1_000_000_000_000, 0, 0.001],
    [1_000_000_000_000, 0, 0.0001],
    [1_000_000_000_000 - 0.001, 0, 0.001],
  ])('接受对齐值 value=%s min=%s step=%s', (value, min, step) => {
    expect(isStepAligned(value, min, step)).toBe(true);
  });

  it.each([
    [0.35, 0, 0.1],
    [1_012, 5, 10],
    [-999.25, -1_000, 0.5],
    [-999_999_999_999.75, -1_000_000_000_000, 1],
    [1_000_000_000_000 + 0.0005, 0, 0.001],
  ])('拒绝未对齐值 value=%s min=%s step=%s', (value, min, step) => {
    expect(isStepAligned(value, min, step)).toBe(false);
  });

  it.each([
    [1, 0, 0],
    [1, 0, -1],
    [Number.NaN, 0, 1],
    [Number.POSITIVE_INFINITY, 0, 1],
    [Number.NEGATIVE_INFINITY, 0, 1],
    [1, Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY, 1],
    [1, 0, Number.NaN],
    [1, 0, Number.POSITIVE_INFINITY],
  ])('对无效输入返回 false value=%s min=%s step=%s', (value, min, step) => {
    expect(isStepAligned(value, min, step)).toBe(false);
  });
});
