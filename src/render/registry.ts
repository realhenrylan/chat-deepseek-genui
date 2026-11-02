import type { ComponentType } from 'react';
import type { TextElement } from '../protocol/types';
import { TextElementView } from './elements';

/** 元素视图组件：接收一个已通过协议校验的元素。 */
export type ElementComponent = ComponentType<{ element: TextElement }>;

/**
 * kind → 组件 注册表（阶段 2）。
 *
 * v1 只注册 text；后续阶段按需扩展（图表、列表等）。查找结果为
 * undefined 时 Card 渲染占位而不是崩溃，注册表因此也是防御层的一部分。
 */
export class ElementRegistry {
  private readonly components = new Map<string, ElementComponent>();

  register(kind: string, component: ElementComponent): this {
    this.components.set(kind, component);
    return this;
  }

  get(kind: string): ElementComponent | undefined {
    return this.components.get(kind);
  }

  /** v1 默认注册表：仅 text。 */
  static withDefaults(): ElementRegistry {
    return new ElementRegistry().register('text', TextElementView);
  }
}
