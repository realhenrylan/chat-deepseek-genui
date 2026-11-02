import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// 阶段 1 工具链验证：React / JSX 转换 / jsdom / Testing Library 可用。
describe('React 工具链', () => {
  it('渲染 JSX 并读取内容', () => {
    render(<p data-testid="smoke">React 渲染正常</p>);
    expect(screen.getByTestId('smoke')).toHaveTextContent('React 渲染正常');
  });
});
