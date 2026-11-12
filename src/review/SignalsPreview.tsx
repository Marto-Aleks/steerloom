import type { FocusSignal } from '../lib/statistics/focus-now'
import { TodayPanel } from '../features/analysis/TodayPanel'
import { Wordmark } from '../components/Wordmark'
import './review.css'

/*
 * Development-only: "Needs a decision today" with one signal and with every
 * signal that can share the panel, on fictional data, so the card layout
 * can be judged without a board in that state.
 */
const JIRA = 'https://example.atlassian.net/issues/?jql=key%20in%20(FLOW-1)'

const rework: FocusSignal = {
  id: 'active-reentry',
  severity: 'info',
  title: '4 active items re-entered the flow',
  evidence:
    '4 items came back after leaving the measured stages, which usually means rework or an unclear done policy.',
  meta: 'FLOW-1635, FLOW-1949, FLOW-2032, FLOW-2110',
  action:
    'Review the re-entered items and check whether rework or an unclear exit policy caused the return.',
  jiraFilter: { label: 'Open the re-entered items in Jira', href: JIRA },
}

const pileUp: FocusSignal = {
  id: 'wip-concentration',
  severity: 'warning',
  title: 'Work is piling up in “Review”',
  evidence:
    '6 of 9 active items (67%) sit in this stage. Work behind it waits until it clears.',
  meta: '6 items in Review',
  action: 'Review capacity, handoffs, and pull policy at this workflow step.',
}

const fewerFinished: FocusSignal = {
  id: 'throughput-drop',
  severity: 'warning',
  title: 'Fewer items finished recently',
  evidence:
    '3 items finished in the last two complete weeks, down from 8 in the two before. If this holds, the forecast dates move later.',
  meta: 'Last 4 complete weeks',
  action:
    'Check whether growing WIP or a downstream queue is slowing completion.',
}

const noLimit: FocusSignal = {
  id: 'insufficient-history',
  severity: 'warning',
  title: 'No usual limit yet',
  evidence:
    'No finished items match this scope, so aging work cannot be compared with a usual limit (P85). Treat today’s view as incomplete.',
  action:
    'Review current work and confirm the measured stages and period. Collect completed history before interpreting service levels.',
}

/*
 * Mock: the two useful counters from “Team details” as signals in the same
 * panel, so they fire only when they matter instead of living in a separate
 * table. Both reuse an existing id for the pill colour; they are not real
 * rules yet.
 */
const onePerson: FocusSignal = {
  id: 'wip-concentration',
  severity: 'warning',
  title: 'Work piles on one person',
  evidence:
    'Dana holds 9 of 21 active items (43%). If Dana is out, 9 items stop.',
  meta: '9 items with Dana',
  action: 'Spread the load: agree what Dana hands over this week.',
  jiraFilter: { label: 'Open Dana’s items in Jira', href: JIRA },
}

const noOwner: FocusSignal = {
  id: 'throughput-drop',
  severity: 'warning',
  title: '5 active items have no owner',
  evidence:
    '5 items are in progress but assigned to nobody, so nobody is moving them.',
  meta: 'FLOW-2041, FLOW-2057, FLOW-2063, FLOW-2070, FLOW-2088',
  action: 'Give each one an owner today, or move it back to the backlog.',
  jiraFilter: { label: 'Open the unowned items in Jira', href: JIRA },
}

const ask = () => undefined

export function SignalsPreview() {
  return (
    <main className="review-index" id="main-content">
      <header className="review-index__head">
        <Wordmark />
        <h1>Signal rows</h1>
        <p>
          Fictional data. The same card with one signal, with the three that can
          share the panel under a hero, and with the no-history case.
        </p>
      </header>
      <div className="review-signals report">
        <h2>One signal</h2>
        <TodayPanel signals={[rework]} onAsk={ask} />
        <h2>Every signal that can share the panel</h2>
        <TodayPanel signals={[pileUp, rework, fewerFinished]} onAsk={ask} />
        <h2>No finished items yet</h2>
        <TodayPanel signals={[noLimit, rework]} onAsk={ask} />
        <h2>Mock: Team details folded into signals</h2>
        <p className="review-signals__note">
          Instead of a separate table, the two counters that still matter become
          signals that fire only when they matter. Fictional names and numbers;
          the pill colours borrow existing signals.
        </p>
        <TodayPanel
          signals={[onePerson, noOwner, rework, fewerFinished]}
          onAsk={ask}
        />
      </div>
    </main>
  )
}
