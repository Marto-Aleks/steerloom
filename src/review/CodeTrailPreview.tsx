import type { FocusSignal } from '../lib/statistics/focus-now'
import type { StageLoad } from '../lib/statistics/briefing'
import type { WorkInProgressAgePoint } from '../types'
import { HeroSignal } from '../features/analysis/TodayPanel'
import { WorkStagesPanel } from '../features/analysis/WorkStagesPanel'
import {
  CodeReviewPanel,
  type CodeReviewGroup,
} from '../features/analysis/CodeReviewPanel'
import { Wordmark } from '../components/Wordmark'
import './review.css'

/*
 * Development-only mock: GitHub as one code trail per item. Branch, commits,
 * pull request, review and merge become a single code state, compared with
 * the board's stage. Fictional data throughout; nothing here is built yet.
 */
const browse = (key: string) => `https://example.atlassian.net/browse/${key}`
const ask = () => undefined

const late: FocusSignal = {
  id: 'delayed-wip',
  severity: 'critical',
  title: '6 items past the usual 21 days',
  evidence: 'Oldest: FLOW-131, 34 days in progress, 1.6× the usual.',
  action: 'Review the delayed items and agree what to unblock first.',
}

// One vocabulary for every line; a note only where the code adds something.
const lateItems: WorkInProgressAgePoint[] = [
  [
    'FLOW-131',
    34,
    'Review · approved 2d, not merged',
    'Approved 2 days ago; nobody has merged it.',
  ],
  [
    'FLOW-104',
    31,
    'In progress · coding, quiet 21d',
    'A branch exists; its last commit was 21 days ago.',
  ],
  [
    'FLOW-112',
    29,
    'Review · no first look · 6d',
    'The pull request has been ready for 6 days with no review.',
  ],
  [
    'FLOW-140',
    27,
    'Review · no linked code',
    'No branch or pull request names this item, but the board says Review.',
  ],
  [
    'FLOW-127',
    24,
    'In progress · merged 3d ago',
    'The code was merged 3 days ago; the card is still In progress.',
  ],
  [
    'FLOW-119',
    22,
    'In progress',
    'Coding; last commit today. The board and the code agree.',
  ],
].map(([item, age, status, detail]) => ({
  item: item as string,
  browseUrl: browse(item as string),
  ageInSelectedColumns: age as number,
  currentStatus: status as string,
  statusDetail: detail as string,
}))

const loads: StageLoad[] = [
  { id: 'progress', name: 'In progress', count: 7, late: 3, timeShare: 0.45 },
  { id: 'review', name: 'Review', count: 5, late: 3, timeShare: 0.55 },
]

const item = (
  key: string,
  detail: string,
  tone?: 'alive' | 'quiet' | 'waiting',
  mismatch?: boolean,
) => ({
  key,
  detail,
  browseUrl: browse(key),
  ...(tone ? { tone } : {}),
  ...(mismatch ? { mismatch } : {}),
})

const groups: CodeReviewGroup[] = [
  {
    id: 'nocode',
    label: 'no linked code',
    items: [
      item(
        'FLOW-140',
        'Review on the board; no branch or pull request names it.',
        undefined,
        true,
      ),
      item('FLOW-150', 'In progress on the board; no branch yet.'),
      item('FLOW-151', 'In progress on the board; no branch yet.'),
      // Many items with no linked code, as on a large board: chips thin out.
      ...Array.from({ length: 29 }, (_, index) =>
        item(`FLOW-${170 + index}`, 'In progress on the board; no branch yet.'),
      ),
    ],
  },
  {
    id: 'coding',
    label: 'coding',
    items: [
      item('FLOW-104', 'Branch, last commit 21 days ago.', 'quiet'),
      item('FLOW-119', 'Branch, last commit today.', 'alive'),
      item('FLOW-152', 'Branch, last commit yesterday.', 'alive'),
    ],
  },
  {
    id: 'review',
    label: 'in review',
    items: [
      item('FLOW-112', 'Ready for 6 days, no review yet.', 'waiting'),
      item('FLOW-133', 'Under review, 4 comments, last one today.', 'alive'),
    ],
  },
  {
    id: 'approved',
    label: 'approved',
    items: [item('FLOW-131', 'Approved 2 days ago, not merged.', 'quiet')],
  },
  {
    id: 'merged',
    label: 'merged',
    items: [
      item(
        'FLOW-127',
        'Merged 3 days ago; the card is still In progress.',
        undefined,
        true,
      ),
      item('FLOW-160', 'Merged today; in testing on the board.'),
    ],
  },
]

export function CodeTrailPreview() {
  return (
    <main className="review-index" id="main-content">
      <header className="review-index__head">
        <Wordmark />
        <h1>GitHub as one code trail</h1>
        <p>
          Fictional data. Branch, commits, pull request, review and merge become
          one code state per item, in one vocabulary, compared with the board.
          Comment text is never read; only counts and times.
        </p>
      </header>
      <div className="review-signals report">
        <h2>1. The top of the briefing</h2>
        <p className="review-signals__note">
          Each late item gets a note only where the code adds something, in the
          same words everywhere: no linked code, coding, no first look, in
          review, approved, merged, plus “quiet Nd” when nothing has moved.
          FLOW-119 has no note: board and code agree. Hover a line for the full
          sentence.
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
        <CodeReviewPanel
          title="Code"
          stage="the board"
          headline="Board and code disagree on 2 items"
          sub="41 active items, grouped by what the code says."
          groups={groups}
          legend={[
            { tone: 'alive', label: 'moving' },
            { tone: 'quiet', label: 'quiet a week+' },
            { tone: 'waiting', label: 'waiting for a first look' },
          ]}
          readyToMergedDays={0.9}
          finishedLinked={38}
          onAsk={ask}
        />

        <h2>2. What changes, what stays</h2>
        <ul className="github-rules">
          <li>
            <strong>One state per item.</strong> Branch, commits, pull request,
            review and merge are read together; the latest activity of any of
            them says whether the work is moving or quiet.
          </li>
          <li>
            <strong>The box replaces “Code review”.</strong> It covers every
            active item, not one stage, and leads with where the board and the
            code disagree.
          </li>
          <li>
            <strong>Matching stays by key.</strong> A branch counts when its
            name holds the item key, as pull requests do today.
          </li>
          <li>
            <strong>Never per person, never text.</strong> Comment counts and
            times only; no author, reviewer or comment wording.
          </li>
        </ul>
      </div>
    </main>
  )
}
