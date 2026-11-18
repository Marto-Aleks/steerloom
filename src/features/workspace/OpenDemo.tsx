import { lazy, Suspense, useEffect, useState } from 'react'
import { demoCodeTrail } from '../../lib/workspace/demo-github'
import { track } from '../../lib/usage/track'
import { askForFeedbackSoon } from '../../components/feedback-nudge'
import { Wordmark } from '../../components/Wordmark'
import { SegmentedControl, StatusMessage } from '../../components/ui'
import { DEMO_FILTERS, demoSnapshot } from '../../lib/workspace/demo'
import {
  SCRUM_DEMO_FILTERS,
  scrumDemoCode,
  scrumDemoSnapshot,
} from '../../lib/workspace/demo-scrum'
import { DemoCodeHint } from './GithubLocalNote'
import type { AiReplay } from '../analysis/AiChatPanel'
import {
  demoAiSetup,
  recordedAnswer,
  type DemoAiRecording,
  type DemoTeam,
} from '../analysis/demo-ai'
import kanbanAnswers from '../analysis/demo-ai-answers.json'
import scrumAnswers from '../analysis/demo-ai-answers-scrum.json'

/*
 * The demo without an account: steerloom.app/?demo=1 opens two fictional
 * teams, a Kanban team (the default) and a Scrum team (?team=scrum), the
 * same dashboards real boards get. Everything is computed in the browser;
 * nothing is saved. Steerloom AI replays answers it gave on each board (see
 * demo-ai.ts); asking anything else invites people to sign up.
 */

const FlowAnalysis = lazy(() =>
  import('../analysis/FlowAnalysis').then((module) => ({
    default: module.FlowAnalysis,
  })),
)

const SIGN_UP = '/?hosted=1&page=signup'

const teams = {
  kanban: (() => {
    const snapshot = demoSnapshot('demo-product')
    return {
      snapshot,
      filters: DEMO_FILTERS,
      code: demoCodeTrail(snapshot),
      replay: demoAiReplay('kanban', snapshot.loadedAt, kanbanAnswers),
      note: 'a fictional product team',
    }
  })(),
  scrum: (() => {
    const snapshot = scrumDemoSnapshot()
    return {
      snapshot,
      filters: SCRUM_DEMO_FILTERS,
      code: scrumDemoCode(snapshot),
      replay: demoAiReplay('scrum', snapshot.loadedAt, scrumAnswers),
      note: 'a fictional Scrum team',
    }
  })(),
}

/** Recorded answers, when there are any for this team's questions. */
function demoAiReplay(
  team: DemoTeam,
  loadedAt: string,
  answers: unknown,
): AiReplay | undefined {
  const recording = answers as DemoAiRecording
  const { questions } = demoAiSetup(new Date(loadedAt), team)
  const answered = questions.filter((question) =>
    recordedAnswer(recording, question.question),
  )
  return answered.length
    ? {
        recording,
        questions: answered,
        signUpHref: SIGN_UP,
        onAsked: () => track('demo_ai_asked'),
      }
    : undefined
}

const teamFromUrl = (): DemoTeam =>
  new URLSearchParams(window.location.search).get('team') === 'scrum'
    ? 'scrum'
    : 'kanban'

export function OpenDemo() {
  const [team, setTeam] = useState<DemoTeam>(teamFromUrl)
  useEffect(() => track('demo_opened'), [])
  useEffect(() => {
    if (team === 'scrum') track('demo_scrum_opened')
  }, [team])
  // Loomy asks whether it looks useful: once per browser, after a while.
  useEffect(() => askForFeedbackSoon('demo'), [])
  const choose = (next: DemoTeam) => {
    setTeam(next)
    // The address says which team, so it can be shared.
    const url = new URL(window.location.href)
    if (next === 'scrum') url.searchParams.set('team', 'scrum')
    else url.searchParams.delete('team')
    window.history.replaceState(null, '', url)
  }
  const shown = teams[team]
  return (
    <div className="app-shell workspace-app">
      <div className="ambient-canvas" aria-hidden="true">
        <span className="ambient-canvas__orb ambient-canvas__orb--blue" />
        <span className="ambient-canvas__orb ambient-canvas__orb--mint" />
      </div>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <div className="workspace-container">
        <header className="open-demo__bar">
          <a href="/?hosted=1" aria-label="Steerloom home">
            <Wordmark />
          </a>
          <SegmentedControl
            label="Demo team"
            className="open-demo__teams"
            options={[
              { value: 'kanban', label: 'Kanban team' },
              { value: 'scrum', label: 'Scrum team' },
            ]}
            value={team}
            onChange={choose}
          />
          <p className="open-demo__note">
            <strong>Demo</strong> · {shown.note}. Nothing you do here is saved.
          </p>
          <a className="glass-button" data-variant="primary" href={SIGN_UP}>
            Try it with your board
          </a>
        </header>
        <main id="main-content" className="workspace-main">
          <Suspense
            fallback={
              <StatusMessage variant="loading">
                Calculating the demo briefing…
              </StatusMessage>
            }
          >
            <FlowAnalysis
              key={team}
              snapshot={shown.snapshot}
              filters={shown.filters}
              aiChat={Boolean(shown.replay)}
              aiReplay={shown.replay}
              pullRequests={shown.code.pullRequests}
              branches={shown.code.branches}
              codeHint={<DemoCodeHint />}
            />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
