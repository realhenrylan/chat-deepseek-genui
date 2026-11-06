import type { GenuiWidget } from '../../protocol/widget/types';
import type { InlineStateBus } from './store';

export interface InlineWidgetProps<T extends GenuiWidget = GenuiWidget> {
  widget: T;
  rawJson?: string;
  bus?: InlineStateBus;
  onToggleRaw?: (showRaw: boolean) => void;
}
