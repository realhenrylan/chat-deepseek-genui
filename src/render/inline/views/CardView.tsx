import type { CardWidget } from '../../../protocol/widget/types';

export function CardView({ widget }: { widget: CardWidget }) {
  return (
    <div className="inline-card-body">
      <div className="inline-widget-title">{widget.title}</div>
      {widget.subtitle && <div className="inline-widget-subtitle">{widget.subtitle}</div>}

      {widget.tags && widget.tags.length > 0 && (
        <div className="inline-card-tags">
          {widget.tags.map((tag, idx) => (
            <span key={idx} className="inline-card-tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      {widget.points && widget.points.length > 0 && (
        <ul className="inline-card-points">
          {widget.points.map((pt, idx) => (
            <li key={idx}>{pt}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
