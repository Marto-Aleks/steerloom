import type { FocusSignal } from '../lib/statistics/focus-now'
import type { StageLoad } from '../lib/statistics/briefing'
import type { WorkInProgressAgePoint } from '../types'
import { HeroSignal, TodayPanel } from '../features/analysis/TodayPanel'
import { WorkStagesPanel } from '../features/analysis/WorkStagesPanel'
import { CodeReviewPanel } from '../features/analysis/CodeReviewPanel'
import { Wordmark } from '../components/Wordmark'
import './review.css'

/*
 * Development-only mock: GitHub pull requests inside the briefing. The Jira
 * workflow stays In progress → Review → Done; pull request events show what
 * happens inside Review. Nothing new appears unless GitHub is connected.
 * Fictional data throughout; the signal pills borrow existing signals.
 */
const JIRA = 'https://example.atlassian.net/issues/?jql=key%20in%20(FLOW-1)'
const browse = (key: string) => `https://example.atlassian.net/browse/${key}`

const late: FocusSignal = {
  id: 'delayed-wip',
  severity: 'critical',
  title: '4 items past the usual 21 days',
  evidence: 'Oldest: FLOW-131, 34 days in progress, 1.6× the usual.',
  action: 'Review the delayed items and agree what to unblock first.',
  jiraFilter: { label: 'Open the delayed items in Jira', href: JIRA },
}

// The status line under each key now says where its pull request stands.
const lateItems: WorkInProgressAgePoint[] = [
  ['FLOW-131', 34, 'Review · PR approved · 2d'],
  ['FLOW-112', 29, 'Review · PR not reviewed · 6d'],
  ['FLOW-119', 24, 'Review · PR not reviewed · 3d'],
  ['FLOW-104', 22, 'In progress · no PR'],
].map(([item, age, status]) => ({
  item: item as string,
  browseUrl: browse(item as string),
  ageInSelectedColumns: age as number,
  currentStatus: status as string,
}))

const loads: StageLoad[] = [
  { id: 'progress', name: 'In progress', count: 4, late: 1, timeShare: 0.34 },
  { id: 'review', name: 'Review', count: 6, late: 3, timeShare: 0.58 },
  { id: 'testing', name: 'Testing', count: 2, timeShare: 0.08 },
]

const firstReview: FocusSignal = {
  id: 'wip-concentration',
  severity: 'warning',
  title: 'Pull requests wait 2.6 days for a first review',
  evidence:
    'Half of the time in Review passes before anyone looks at the code. 3 open pull requests have no review yet; the oldest, FLOW-112, has waited 6 days.',
  meta: '3 pull requests without a review',
  action:
    'Agree a first look within one working day, before starting new work.',
  jiraFilter: { label: 'Open the waiting items in Jira', href: JIRA },
}

const mergedNotDone: FocusSignal = {
  id: 'throughput-drop',
  severity: 'info',
  title: '3 items are merged but not Done',
  evidence:
    'Their code was merged 2 to 5 days ago, but the cards still sit in Review. Either testing happens after the merge, or the cards were not moved.',
  meta: 'FLOW-127, FLOW-133, FLOW-136',
  action:
    'Move what is finished, or make testing after the merge its own step.',
  jiraFilter: { label: 'Open the merged items in Jira', href: JIRA },
}

const ask = () => undefined

export function GithubPreview() {
  return (
    <main className="review-index" id="main-content">
      <header className="review-index__head">
        <Wordmark />
        <h1>GitHub in the briefing</h1>
        <p>
          Fictional data. The Jira workflow stays In progress → Review → Done.
          Pull requests show what happens inside Review. Nothing new appears
          unless GitHub is connected.
        </p>
      </header>
      <div className="review-signals report">
        <h2>1. The top of the briefing</h2>
        <p className="review-signals__note">
          No new cards. Each late item’s status line says where its pull request
          stands, and the stage card gets one line: where the time inside Review
          goes.
        </p>
        <div
          className="briefing-stage github-mock"
          data-hero="signal"
          data-layout="split"
        >
          <HeroSignal
            signal={late}
            items={lateItems}
            activeCount={12}
            limitDays={21}
            onAsk={ask}
          />
          <WorkStagesPanel
            loads={loads}
            limitDays={21}
            flow={{ started: 11, finished: 9, days: 14 }}
            finishedCount={41}
          />
        </div>

        <h2>1b. Code review, its own row</h2>
        <p className="review-signals__note">
          The stage card goes back to stages only. A new box answers one
          question: what is the review stage holding today? Items GitHub cannot
          see stay grey, because unknown is not the same as bad.
        </p>
        <div
          className="briefing-stage github-mock"
          data-hero="signal"
          data-layout="split"
        >
          <WorkStagesPanel
            loads={loads}
            limitDays={21}
            flow={{ started: 11, finished: 9, days: 14 }}
            finishedCount={41}
          />
          <CodeReviewPanel
            stage="Review"
            groups={[
              {
                id: 'unreviewed',
                label: 'not reviewed yet',
                items: [
                  {
                    key: 'FLOW-112',
                    detail:
                      'No review yet; the pull request has been ready for 6 days.',
                    browseUrl: 'https://jira.example.invalid/browse/FLOW-112',
                  },
                  {
                    key: 'FLOW-119',
                    detail:
                      'No review yet; the pull request has been ready for 3 days.',
                    browseUrl: 'https://jira.example.invalid/browse/FLOW-119',
                  },
                ],
              },
              {
                id: 'quiet',
                label: 'quiet for a week+',
                items: [
                  {
                    key: 'FLOW-127',
                    detail:
                      'Nothing has happened on the pull request for 9 days, after changes were requested.',
                    browseUrl: 'https://jira.example.invalid/browse/FLOW-127',
                  },
                ],
              },
              {
                id: 'moving',
                label: 'moving',
                items: [
                  {
                    key: 'FLOW-133',
                    detail: 'In review; last change yesterday.',
                    browseUrl: 'https://jira.example.invalid/browse/FLOW-133',
                  },
                ],
              },
              {
                id: 'done',
                label: 'approved or merged',
                items: [
                  {
                    key: 'FLOW-131',
                    detail: 'Approved 2 days ago, not merged yet.',
                    browseUrl: 'https://jira.example.invalid/browse/FLOW-131',
                  },
                ],
              },
              {
                id: 'none',
                label: 'no pull request',
                items: [
                  {
                    key: 'FLOW-140',
                    detail: 'No pull request names this item.',
                    browseUrl: 'https://jira.example.invalid/browse/FLOW-140',
                  },
                ],
              },
            ]}
            onAsk={ask}
            readyToMergedDays={0.9}
            finishedLinked={38}
          />
        </div>

        <h2>2. Needs a decision today</h2>
        <p className="review-signals__note">
          Two signals that fire only when they matter: a first review that takes
          long enough to be the real queue, and finished code whose card never
          moved. In this mock the pills and action links borrow existing
          signals; the real ones get their own.
        </p>
        <TodayPanel signals={[firstReview, mergedNotDone]} onAsk={ask} />

        <h2>3. What stays out</h2>
        <ul className="github-rules">
          <li>
            <strong>No numbers per reviewer.</strong> Waiting is shown per item
            and per stage, never who reviews slowly.
          </li>
          <li>
            <strong>No pull request list.</strong> GitHub already has one; the
            briefing only says what the list means.
          </li>
          <li>
            <strong>Honest coverage.</strong> The line under the bar says how
            many finished items had a linked pull request. Under about 80%, it
            says the split is a rough guide.
          </li>
        </ul>
      </div>
    </main>
  )
}
