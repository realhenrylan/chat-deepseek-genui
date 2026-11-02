import { Component, type ReactNode } from 'react';
import { LOG_PREFIX } from '../content/lifecycle';

/**
 * 两级错误边界（阶段 2）：
 *
 * - ElementErrorBoundary：单个元素组件抛错 → 该元素显示占位提示，
 *   卡片其余部分（含其他元素）存活——组件异常隔离；
 * - CardErrorBoundary：卡片级渲染抛错 → 通过 onFatal 通知挂载方
 *   恢复原始代码块——失败安全回退，绝不把半成品 UI 留在页面上。
 */

interface ElementBoundaryProps {
  children: ReactNode;
}

interface ElementBoundaryState {
  failed: boolean;
}

export class ElementErrorBoundary extends Component<ElementBoundaryProps, ElementBoundaryState> {
  public override state: ElementBoundaryState = { failed: false };

  public static getDerivedStateFromError(): ElementBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(error: Error): void {
    console.error(`${LOG_PREFIX} element render failed`, error);
  }

  public override render(): ReactNode {
    if (this.state.failed) {
      return (
        <p className="genui-element-fallback" role="alert">
          该元素渲染失败，卡片其余部分不受影响
        </p>
      );
    }
    return this.props.children;
  }
}

interface CardBoundaryProps {
  onFatal?: (error: Error) => void;
  children: ReactNode;
}

interface CardBoundaryState {
  failed: boolean;
}

export class CardErrorBoundary extends Component<CardBoundaryProps, CardBoundaryState> {
  public override state: CardBoundaryState = { failed: false };

  public static getDerivedStateFromError(): CardBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(error: Error): void {
    // 不在 React 渲染期间卸载根：推迟到微任务，由挂载方恢复原始块。
    queueMicrotask(() => {
      if (this.props.onFatal) {
        this.props.onFatal(error);
      } else {
        console.error(`${LOG_PREFIX} card render failed`, error);
      }
    });
  }

  public override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
