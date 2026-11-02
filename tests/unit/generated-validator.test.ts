import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GENERATED_FILE, generateValidatorSource } from '../../scripts/gen-validator';

// 构建期代码生成产物必须与当前 schema 一致：schema 变更后忘记运行
// npm run gen-validator 会在这里立即失败（而不是带着陈旧校验器发布）。

describe('genui 校验器代码生成产物', () => {
  it('与当前 schema 重新生成的输出一致（换行统一为 LF 后逐字节比较）', () => {
    const onDisk = readFileSync(GENERATED_FILE, 'utf8').replace(/\r\n/g, '\n');
    expect(onDisk).toBe(generateValidatorSource());
  });

  it('产物不含 eval / new Function（MV3 内容脚本 CSP 禁止 unsafe-eval）', () => {
    const source = readFileSync(GENERATED_FILE, 'utf8');
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/new\s+Function\s*\(/);
  });
});
