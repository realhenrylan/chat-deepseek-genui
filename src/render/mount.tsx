import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { GenuiDocument } from '../protocol/types';
import type { CardUiState, PlanClearResult, PlanSaveResult } from '../runtime/card-state';
import type { CardStateStore } from '../runtime/card-state-store';
import type { ScenarioPort } from '../runtime/scenario';
import cardCss from './card.css?inline';
import { CardErrorBoundary } from './boundaries';
import { Card } from './Card';
import { ElementRegistry } from './registry';
import { attachThemeAttribute } from './theme';

/**
 * Card 挂载（阶段 2）：Shadow DOM 局部挂载 + 样式隔离。
 *
 * - host 挂在原始代码块之前的同级位置，卡片与页面其余部分互不影响；
 * - open shadow root + ?inline 注入样式，页面 CSS 无法渗入、卡片样式
 *   也无法泄漏到页面（阶段 2 样式隔离的实现方式）；
 * - 首次渲染用 flushSync 同步完成，内容脚本执行后卡片立即可见；
 * - CardErrorBoundary 是卡片级失败的唯一兜底，onFatal 由调用方
 *   （enhance）实现「恢复原始块」。
 */

export interface MountCardOptions {
  /** 已通过协议校验的 genui 文档。 */
  document: GenuiDocument;
  /** 原始代码块文本，用于页脚透明度说明。 */
  rawJson: string;
  /** 元素注册表；缺省为 ElementRegistry.withDefaults()。 */
  registry?: ElementRegistry;
  /** 「查看原始 JSON」切换回调。 */
  onToggleRaw?: (showRaw: boolean) => void;
  /** 卡片级渲染异常回调（恢复原始块的入口）。 */
  onFatal?: (error: Error) => void;
  /**
   * 「继续讨论」回调（阶段 6，用户主动点击时调用）：生产接线为
   * content/followup.fillContinueIntoInput，返回填充结果用于卡片反馈。
   */
  onContinue?: (summary: string) => 'filled' | 'appended' | 'no-input' | 'unavailable';
  /** 稳定卡片身份与页面内状态仓库（issue #2）；缺省时 Card 退化为内部状态。 */
  cardKey?: string;
  stateStore?: CardStateStore;
  /** 从保存方案恢复出的初始状态（已按文档兼容性校验）。 */
  initialState?: CardUiState;
  /** 已保存方案的时间；null 表示没有可恢复的本机方案。 */
  savedPlanAt?: number | null;
  /** 用户主动「保存方案」/清除本机方案。 */
  onSavePlan?: (state: CardUiState) => Promise<PlanSaveResult>;
  onClearPlan?: () => Promise<PlanClearResult>;
  /** 方案工作台端口（issue #6）；缺省时不渲染方案面板。 */
  scenarioPort?: ScenarioPort | null;
}

export interface MountedCard {
  /** 卸载 React 根（host 的移除由调用方负责）。 */
  unmount(): void;
}

export function mountCard(host: HTMLElement, options: MountCardOptions): MountedCard {
  const doc = host.ownerDocument;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.replaceChildren();

  const style = doc.createElement('style');
  style.textContent = cardCss;
  shadow.appendChild(style);

  const container = doc.createElement('div');
  container.className = 'genui-card-root';
  shadow.appendChild(container);
  // 阶段 6：跟随站点亮暗主题；属性写在卡片根上，阴影内样式据此切换。
  const disposeTheme = attachThemeAttribute(container, doc);

  const registry = options.registry ?? ElementRegistry.withDefaults();
  const root: Root = createRoot(container);
  flushSync(() => {
    root.render(
      <CardErrorBoundary onFatal={options.onFatal}>
        <Card
          document={options.document}
          rawJson={options.rawJson}
          registry={registry}
          onToggleRaw={options.onToggleRaw}
          onContinue={options.onContinue}
          cardKey={options.cardKey}
          stateStore={options.stateStore}
          initialState={options.initialState}
          savedPlanAt={options.savedPlanAt}
          onSavePlan={options.onSavePlan}
          onClearPlan={options.onClearPlan}
          scenarioPort={options.scenarioPort}
        />
      </CardErrorBoundary>,
    );
  });

  return {
    unmount: () => {
      disposeTheme();
      root.unmount();
    },
  };
}
