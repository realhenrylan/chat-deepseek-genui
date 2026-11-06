import type { CompareWidget } from '../../../protocol/widget/types';

export function CompareView({ widget }: { widget: CompareWidget }) {
  return (
    <div className="inline-compare-body">
      {widget.title && (
        <div className="inline-widget-header">
          <div className="inline-widget-title">{widget.title}</div>
        </div>
      )}
      <div className="inline-compare-grid">
        {widget.items.map((item, idx) => {
          const isHighlighted = widget.highlight === item.name;
          return (
            <div
              key={idx}
              className={`inline-compare-col ${isHighlighted ? 'highlighted' : ''}`}
            >
              {isHighlighted && <span className="inline-compare-pill">推荐</span>}
              <div className="inline-compare-name">{item.name}</div>

              <ul className="inline-compare-list">
                {item.pros?.map((pro, pIdx) => (
                  <li key={`p-${pIdx}`} className="inline-compare-pro">
                    <span>+</span>
                    <span>{pro}</span>
                  </li>
                ))}
                {item.cons?.map((con, cIdx) => (
                  <li key={`c-${cIdx}`} className="inline-compare-con">
                    <span>-</span>
                    <span>{con}</span>
                  </li>
                ))}
              </ul>

              {item.fields && Object.keys(item.fields).length > 0 && (
                <div className="inline-compare-fields">
                  {Object.entries(item.fields).map(([k, v]) => (
                    <div key={k} className="inline-compare-field-row">
                      <span>{k}</span>
                      <span className="inline-compare-field-val">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
