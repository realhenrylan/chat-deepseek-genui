/**
 * 构建期 genui 校验器代码生成（阶段 2）。
 *
 * 背景：MV3 内容脚本运行在没有 'unsafe-eval' 的 CSP 下，Ajv 的运行时
 * 编译（new Function）会抛 EvalError —— e2e 在 Edge/Chrome 实测均失败。
 * 因此改为构建期用 Ajv standalone 生成纯函数校验器（运行时零 eval /
 * new Function），产物是普通 ESM 模块源码，随 content.js 一起打包。
 *
 * 用法：
 *   node scripts/gen-validator.ts          生成 src/protocol/genui-validator.generated.ts
 *   node scripts/gen-validator.ts --check  只校验产物是否与当前 schema 一致（不一致退出码 1）
 *
 * schema 变更后必须重新生成并提交产物；tests/unit/generated-validator.test.ts
 * 会断言产物与重新生成的输出逐字节一致（换行统一为 LF 后比较）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { genuiSchema } from '../src/protocol/schema.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 生成产物路径（绝对路径）。 */
export const GENERATED_FILE = join(root, 'src', 'protocol', 'genui-validator.generated.ts');

const HEADER = `/* eslint-disable */
// @ts-nocheck
/**
 * 本文件由 scripts/gen-validator.ts 生成，请勿手工编辑。
 * 重新生成：npm run gen-validator（schema 变更后必须执行并提交）。
 * 生成物是纯函数校验器：运行时零 eval / new Function —— MV3 内容脚本
 * CSP 不允许 'unsafe-eval'，Ajv 无法在浏览器里编译 schema。
 */
`;

/** 用当前 schema 生成校验器模块源码（Ajv codegen 确定性输出，供产物与测试比对）。 */
export function generateValidatorSource(): string {
  const ajv = new Ajv({ allErrors: true, strict: true, code: { source: true, esm: true } });
  const validate = ajv.compile(genuiSchema);
  const code = standaloneCode(ajv, validate);
  return `${HEADER}${code}\n`;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  const source = generateValidatorSource().replace(/\r\n/g, '\n');
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(GENERATED_FILE, 'utf8').replace(/\r\n/g, '\n');
    } catch {
      // 产物缺失视为不一致
    }
    if (current !== source) {
      console.error(
        `校验器产物与 schema 不一致：${GENERATED_FILE}\n请运行 npm run gen-validator 并提交产物。`,
      );
      process.exit(1);
    }
    console.log('校验器产物与当前 schema 一致');
  } else {
    writeFileSync(GENERATED_FILE, source, 'utf8');
    console.log(`已生成 ${GENERATED_FILE}`);
  }
}
