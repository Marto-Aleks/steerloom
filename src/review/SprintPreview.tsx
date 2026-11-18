import { useMemo } from 'react'
import { FlowAnalysis } from '../features/analysis/FlowAnalysis'
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
    </main>
  )
}
