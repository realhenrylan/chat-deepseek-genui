import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../src/render/card.css'),
  'utf8',
);

describe('card 视觉变量', () => {
  it('提供 #11 基础语义变量，并由暗色块覆盖', () => {
    expect(css).toContain('--genui-color-accent: #4d6bfe');
    expect(css).toContain('--genui-space-6: 24px');
    expect(css).toContain('--genui-radius-lg: 12px');
    expect(css).toContain('--genui-type-title: 16px');
    expect(css).toContain('--genui-type-result: 20px');
    expect(css.match(/data-site-theme='dark'/g)).toHaveLength(1);
  });

  it('颜色统一引用变量，不再保留旧品牌蓝或裸状态底色', () => {
    expect(css).not.toContain('#3988ff');
    expect(css).not.toMatch(/background:\s*rgba\(194,\s*65,\s*58/);
    expect(css).not.toMatch(/background:\s*rgba\(217,\s*119,\s*6/);
    expect(css).toContain('--genui-color-accent: #7c9aff');
    expect(css).toContain('box-shadow: inset 3px 0 0 var(--genui-color-accent)');
  });

  it('section 移除封闭四周描边盒子，columns 依托容器查询自适应', () => {
    expect(css).toContain('.genui-columns-container');
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('@container (min-width: 38rem)');
    expect(css).toContain('@container (min-width: 58rem)');
    expect(css).not.toContain('@media (max-width: 560px)');
    expect(css).not.toMatch(/\.genui-section\s*\{[^}]*border:\s*1px\s+solid[^}]*border-radius:\s*10px/);
    expect(css).toContain('border-top: 1px solid var(--genui-color-border-subtle)');
  });
});
