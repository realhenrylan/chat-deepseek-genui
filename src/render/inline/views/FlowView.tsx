import type { FlowTone, FlowWidget } from '../../../protocol/widget/types';
import { MathText } from '../../math';

function toneClass(tone?: FlowTone, highlight?: boolean): string {
  if (tone && tone !== 'default') return `tone-${tone}`;
  if (highlight) return 'tone-accent';
  return '';
}

export function FlowView({ widget }: { widget: FlowWidget }) {
  return (
    <div className="inline-flow-body">
      {(widget.title || widget.subtitle) && (
        <div className="inline-widget-header">
          <div className="inline-widget-heading">
            {widget.title && (
              <div className="inline-widget-title">
                <MathText text={widget.title} />
              </div>
            )}
            {widget.subtitle && (
              <div className="inline-widget-subtitle">
                <MathText text={widget.subtitle} />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="inline-flow-steps" role="list" aria-label={widget.title ?? '流程步骤'}>
        {widget.steps.map((step, idx) => {
          const isLast = idx === widget.steps.length - 1;
          const hasNextConnector =
            !isLast || (widget.branches && widget.branches.length > 0);
          const arrowSymbol = step.arrowDirection === 'both' ? '⇅' : '↓';
          const cls = ['inline-flow-step', toneClass(step.tone, step.highlight)]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={step.id ?? idx} className="inline-flow-step-wrap" role="listitem">
              <div className={cls}>
                <div className="inline-flow-step-lead" aria-hidden="true">
                  {step.icon ? (
                    <span className="inline-flow-icon">{step.icon}</span>
                  ) : (
                    <span className="inline-flow-num">{step.step ?? String(idx + 1)}</span>
                  )}
                </div>
                <div className="inline-flow-step-main">
                  <div className="inline-flow-step-head">
                    {step.icon && step.step && (
                      <span className="inline-flow-step-seq">{step.step}</span>
                    )}
                    <span className="inline-flow-step-title">
                      <MathText text={step.title} />
                    </span>
                  </div>
                  {step.desc && (
                    <div className="inline-flow-step-desc">
                      <MathText text={step.desc} />
                    </div>
                  )}
                </div>
              </div>

              {hasNextConnector && (
                <div className="inline-flow-connector" aria-hidden="true">
                  <span className="inline-flow-arrow">{arrowSymbol}</span>
                  {step.arrowLabel && (
                    <span className="inline-flow-arrow-label">
                      <MathText text={step.arrowLabel} />
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {widget.branches && widget.branches.length > 0 && (
        <div className="inline-flow-branches" role="list" aria-label="交互分支">
          {widget.branches.map((branch, idx) => {
            const cls = ['inline-flow-branch', toneClass(branch.tone)]
              .filter(Boolean)
              .join(' ');
            return (
              <div key={idx} className={cls} role="listitem">
                <div className="inline-flow-branch-head">
                  <span className="inline-flow-branch-arrow" aria-hidden="true">
                    {branch.direction === 'both' ? '⇅' : '↓'}
                  </span>
                  {branch.icon && (
                    <span className="inline-flow-icon" aria-hidden="true">
                      {branch.icon}
                    </span>
                  )}
                  <span className="inline-flow-branch-title">
                    <MathText text={branch.title} />
                  </span>
                  {branch.badge && <span className="inline-flow-branch-badge">{branch.badge}</span>}
                </div>
                {branch.desc && (
                  <div className="inline-flow-branch-desc">
                    <MathText text={branch.desc} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {widget.capabilities && widget.capabilities.length > 0 && (
        <div className="inline-flow-capabilities" role="list" aria-label="能力组件">
          {widget.capabilities.map((cap, idx) => (
            <div key={idx} className="inline-flow-cap" role="listitem">
              {cap.icon && (
                <span className="inline-flow-cap-icon" aria-hidden="true">
                  {cap.icon}
                </span>
              )}
              <div className="inline-flow-cap-main">
                <div className="inline-flow-cap-title">
                  <MathText text={cap.title} />
                </div>
                {cap.desc && (
                  <div className="inline-flow-cap-desc">
                    <MathText text={cap.desc} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {widget.caption && (
        <div className="inline-widget-caption">
          <MathText text={widget.caption} />
        </div>
      )}
    </div>
  );
}
