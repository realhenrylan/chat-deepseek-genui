import type { CardWidget } from '../../../protocol/widget/types';
import { MathFormula, MathText } from '../../math';

export function CardView({ widget }: { widget: CardWidget }) {
  return (
    <div className="inline-card-body">
      <div className="inline-widget-header">
        <div className="inline-widget-heading">
          <div className="inline-widget-title">
            <MathText text={widget.title} />
          </div>
          {widget.subtitle && (
            <div className="inline-widget-subtitle">
              <MathText text={widget.subtitle} />
            </div>
          )}
        </div>
      </div>

      {widget.tags && widget.tags.length > 0 && (
        <div className="inline-card-tags">
          {widget.tags.map((tag, idx) => (
            <span key={idx} className="inline-card-tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      {widget.items && widget.items.length > 0 && (
        <div className="inline-card-rows" role="list">
          {widget.items.map((item, idx) => (
            <div key={idx} className="inline-card-row" role="listitem">
              <span className="inline-card-row-icon" aria-hidden="true">
                {item.icon ?? '•'}
              </span>
              <div className="inline-card-row-main">
                <div className="inline-card-row-title">
                  <MathText text={item.title} />
                </div>
                {item.detail && (
                  <div className="inline-card-row-detail">
                    <MathText text={item.detail} />
                  </div>
                )}
                {item.math && (
                  <div className="inline-card-row-math">
                    <MathFormula tex={item.math} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {widget.points && widget.points.length > 0 && (
        <ul className="inline-card-points">
          {widget.points.map((pt, idx) => (
            <li key={idx}>
              <MathText text={pt} />
            </li>
          ))}
        </ul>
      )}

      {widget.caption && (
        <div className="inline-widget-caption">
          <MathText text={widget.caption} />
        </div>
      )}
    </div>
  );
}
