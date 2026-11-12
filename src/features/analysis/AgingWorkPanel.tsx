import { AskAiTag } from '../../components/AskAiTag'
import { ExternalLink } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import { useState, type CSSProperties } from 'react'
import { ItemKey } from './ItemKey'
import { stagger } from './motion'
import {
  GlassButton,
  GlassInput,
  GlassPanel,
  GlassSelect,
  StatusBadge,
} from '../../components/ui'
import {
  agingBaselineState,
  type AgingWorkItem,
} from '../../lib/statistics/aging-work'
import {
  REVIEW_SELECTION_LIMIT,
  selectedWorkPrompt,
} from '../../lib/ai/review-prompts'

const PAGE_SIZE = 50

export function AgingWorkPanel({
  items,
  p85,
  sampleCount,
  onAsk,
}: {
  items: AgingWorkItem[]
  p85: number | null
  sampleCount: number
  onAsk: (prompt: string) => void
}) {
  const [stage, setStage] = useState('')
  const [risk, setRisk] = useState('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [selection, setSelection] = useState<string[]>([])
  const selected = items.filter((item) => selection.includes(item.id))
  const stages = [
    ...new Map(items.map((item) => [item.columnId, item.column])).entries(),
  ]
  const filtered = items.filter(
    (item) =>
      (!stage || item.columnId === stage) &&
      (risk === 'all' ||
        agingBaselineState(item.ageInSelectedColumns, p85) === risk) &&
      `${item.item} ${item.title ?? ''} ${item.currentStatus} ${item.column}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  )
  const visible = filtered.slice(0, limit)
  const beyond = items.filter(
    (item) => agingBaselineState(item.ageInSelectedColumns, p85) === 'beyond',
  ).length
  const maximumAge = Math.max(
    1,
    p85 ?? 0,
    ...items.map((item) => item.ageInSelectedColumns),
  )
  const hiddenSelected = selected.filter(
    (item) => !visible.some((candidate) => candidate.id === item.id),
  ).length
  const filterChanged = () => setLimit(PAGE_SIZE)

  return (
    <GlassPanel className="aging-work" aria-labelledby="aging-work-title">
      <header className="aging-work__heading">
        <div>
          <h2 id="aging-work-title" className="section-title">
            Oldest active work
          </h2>
          <p className="body-copy">
            {items.length} active {items.length === 1 ? 'item' : 'items'}
            {p85 === null
              ? '. Usual limit (P85) unavailable: no finished sample.'
              : `, ${beyond} past the usual limit of ${days(p85)} days (P85).`}
            {p85 !== null && sampleCount < 10 ? ' Small sample.' : ''}
          </p>
        </div>
      </header>

      <div id="aging-work-review" className="aging-work__review">
        <p className="aging-work__method">
          {p85 === null
            ? 'There is no finished sample for this scope. Ages are still available; risk against the usual limit (P85) cannot be assessed.'
            : `Usual limit (P85): ${days(p85)} days from ${sampleCount} finished items. ${sampleCount < 10 ? 'Small sample: interpret this baseline cautiously.' : 'The dashed marker shows the limit.'}`}
        </p>
        <details className="aging-work__rules">
          <summary>How ages are calculated</summary>
          <p className="aging-work__method">
            Age adds all visits to measured stages, including re-entry. Time in
            the current stage is the latest continuous visit. Current work is
            not restricted by the completed reporting period. P85 is a
            historical reference, not a deadline or a prediction of remaining
            time.
          </p>
        </details>
        {items.length > 0 && (
          <>
            <div className="aging-work__filters">
              <label>
                Find an item
                <GlassInput
                  type="search"
                  value={query}
                  placeholder="Key, title, status, or stage"
                  onChange={(event) => {
                    setQuery(event.target.value)
                    filterChanged()
                  }}
                />
              </label>
              <label>
                Current stage
                <GlassSelect
                  value={stage}
                  onChange={(event) => {
                    setStage(event.target.value)
                    filterChanged()
                  }}
                >
                  <option value="">All stages</option>
                  {stages.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </GlassSelect>
              </label>
              <label>
                Age against baseline
                <GlassSelect
                  value={risk}
                  onChange={(event) => {
                    setRisk(event.target.value)
                    filterChanged()
                  }}
                >
                  <option value="all">All active work</option>
                  <option value="beyond" disabled={p85 === null}>
                    Past the usual limit (P85)
                  </option>
                  <option value="within" disabled={p85 === null}>
                    Within the usual limit (P85)
                  </option>
                </GlassSelect>
              </label>
            </div>
            <div className="aging-work__selection">
              <p className="metadata-copy" role="status">
                {selected.length} of {REVIEW_SELECTION_LIMIT} items selected for
                review
                {hiddenSelected
                  ? `, ${hiddenSelected} outside the visible results`
                  : ''}
                . Selection is kept when filtering.
              </p>
              <div className="screen-actions">
                {selected.length > 0 && (
                  <GlassButton
                    variant="quiet"
                    size="compact"
                    onClick={() => setSelection([])}
                  >
                    Clear selection
                  </GlassButton>
                )}
                <GlassButton
                  variant="secondary"
                  size="compact"
                  disabled={!selected.length}
                  onClick={() => onAsk(selectedWorkPrompt(selected, p85))}
                >
                  <AskAiTag /> about selected work{' '}
                  <span aria-hidden="true">→</span>
                </GlassButton>
              </div>
            </div>
            <p className="metadata-copy">
              Showing {visible.length} of {filtered.length} matching items.
              Agent actions open an editable draft; nothing is sent
              automatically.
            </p>
            <div
              className="aging-work__groups"
              role="region"
              aria-label="Active work results"
              tabIndex={0}
            >
              {stages.map(([id, name]) => {
                const group = visible.filter((item) => item.columnId === id)
                if (!group.length) return null
                return (
                  <section
                    className="aging-work__group"
                    key={id}
                    aria-label={`${name} active work`}
                  >
                    <h3>
                      {name}{' '}
                      <span>
                        {filtered.filter((item) => item.columnId === id).length}{' '}
                        matching
                      </span>
                    </h3>
                    <ul className="aging-work__list">
                      {group.map((item) => {
                        const state = agingBaselineState(
                          item.ageInSelectedColumns,
                          p85,
                        )
                        return (
                          <li
                            className="aging-work__item"
                            key={item.id}
                            data-risk={state}
                          >
                            <label className="aging-work__select">
                              <input
                                type="checkbox"
                                aria-label={`Select ${item.item} for review`}
                                checked={selection.includes(item.id)}
                                disabled={
                                  !selection.includes(item.id) &&
                                  selected.length >= REVIEW_SELECTION_LIMIT
                                }
                                onChange={(event) =>
                                  setSelection((current) =>
                                    event.target.checked
                                      ? [...current, item.id]
                                      : current.filter((id) => id !== item.id),
                                  )
                                }
                              />
                            </label>
                            <details className="aging-work__detail">
                              <summary>
                                <span className="aging-work__identity">
                                  <strong>
                                    <ItemKey
                                      itemKey={item.item}
                                      title={item.title}
                                      browseUrl={item.browseUrl}
                                    />
                                  </strong>
                                  <span title={item.statusDetail}>
                                    {item.currentStatus}
                                  </span>
                                </span>
                                <span className="aging-work__age">
                                  <strong>
                                    {days(item.ageInSelectedColumns)} days
                                  </strong>
                                  <small>
                                    {days(item.currentStageAgeDays)} days in
                                    current stage
                                  </small>
                                  <AgeBar
                                    age={item.ageInSelectedColumns}
                                    maximum={maximumAge}
                                    p85={p85}
                                  />
                                </span>
                                <StatusBadge
                                  tone={
                                    state === 'beyond' ? 'warning' : 'neutral'
                                  }
                                >
                                  {state === 'beyond'
                                    ? 'Past the usual limit'
                                    : state === 'within'
                                      ? 'Within the usual limit'
                                      : 'Baseline unavailable'}
                                </StatusBadge>
                              </summary>
                              <div className="aging-work__evidence">
                                <p className="metadata-copy">
                                  Observed status visits, in order. Unmeasured
                                  visits are excluded from the accumulated age.
                                </p>
                                <ol>
                                  {item.history.map((visit, index) => (
                                    <li key={`${visit.enteredAt}:${index}`}>
                                      <strong>{visit.status}</strong>
                                      <span>
                                        {date(visit.enteredAt)} →{' '}
                                        {visit.exitedAt
                                          ? date(visit.exitedAt)
                                          : 'Snapshot time'}
                                      </span>
                                      <span>
                                        {days(visit.durationDays)} days ·{' '}
                                        {visit.measured
                                          ? 'Measured'
                                          : 'Outside measured stages'}
                                      </span>
                                    </li>
                                  ))}
                                </ol>
                                <div className="screen-actions">
                                  {safeUrl(item.browseUrl) && (
                                    <a
                                      href={safeUrl(item.browseUrl)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      Open {item.item} in source{' '}
                                      <UiIcon icon={ExternalLink} size={16} />
                                    </a>
                                  )}
                                  <GlassButton
                                    variant="secondary"
                                    size="compact"
                                    onClick={() =>
                                      onAsk(selectedWorkPrompt([item], p85))
                                    }
                                  >
                                    <AskAiTag /> about {item.item}{' '}
                                    <span aria-hidden="true">→</span>
                                  </GlassButton>
                                </div>
                              </div>
                            </details>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </div>
            {!filtered.length && (
              <p className="empty-inline-state">
                No active items match these filters.
              </p>
            )}
            {filtered.length > limit && (
              <GlassButton
                variant="secondary"
                onClick={() => setLimit((current) => current + PAGE_SIZE)}
              >
                Show more active work
              </GlassButton>
            )}
          </>
        )}
      </div>
      {!items.length && (
        <p className="empty-inline-state">
          No active items were observed in these measured stages.
        </p>
      )}
    </GlassPanel>
  )
}

// Horizontal age bar with the usual limit (P85) as a dashed marker. The fill
// crosses into the risk gradient only beyond that marker.
function AgeBar({
  age,
  maximum,
  p85,
  delay = 0,
}: {
  age: number
  maximum: number
  p85: number | null
  delay?: number
}) {
  const safeMaximum = Math.max(maximum, 1)
  const limit = p85 === null ? null : Math.min(100, (p85 / safeMaximum) * 100)
  const fill = Math.max(0.5, Math.min(100, (age / safeMaximum) * 100))
  return (
    <span
      className="aging-work__bar"
      aria-hidden="true"
      data-risk={agingBaselineState(age, p85)}
      style={
        {
          '--aging-limit': limit === null ? undefined : `${limit}%`,
          '--aging-fill-ratio': fill / 100,
        } as CSSProperties
      }
    >
      <span
        className="aging-work__bar-fill sl-grow-x"
        style={{
          width: `${fill}%`,
          ...stagger(delay, 80, 120),
        }}
      />
      {limit !== null && <i className="aging-work__bar-limit" />}
    </span>
  )
}

function days(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
    value,
  )
}
function date(value: string) {
  return new Date(value).toLocaleString()
}
function safeUrl(value?: string) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
