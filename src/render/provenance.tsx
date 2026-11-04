import { useId } from 'react';
import {
  BASIS_KIND_LABELS,
  basisKeyForDerived,
  basisKeyForState,
  basisProblem,
  describeBasis,
  findBasisSource,
  formatProvenanceDate,
  isBasisExpired,
  normalizeSourceUrl,
  todayLocalDate,
} from '../protocol/provenance';
import type {
  GenuiBasis,
  GenuiSource,
  GenuiV6Document,
  InteractiveStateValues,
} from '../protocol/types';

/**
 * 依据徽标：只陈述模型写了什么，绝不把模型声称的来源说成已核验。
 */
export function BasisBadge({
  basis,
  sources,
  today,
  label,
  edited,
}: {
  basis: GenuiBasis | undefined;
  sources: readonly GenuiSource[] | undefined;
  today?: string;
  label?: string;
  /** 当前值已被用户修改：显示修改标记，原依据仅作为历史说明保留。 */
  edited?: boolean;
}) {
  const referenceDay = today ?? todayLocalDate();
  if (basis === undefined) {
    return null;
  }
  const description = describeBasis(basis, sources);
  const problem = basisProblem(basis, sources, referenceDay);
  const source = findBasisSource(basis, sources);
  const dateParts: string[] = [];
  if (basis.asOf !== undefined) dateParts.push(`适用 ${formatProvenanceDate(basis.asOf)}`);
  if (basis.validUntil !== undefined) {
    dateParts.push(
      isBasisExpired(basis, referenceDay)
        ? `已过期（${formatProvenanceDate(basis.validUntil)}）`
        : `有效期至 ${formatProvenanceDate(basis.validUntil)}`,
    );
  }
  const original = [
    description.label,
    source === undefined ? undefined : `来源：${source.label}（未核验）`,
    ...dateParts,
    description.note,
    problem,
  ]
    .filter((part): part is string => part !== undefined && part !== '')
    .join('；');

  if (edited) {
    return (
      <span
        className="genui-basis genui-basis-edited"
        data-basis-kind={basis.kind}
        data-edited="true"
        title={`当前值由用户修改；原依据：${original}`}
      >
        <span className="genui-basis-kind-name">用户修改</span>
        <span className="genui-basis-original">· 原依据：{description.label}</span>
        {source === undefined ? null : (
          <span className="genui-basis-source">·《{source.label}》</span>
        )}
        {basis.kind === 'reference' ? (
          <span className="genui-basis-trust">· 未核验</span>
        ) : null}
      </span>
    );
  }

  const title = [
    label === undefined ? description.label : `${label}：${description.label}`,
    source === undefined ? undefined : `来源：${source.label}（未核验）`,
    ...dateParts,
    description.note,
    problem,
  ]
    .filter((part): part is string => part !== undefined && part !== '')
    .join('；');

  return (
    <span
      className={`genui-basis genui-basis-${basis.kind}`}
      data-basis-kind={basis.kind}
      title={title}
    >
      {label === undefined ? null : <span className="genui-basis-kind">{label}</span>}
      {source === undefined ? null : (
        <span className="genui-basis-source">·《{source.label}》</span>
      )}
      {basis.kind === 'reference' ? (
        <span className="genui-basis-trust">· 未核验</span>
      ) : null}
      {problem === undefined ? null : (
        <span className="genui-basis-alert" aria-hidden="true">
          ！
        </span>
      )}
      <span className="genui-basis-kind-name">{BASIS_KIND_LABELS[basis.kind]}</span>
    </span>
  );
}

/** 来源链接只作纯文本展示；形式不可靠时明确标注，不生成可点击链接。 */
function SourceUrlView({ url }: { url?: string }) {
  if (url === undefined) {
    return <span className="genui-source-url genui-source-url-missing">未提供链接</span>;
  }
  const check = normalizeSourceUrl(url);
  return (
    <>
      <span className="genui-source-url" title="链接由模型提供，插件未访问；请自行确认。">
        {url}
      </span>
      {check.ok ? null : (
        <span className="genui-source-url-warning" role="status">
          链接形式不可靠：{check.reason}；仅按纯文本展示，插件不会访问。
        </span>
      )}
    </>
  );
}

export interface ProvenancePanelProps {
  document: GenuiV6Document;
  state: InteractiveStateValues;
  drafts: Record<string, string>;
  fieldErrors: Record<string, string>;
  /** 已被用户修改的状态 id；原依据只作为历史说明保留。 */
  editedState?: readonly string[];
  onValueChange: (id: string, value: number | string) => void;
  onNumberInput: (id: string, raw: string) => void;
  today: string;
}

/**
 * 依据与适用范围面板：把 sources、假设与有效期放在同一处，
 * 输入可直接修改并与卡片结果联动；缺失值显示为「未标注来源」而不是 0。
 *
 * v6 把 basis 放在根级旁路表中，因此这里按 `state.<id>` / `derived.<id>`
 * / `element.<path>` 取用，不要求每个元素自身带依据字段。
 */
export function ProvenancePanel({
  document,
  state,
  drafts,
  fieldErrors,
  editedState,
  onValueChange,
  onNumberInput,
  today,
}: ProvenancePanelProps) {
  const headingId = useId();
  const sources = document.sources ?? [];
  const basisMap = document.basis ?? {};
  const basisEntries = Object.entries(basisMap);
  const missingBasis = document.state.filter(
    (variable) => basisMap[basisKeyForState(variable.id)] === undefined,
  ).length;
  const referenceCount = basisEntries.filter(([, basis]) => basis.kind === 'reference').length;
  const derivedEntries = document.derived
    .map((derived) => ({ derived, basis: basisMap[basisKeyForDerived(derived.id)] }))
    .filter(
      (entry): entry is { derived: (typeof document.derived)[number]; basis: GenuiBasis } =>
        entry.basis !== undefined,
    );
  const elementEntries = basisEntries
    .filter(([key]) => key.startsWith('element.'))
    .sort(([left], [right]) => left.localeCompare(right));

  return (
    <section className="genui-provenance" aria-labelledby={headingId}>
      <div className="genui-provenance-header">
        <h4 className="genui-provenance-title" id={headingId}>
          依据与适用范围
        </h4>
        <span className="genui-provenance-mode">模型声明 · 插件未访问网络</span>
      </div>
      <p className="genui-provenance-intro">
        来源由模型在界面中声明，插件不会请求链接或核验资料；「模型引用」一律标为未核验。
        没有 basis 的数据按未知处理，缺失值不是 0。
      </p>
      <p className="genui-provenance-count">
        声明来源 {sources.length} 个 · 输入项 {document.state.length} 个 · 未标注依据{' '}
        {missingBasis} 个 · 模型引用 {referenceCount} 个 · 其他依据条目{' '}
        {derivedEntries.length + elementEntries.length} 个
      </p>

      {sources.length === 0 ? (
        <p className="genui-source-empty">没有声明外部来源；涉及外部事实的内容应视为未核验。</p>
      ) : (
        <div className="genui-source-block">
          <h5 className="genui-provenance-subtitle">声明的来源</h5>
          <ul className="genui-source-list">
            {sources.map((source) => (
              <li className="genui-source" key={source.id} data-source-id={source.id}>
                <div className="genui-source-head">
                  <strong className="genui-source-label">{source.label}</strong>
                  <span className="genui-source-trust">模型声称 · 未核验</span>
                </div>
                {source.publisher === undefined ? null : (
                  <span className="genui-source-publisher">{source.publisher}</span>
                )}
                <SourceUrlView url={source.url} />
                <span className="genui-source-dates">
                  {source.publishedAt === undefined
                    ? '资料时间未说明'
                    : `资料时间 ${formatProvenanceDate(source.publishedAt)}`}
                  {source.retrievedAt === undefined
                    ? ''
                    : ` · 声称获取于 ${formatProvenanceDate(source.retrievedAt)}`}
                </span>
                {source.note === undefined ? null : (
                  <p className="genui-source-note">{source.note}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="genui-assumption-block">
        <h5 className="genui-provenance-subtitle">关键输入与假设</h5>
        {document.state.length === 0 ? (
          <p className="genui-assumption-empty">这个界面没有可调输入。</p>
        ) : (
          <div className="genui-assumption-list">
            {document.state.map((variable) => {
              const key = basisKeyForState(variable.id);
              const basis = basisMap[key];
              const problem = basisProblem(basis, sources, today);
              const error = fieldErrors[variable.id];
              const source = findBasisSource(basis, sources);
              const value = state[variable.id];
              const edited = editedState?.includes(variable.id) ?? false;
              const meta = [
                edited ? '当前值由你修改；原依据仅供参考' : undefined,
                source === undefined ? undefined : `来源：${source.label}（未核验）`,
                basis?.asOf === undefined
                  ? undefined
                  : `适用时点 ${formatProvenanceDate(basis.asOf)}`,
                basis?.validUntil === undefined
                  ? undefined
                  : `有效期至 ${formatProvenanceDate(basis.validUntil)}`,
              ].filter((part): part is string => part !== undefined);

              return (
                <div
                  className="genui-assumption"
                  key={variable.id}
                  data-kind={variable.kind}
                  data-basis-key={key}
                >
                  <div className="genui-assumption-head">
                    <label
                      className="genui-assumption-label"
                      htmlFor={`${headingId}-${variable.id}`}
                    >
                      {variable.label}
                    </label>
                    {basis === undefined && !edited ? (
                      <span className="genui-basis genui-basis-unknown">未标注依据</span>
                    ) : basis === undefined ? (
                      <span className="genui-basis genui-basis-edited" data-edited="true">
                        <span className="genui-basis-kind-name">用户修改</span>
                      </span>
                    ) : (
                      <BasisBadge
                        basis={basis}
                        sources={sources}
                        today={today}
                        edited={edited}
                      />
                    )}
                  </div>
                  {variable.kind === 'number' ? (
                    <input
                      id={`${headingId}-${variable.id}`}
                      className="genui-assumption-input"
                      type="number"
                      inputMode="decimal"
                      min={variable.min}
                      max={variable.max}
                      step={variable.step}
                      value={drafts[variable.id] ?? String(value ?? '')}
                      aria-invalid={error === undefined ? undefined : true}
                      onChange={(event) => onNumberInput(variable.id, event.target.value)}
                    />
                  ) : (
                    <select
                      id={`${headingId}-${variable.id}`}
                      className="genui-assumption-select"
                      value={String(value ?? '')}
                      aria-invalid={error === undefined ? undefined : true}
                      onChange={(event) => onValueChange(variable.id, event.target.value)}
                    >
                      {variable.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {meta.length === 0 ? null : (
                    <p className="genui-assumption-meta">{meta.join(' · ')}</p>
                  )}
                  {basis?.note === undefined ? null : (
                    <p className="genui-assumption-note">{basis.note}</p>
                  )}
                  {error === undefined ? null : (
                    <p className="genui-input-error" role="status">
                      {error}
                    </p>
                  )}
                  {problem === undefined ? null : (
                    <p className="genui-basis-problem" role="status">
                      {edited ? `原依据问题：${problem}` : problem}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {derivedEntries.length === 0 && elementEntries.length === 0 ? null : (
        <div className="genui-basis-block">
          <h5 className="genui-provenance-subtitle">结果与显示元素的依据</h5>
          <ul className="genui-basis-list">
            {derivedEntries.map(({ derived, basis }) => (
              <li
                className="genui-basis-entry"
                key={basisKeyForDerived(derived.id)}
                data-basis-key={basisKeyForDerived(derived.id)}
              >
                <span className="genui-basis-entry-label">
                  {derived.label}
                  {derived.unit === undefined ? '' : `（${derived.unit}）`}
                </span>
                <BasisBadge basis={basis} sources={sources} today={today} />
              </li>
            ))}
            {elementEntries.map(([key, basis]) => (
              <li className="genui-basis-entry" key={key} data-basis-key={key}>
                <span className="genui-basis-entry-label">{key}</span>
                <BasisBadge basis={basis} sources={sources} today={today} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
