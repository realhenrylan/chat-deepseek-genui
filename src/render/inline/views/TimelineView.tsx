import type { TimelineItem, TimelineWidget } from '../../../protocol/widget/types';

function TimelineNode({ item }: { item: TimelineItem }) {
  return (
    <div className={`inline-timeline-item ${item.highlight ? 'highlighted' : ''}`}>
      <span className="inline-timeline-dot" aria-hidden="true" />
      <div className="inline-timeline-main">
        <div className="inline-timeline-time">{item.time}</div>
        <div className="inline-timeline-title">{item.title}</div>
        {item.desc && <div className="inline-timeline-desc">{item.desc}</div>}
      </div>
    </div>
  );
}

export function TimelineView({ widget }: { widget: TimelineWidget }) {
  return (
    <div className="inline-timeline-body">
      {widget.title && (
        <div className="inline-widget-header">
          <div className="inline-widget-title">{widget.title}</div>
        </div>
      )}
      <div className="inline-timeline-list">
        {widget.items.map((item, idx) => (
          <TimelineNode key={idx} item={item} />
        ))}
      </div>
    </div>
  );
}
