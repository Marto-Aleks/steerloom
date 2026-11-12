import { ItemKey } from './ItemKey'
import {
  explainMetric,
  type FlowMetricId,
  type MetricEvidenceReport,
} from '../../lib/statistics/flow-evidence'
import type { ExitPeriod } from '../../lib/statistics/snapshot-filter'
import type { FlowMetrics } from '../../types'
import {
  formatCompactDays,
  formatDays,
  formatEvidenceDate,
  formatNumber,
  formatPeriod,
} from './format'

/**
 * The evidence behind one number: what it means in plain words, how it was
 * read off this report's items, what counted, and the items themselves with
 * the ones that set the number marked.
 */
export function MetricEvidenceView({
  metric,
  evidence,
  metrics,
  period,
  throughput,
}: {
  metric: FlowMetricId
  evidence: MetricEvidenceReport
  metrics: FlowMetrics
  period: ExitPeriod | null
  throughput: number | null
}) {
  const tickets = [...evidence.includedTickets].sort((left, right) =>
    metric === 'median-cycle-time' || metric === 'percentile-85'
      ? right.cycleTimeDays - left.cycleTimeDays ||
        left.key.localeCompare(right.key)
      : Date.parse(right.latestExit) - Date.parse(left.latestExit) ||
        left.key.localeCompare(right.key),
  )
  const explanation = explainMetric(
    metric,
    metrics,
    period,
    evidence.selectedColumnNames,
    period ? formatPeriod(period) : null,
  )
  const anchors = new Map(
    explanation.anchors.map(({ key, role }) => [key, role]),
  )

  return (
    <div className="metric-evidence">
      <section className="metric-evidence__summary">
        <div>
          <span>The number</span>
          <strong>{metricValue(metric, metrics, throughput)}</strong>
        </div>
        <div>
          <span>Finished items it comes from</span>
          <strong>
            {metrics.workItemCount.toLocaleString()}{' '}
            {metrics.workItemCount === 1 ? 'item' : 'items'}
          </strong>
        </div>
      </section>

      <section className="metric-evidence__section">
        <h3>What it means</h3>
        <p className="metric-evidence__meaning">{explanation.meaning}</p>
        {explanation.how && (
          <p className="metric-evidence__how">{explanation.how}</p>
        )}
      </section>

      <section className="metric-evidence__section">
        <h3>What counts</h3>
        <dl className="metric-evidence__scope">
          <div>
            <dt>Time measured in</dt>
            <dd>{evidence.selectedColumnNames.join(', ')}</dd>
          </div>
          <div>
            <dt>Item types</dt>
            <dd>
              {evidence.selectedTicketTypes.length
                ? evidence.selectedTicketTypes.join(', ')
                : 'All item types'}
            </dd>
          </div>
          <div>
            <dt>Finished between</dt>
            <dd>{period ? formatPeriod(period) : 'Any time on record'}</dd>
          </div>
        </dl>
      </section>

      <section className="metric-evidence__section">
        <h3>The finished items</h3>
        <p>
          A stay is one trip through the measured columns, from entering the
          first to leaving the last. Two stays mean the item came back.
        </p>
        <div className="metric-evidence__table-wrap">
          <table className="metric-evidence__table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Time taken</th>
                <th scope="col">Stays</th>
                <th scope="col">Started</th>
                <th scope="col">Finished</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => {
                const role = anchors.get(ticket.key)
                return (
                  <tr key={ticket.key} data-anchor={role ? '' : undefined}>
                    <th scope="row">
                      <ItemKey
                        itemKey={ticket.key}
                        title={ticket.title}
                        browseUrl={ticket.browseUrl}
                      />
                    </th>
                    <td>
                      {formatCompactDays(ticket.cycleTimeDays)}
                      {role && (
                        <span className="metric-evidence__anchor">{role}</span>
                      )}
                    </td>
                    <td>
                      <details className="metric-evidence__visits">
                        <summary>
                          {ticket.visits.length}{' '}
                          {ticket.visits.length === 1 ? 'stay' : 'stays'}
                          {ticket.visits.length > 1 ? ' · came back' : ''}
                        </summary>
                        <ul>
                          {ticket.visits.map((visit) => (
                            <li key={`${visit.enteredAt}-${visit.exitedAt}`}>
                              {formatEvidenceDate(visit.enteredAt)} →{' '}
                              {formatEvidenceDate(visit.exitedAt)} ·{' '}
                              {formatCompactDays(visit.durationDays)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                    <td>{formatEvidenceDate(ticket.firstEntry)}</td>
                    <td>{formatEvidenceDate(ticket.latestExit)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="metric-evidence__section">
        <h3>Not counted, and why</h3>
        {evidence.exclusions.length ? (
          <div className="metric-evidence__exclusions">
            {evidence.exclusions.map((exclusion) => (
              <details key={exclusion.id}>
                <summary>
                  {exclusion.label} ({exclusion.tickets.length})
                </summary>
                <p>{exclusion.description}</p>
                <ul>
                  {exclusion.tickets.map((ticket) => (
                    <li key={ticket.key}>
                      <ItemKey
                        itemKey={ticket.key}
                        title={ticket.title}
                        browseUrl={ticket.browseUrl}
                      />
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        ) : (
          <p>Every item in scope is in the list above.</p>
        )}
      </section>
    </div>
  )
}

function metricValue(
  metric: FlowMetricId,
  metrics: FlowMetrics,
  throughput: number | null,
) {
  if (metric === 'completed-observations') {
    return metrics.workItemCount.toLocaleString()
  }
  if (metric === 'median-cycle-time') return formatDays(metrics.medianCycleTime)
  if (metric === 'percentile-85') {
    return formatDays(metrics.percentile85CycleTime)
  }
  return throughput === null
    ? 'Not available'
    : `${formatNumber(throughput)} items/week`
}
