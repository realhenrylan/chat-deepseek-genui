import type { GenuiWidget } from './types.ts';
import type { GenuiV5Document } from '../types.ts';

export function wrapWidgetAsDocument(widget: GenuiWidget): GenuiV5Document {
  // 建立一个等效的 v5 document，使得现有渲染管线在未升级内联渲染前无缝运行
  return {
    type: 'genui',
    version: 5,
    title: (widget as { label?: string; title?: string }).label ?? (widget as { title?: string }).title,
    state: [],
    derived: [],
    models: [],
    elements: [
      {
        kind: 'text',
        value: JSON.stringify(widget),
      },
    ],
  };
}
