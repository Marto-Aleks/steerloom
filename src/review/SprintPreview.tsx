import { useMemo } from 'react'
import { FlowAnalysis } from '../features/analysis/FlowAnalysis'
import { PlanningCheck } from '../features/analysis/SprintView'
import type { PlanningView } from '../lib/statistics/sprint'
import { Wordmark } from '../components/Wordmark'
import {
  scrumDemoCode,
  scrumDemoSnapshot,
  SCRUM_DEMO_FILTERS,
} from '../lib/workspace/demo-scrum'
import './review.css'

/*
 * Development-only: the real dashboard on a fictional Scrum team, so the
 * Sprint tab can be checked exactly as a Scrum board gets it. Every number
 * is calculated from the team's made-up history; nothing is drawn by hand.
 */
const plan: PlanningView = {
  sprint: { id: '125', name: 'Sprint 25', state: 'future' },
  items: [],
  planned: 40,
  unestimated: 0,
  low: 24,
  high: 44,
  usual: 31,
  sprints: 5,
}
const ask = () => undefined

export function SprintPreview() {
  const snapshot = useMemo(() => scrumDemoSnapshot(), [])
  const code = useMemo(() => scrumDemoCode(snapshot), [snapshot])
  return (
    <main className="review-index" id="main-content">
      <header className="review-index__head">
        <Wordmark />
        <h1>Sprints, in their own tab</h1>
        <p>
          The real dashboard on a fictional Scrum team. Scrum boards open on the
          Sprint tab; Kanban boards see the flow briefing only.
        </p>
      </header>
      <div className="review-sprint">
        <FlowAnalysis
          snapshot={snapshot}
          filters={SCRUM_DEMO_FILTERS}
          aiChat={false}
          pullRequests={code.pullRequests}
          branches={code.branches}
        />
      </div>
      <section
        className="review-sprint review-plans"
        aria-label="Planning check cases"
      >
        <h2>Planning the next sprint: the three cases</h2>
        <p>
          Shown under the last sprints’ chart. Fictional numbers: the last 5
          sprints finished 24–44 points, usually 31.
        </p>
        <div className="review-plans__grid">
          <div className="chart-card__footer">
            <p className="review-plans__case">Planned within the usual range</p>
            <PlanningCheck
              planning={{ ...plan, planned: 34 }}
              unit="points"
              onAsk={ask}
            />
          </div>
          <div className="chart-card__footer">
            <p className="review-plans__case">
              Planned above what the team finishes
            </p>
            <PlanningCheck
              planning={{ ...plan, planned: 52, unestimated: 3 }}
              unit="points"
              onAsk={ask}
            />
          </div>
          <div className="chart-card__footer">
            <p className="review-plans__case">Next sprint not created yet</p>
            <p className="planning-check__sub">
              Create the next sprint in Jira to check its plan against what the
              team usually finishes.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
