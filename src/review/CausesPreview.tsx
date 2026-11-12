import type { FocusSignal } from '../lib/statistics/focus-now'
import type { StageLoad } from '../lib/statistics/briefing'
import type { WorkInProgressAgePoint } from '../types'
import { HeroSignal, TodayPanel } from '../features/analysis/TodayPanel'
import { WorkStagesPanel } from '../features/analysis/WorkStagesPanel'
import { Wordmark } from '../components/Wordmark'
import './review.css'

/*
 * Development-only mock: the causes of delay next to the symptoms. Where
 * finished work spent its time (per stage) and started against finished,
 * on fictional data, in the blocks where they would live.
 */
const LIMIT = 7

const late: FocusSignal = {
  id: 'delayed-wip',
  severity: 'critical',
  title: '3 items past the usual 7 days',
  evidence:
    'Oldest: FLOW-2041, 16 days in progress, 2.3× the usual. 85% of finished items were done within 7 days, so these are already late.',
  action: 'Review the delayed items and agree what to unblock first.',
  meta: 'FLOW-2041, FLOW-2017, FLOW-2058',
}

const lateItems: WorkInProgressAgePoint[] = [
  { item: 'FLOW-2041', ageInSelectedColumns: 16, currentStatus: 'Review' },
  { item: 'FLOW-2017', ageInSelectedColumns: 11, currentStatus: 'Review' },
  { item: 'FLOW-2058', ageInSelectedColumns: 9, currentStatus: 'In progress' },
]

const loads: StageLoad[] = [
  { id: 'progress', name: 'In progress', count: 4, late: 1, timeShare: 0.3 },
  { id: 'review', name: 'Review', count: 6, late: 2, timeShare: 0.58 },
  { id: 'qa', name: 'QA', count: 2, late: 0, timeShare: 0.12 },
]

const startFinish: FocusSignal = {
  id: 'start-finish',
  severity: 'warning',
  title: 'Starting more than finishing',
  evidence:
    '12 items started and 4 finished in the last two complete weeks. Active work grew from 9 to 12.',
  meta: 'Last 2 complete weeks',
  action: 'Finish before starting: agree what the team completes first.',
}

const rework: FocusSignal = {
  id: 'active-reentry',
  severity: 'info',
  title: '2 active items re-entered the flow',
  evidence:
    '2 items came back after leaving the measured stages: often rework or an unclear done policy.',
  meta: 'FLOW-1949, FLOW-2032',
  action:
    'Review the re-entered items and check whether rework or an unclear exit policy caused the return.',
}

const ask = () => undefined

export function CausesPreview() {
  return (
    <main className="review-index" id="main-content">
      <header className="review-index__head">
        <Wordmark />
        <h1>Causes next to symptoms</h1>
        <p>
          Fictional data. The hero names the late work; “Where work sits now”
          adds where finished work spent its time and started against finished;
          the signals gain a row for starting more than finishing.
        </p>
      </header>
      <div className="review-signals report">
        <header className="report-hero" data-tone="attention">
          <div className="report-hero__copy">
            <div className="report-hero__intro">
              <div className="report-hero__text">
                <h1 className="report-hero__headline">
                  3 of 12 active items are past the usual 7 days.
                </h1>
                <p className="report-hero__summary">
                  Most of the time finished work took was spent waiting in
                  Review. 12 items started and 4 finished in the last two weeks,
                  so the queue is growing.
                </p>
              </div>
            </div>
          </div>
        </header>
        <div className="briefing-stage" data-hero="signal" data-layout="split">
          <HeroSignal
            signal={late}
            items={lateItems}
            activeCount={12}
            limitDays={LIMIT}
            onAsk={ask}
          />
          <WorkStagesPanel
            loads={loads}
            limitDays={LIMIT}
            flow={{ started: 12, finished: 4, days: 14 }}
            finishedCount={19}
          />
        </div>
        <TodayPanel signals={[startFinish, rework]} onAsk={ask} />
      </div>
    </main>
  )
}
