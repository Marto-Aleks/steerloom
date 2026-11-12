import { useState } from 'react'
import { Check, ChevronDown, Minus, RotateCcw } from 'lucide-react'
import type { FocusSignal } from '../lib/statistics/focus-now'
import { SignalCard } from '../features/analysis/TodayPanel'
import { Wordmark } from '../components/Wordmark'
import { UiIcon } from '../components/UiIcon'
import { GlassButton, GlassInput, StatusBadge } from '../components/ui'
import './review.css'

/*
 * Development-only mock: decisions. A signal becomes a decision in a click,
 * Steerloom keeps the numbers of that day, and on the check date it shows
 * what moved and says plainly when it cannot attribute the change.
 * Fictional data throughout.
 */
const JIRA = 'https://example.atlassian.net/issues/?jql=key%20in%20(FLOW-1)'

const pileUp: FocusSignal = {
  id: 'wip-concentration',
  severity: 'warning',
  title: 'Work is piling up in “Review”',
  evidence:
    'Finished items spent 58% of their time in Review, and 6 of 12 active items sit there now.',
  meta: '6 items in Review',
  action: 'Review capacity, handoffs, and pull policy at this workflow step.',
  jiraFilter: { label: 'Open the items in Review in Jira', href: JIRA },
}

interface Baseline {
  label: string
  then: string
  now?: string
  moved?: 'better' | 'worse' | 'same'
}

interface Decision {
  id: string
  what: string
  owner: string
  decided: string
  check: string
  answers: string
  state: 'open' | 'checked' | 'dropped'
  baseline: Baseline[]
  verdict?: string
  caveat?: string
}

const decisions: Decision[] = [
  {
    id: 'limit-review',
    what: 'Limit Review to 4 items: nothing new enters until one leaves',
    owner: 'Dana',
    decided: 'Oct 17',
    check: 'Oct 31',
    answers: 'Work is piling up in Review',
    state: 'checked',
    baseline: [
      {
        label: 'Past the usual limit',
        then: '13 of 39',
        now: '6 of 41',
        moved: 'better',
      },
      {
        label: 'Usual limit (P85)',
        then: '101 days',
        now: '88 days',
        moved: 'better',
      },
      {
        label: 'Time spent in Review',
        then: '58%',
        now: '41%',
        moved: 'better',
      },
      { label: 'Finished in 2 weeks', then: '20', now: '23', moved: 'better' },
    ],
    verdict: 'The numbers moved the right way.',
    caveat:
      'Steerloom cannot say the limit caused it: two people joined the team on Oct 20, and the period includes a release. Keep the limit and check again on Nov 28 before calling it.',
  },
  {
    id: 'second-reviewer',
    what: 'Every item gets a second reviewer within one day',
    owner: 'Priya',
    decided: 'Oct 24',
    check: 'Nov 7',
    answers: '4 active items re-entered the flow',
    state: 'open',
    baseline: [
      { label: 'Re-entered items', then: '4' },
      { label: 'Usual limit (P85)', then: '101 days' },
      { label: 'Finished in 2 weeks', then: '20' },
    ],
  },
  {
    id: 'friday-triage',
    what: 'Friday triage: unowned items get an owner or go back to the backlog',
    owner: 'Martin',
    decided: 'Sep 19',
    check: 'Oct 3',
    answers: '5 active items have no owner',
    state: 'dropped',
    baseline: [
      { label: 'Items with no owner', then: '5', now: '5', moved: 'same' },
      {
        label: 'Past the usual limit',
        then: '11 of 36',
        now: '13 of 39',
        moved: 'worse',
      },
    ],
    verdict: 'No change.',
    caveat:
      'Only 2 of 3 Fridays had a triage, so the decision was not really tried. Dropped on Oct 3; the signal is back in today’s briefing.',
  },
]

const stateLabel = {
  open: 'Checks',
  checked: 'Checked',
  dropped: 'Dropped',
} as const

const stateTone = {
  open: 'info',
  checked: 'success',
  dropped: 'neutral',
} as const

const movedIcon = { better: Check, worse: RotateCcw, same: Minus } as const

const ask = () => undefined

export function DecisionsPreview() {
  return (
    <main className="review-index" id="main-content">
      <header className="review-index__head">
        <Wordmark />
        <h1>Decisions</h1>
        <p>
          Fictional data. A signal becomes a decision in one click. Steerloom
          keeps that day’s numbers, and on the check date shows what moved and
          what it cannot attribute.
        </p>
      </header>
      <div className="review-signals report">
        <h2>1. Deciding on a signal</h2>
        <p className="review-signals__note">
          “Decide” sits next to the investigation link on every signal card. The
          form is three fields; the baseline is captured, not typed.
        </p>
        <DecideOnSignal />

        <h2>2. The check: did it work?</h2>
        <p className="review-signals__note">
          On the check date the decision comes back to the top of the briefing,
          then against now. The caveat is the part a Jira filter can never give
          you.
        </p>
        <CheckCard decision={decisions[0]!} />

        <h2>3. Decisions, in the briefing</h2>
        <p className="review-signals__note">
          Closed by default like “Flagged last week”. The headline answers “what
          did we change, and did it matter?” in one line.
        </p>
        <DecisionsPanel />
      </div>
    </main>
  )
}

function DecideOnSignal() {
  const [open, setOpen] = useState(true)
  return (
    <div className="decide">
      <SignalCard signal={pileUp} onAsk={ask} />
      <div className="decide__row">
        <GlassButton
          variant={open ? 'quiet' : 'secondary'}
          size="compact"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Not now' : 'Decide'}
        </GlassButton>
      </div>
      {open && (
        <form
          className="decide__form"
          aria-label="Record a decision"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="decide__field decide__field--wide">
            <span>What will you do?</span>
            <GlassInput
              defaultValue="Limit Review to 4 items: nothing new enters until one leaves"
              placeholder="One sentence, in the team’s words"
            />
          </label>
          <label className="decide__field">
            <span>Who owns it</span>
            <GlassInput defaultValue="Dana" />
          </label>
          <label className="decide__field">
            <span>Check on</span>
            <GlassInput type="date" defaultValue="2026-11-14" />
            <small>Two weeks: enough finished items to tell.</small>
          </label>
          <p className="decide__baseline">
            <strong>Kept for the check:</strong> 6 of 12 active items in Review
            · 58% of finished time spent there · usual limit 101 days · 20
            finished in the last 2 weeks.
          </p>
          <div className="decide__actions">
            <GlassButton variant="primary" type="submit">
              Record the decision
            </GlassButton>
            <span className="decide__hint">
              Nothing is written to Jira. Read-only, always.
            </span>
          </div>
        </form>
      )}
    </div>
  )
}

function CheckCard({ decision }: { decision: Decision }) {
  return (
    <article className="check sl-rise" aria-labelledby={`check-${decision.id}`}>
      <div className="check__head">
        <StatusBadge tone="success" showDot>
          Check due
        </StatusBadge>
        <p className="check__since">
          Decided {decision.decided} by {decision.owner} · answers “
          {decision.answers}”
        </p>
      </div>
      <h3 id={`check-${decision.id}`} className="check__title">
        {decision.what}
      </h3>
      <dl className="check__grid">
        <div className="check__cols" aria-hidden="true">
          <span />
          <span>{decision.decided}</span>
          <span>Today</span>
        </div>
        {decision.baseline.map((row) => (
          <div className="check__row" key={row.label} data-moved={row.moved}>
            <dt>{row.label}</dt>
            <dd className="check__then">{row.then}</dd>
            <dd className="check__now">
              {row.now}
              {row.moved && <UiIcon icon={movedIcon[row.moved]} size={14} />}
            </dd>
          </div>
        ))}
      </dl>
      <p className="check__verdict">
        <strong>{decision.verdict}</strong> {decision.caveat}
      </p>
      <div className="check__actions">
        <GlassButton variant="primary" size="compact">
          Keep it, check again Nov 28
        </GlassButton>
        <GlassButton variant="quiet" size="compact">
          Call it done
        </GlassButton>
        <GlassButton variant="quiet" size="compact">
          Drop it
        </GlassButton>
      </div>
    </article>
  )
}

function DecisionsPanel() {
  const tried = decisions.filter(({ state }) => state !== 'open')
  const moved = tried.filter(({ baseline }) =>
    baseline.some(({ moved }) => moved === 'better'),
  )
  return (
    <details className="flagged decisions" open>
      <summary className="flagged__summary">
        <div className="flagged__header">
          <h2 className="flagged__title">Decisions</h2>
          <span className="flagged__count">{decisions.length} since Sep</span>
          <UiIcon icon={ChevronDown} className="flagged__chevron" />
        </div>
        <p className="flagged__headline">
          <strong>
            {moved.length} of {tried.length}
          </strong>{' '}
          decisions tried moved the numbers. 1 is waiting for its check.
        </p>
      </summary>
      <ul className="decisions__list">
        {decisions.map((decision) => (
          <li
            key={decision.id}
            className="decisions__row"
            data-state={decision.state}
          >
            <div className="decisions__what">
              <strong>{decision.what}</strong>
              <span>
                {decision.owner} · decided {decision.decided} · answers “
                {decision.answers}”
              </span>
            </div>
            <div className="decisions__state">
              <StatusBadge tone={stateTone[decision.state]} showDot>
                {stateLabel[decision.state]}
                {decision.state === 'open' ? ` ${decision.check}` : ''}
              </StatusBadge>
              <span className="decisions__result">
                {decision.verdict ??
                  `Baseline kept: ${decision.baseline.map(({ then, label }) => `${label.toLowerCase()} ${then}`).join(', ')}`}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </details>
  )
}
