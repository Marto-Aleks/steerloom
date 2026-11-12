import { CircleCheck } from 'lucide-react'
import { SpotIcon } from '../../components/SpotIcon'
import type { SpotName } from '../../components/spot-icons'
import { UiIcon } from '../../components/UiIcon'
import { GlassButton } from '../../components/ui'
import type {
  DataFix,
  DataQualityReport,
  TrustLevel,
} from '../../lib/statistics/data-quality'

interface DataQualityPanelProps {
  report: DataQualityReport
  /** Applies a finding's fix; only fixes of the kinds listed are offered. */
  onFix?: (fix: DataFix) => void
  fixes?: ReadonlyArray<DataFix['kind']>
}

const levels: Record<TrustLevel, { label: string; spot: SpotName }> = {
  strong: { label: 'Strong data', spot: 'on-track' },
  directional: { label: 'Directional data', spot: 'attention' },
  weak: { label: 'Weak data', spot: 'attention' },
}

/**
 * How far the numbers can be trusted, in one sentence, with what needs a look
 * behind a disclosure: only problems get a card, each saying what it affects
 * and, where there is one, the fix. Anything other than strong opens expanded
 * so the reason is never hidden.
 */
export function DataQualityPanel({
  report,
  onFix,
  fixes = [],
}: DataQualityPanelProps) {
  const level = levels[report.verdict.level]
  const sentence = report.verdict.sentence.replace(/^[A-Za-z]+: /, '')
  return (
    <details
      className="quality-strip"
      data-status={report.status}
      open={report.status !== 'ready' || undefined}
    >
      <summary className="quality-strip__summary">
        <span className="quality-strip__icon" aria-hidden="true">
          <SpotIcon
            name={report.status === 'blocked' ? 'blocked' : level.spot}
            variant="soft"
            size={32}
          />
        </span>
        <span className="quality-strip__copy">
          <strong>{level.label}</strong>
          <span>{sentence}</span>
        </span>
        <span className="quality-strip__toggle">
          <span data-when="closed">Show details</span>
          <span data-when="open">Hide details</span>
        </span>
      </summary>

      <section className="data-quality-panel" aria-label="Data checks">
        {report.findings.length > 0 && (
          <ul
            className="data-quality-findings"
            aria-label="Worth a look"
            // Even rows: 2 side by side, 3 in a row, 4 as two by two.
            data-columns={
              report.findings.length === 4
                ? 2
                : Math.min(3, report.findings.length)
            }
          >
            {report.findings.map((finding) => (
              <li
                key={finding.id}
                className="data-quality-finding"
                data-status={finding.severity}
              >
                <h3>{finding.title}</h3>
                <p>{finding.detail}</p>
                <p className="data-quality-finding__affects">
                  <span>Affects</span> {finding.affects}
                </p>
                {finding.fix && onFix && fixes.includes(finding.fix.kind) && (
                  <GlassButton
                    size="compact"
                    className="data-quality-finding__fix"
                    onClick={() => onFix(finding.fix!)}
                  >
                    {finding.fix.label}
                  </GlassButton>
                )}
              </li>
            ))}
          </ul>
        )}

        <dl className="data-quality-summary">
          <QualityStat
            label="Items on the board"
            value={report.uniqueIssueCount}
            detail={
              report.typeExcludedCount
                ? `${report.typeExcludedCount.toLocaleString()} left out by type`
                : 'All item types counted'
            }
          />
          <QualityStat
            label="Finished in the period"
            value={report.completedObservationCount}
            detail={`${report.exitedOutsideWindowCount.toLocaleString()} finished before it`}
          />
          <QualityStat
            label="In progress now"
            value={report.workInProgressCount}
            detail={`${report.neverEnteredCount.toLocaleString()} not started yet`}
          />
          <QualityStat
            label="Status changes read"
            value={report.validTransitionCount}
            detail={`${report.invalidTransitionCount.toLocaleString()} couldn’t be read`}
          />
        </dl>

        {report.passed.length > 0 && (
          <details className="data-quality-passed">
            <summary>
              <UiIcon icon={CircleCheck} size={16} />
              {report.findings.length ? 'Also checked: ' : ''}
              {report.passed.length}{' '}
              {report.passed.length === 1 ? 'check' : 'checks'} found nothing to
              flag
            </summary>
            <p>
              {report.passed
                .join(', ')
                .replace(/^./, (first) => first.toUpperCase())}
              .
            </p>
          </details>
        )}

        <p className="data-quality-footnote">
          Checks cover the items this board returns to the connected account.
          They use counts and dates only; Steerloom doesn’t log item contents.
        </p>
      </section>
    </details>
  )
}

function QualityStat({
  label,
  value,
  detail,
}: {
  label: string
  value: number
  detail: string
}) {
  return (
    <div className="data-quality-stat">
      <dt>{label}</dt>
      <dd>
        <output aria-label={label}>{value.toLocaleString()}</output>
      </dd>
      <span>{detail}</span>
    </div>
  )
}
