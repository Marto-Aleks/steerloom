import { lazy, Suspense, useEffect } from 'react'
import { demoCodeTrail } from '../../lib/workspace/demo-github'
import { track } from '../../lib/usage/track'
import { askForFeedbackSoon } from '../../components/feedback-nudge'
import { Wordmark } from '../../components/Wordmark'
import { StatusMessage } from '../../components/ui'
import { DEMO_FILTERS, demoSnapshot } from '../../lib/workspace/demo'
import { DemoCodeHint } from './GithubLocalNote'
import type { AiReplay } from '../analysis/AiChatPanel'
import {
  demoAiSetup,
  recordedAnswer,
  type DemoAiRecording,
} from '../analysis/demo-ai'
import recordedDemoAnswers from '../analysis/demo-ai-answers.json'

/*
 * The demo without an account: steerloom.app/?demo=1 opens the same sample
 * dashboard signed-in people get from "Explore the demo". Everything is
 * computed in the browser from fictional data; nothing is saved. Steerloom
 * AI replays answers it gave on this board (see demo-ai.ts); asking
 * anything else invites people to sign up.
 */

const FlowAnalysis = lazy(() =>
  import('../analysis/FlowAnalysis').then((module) => ({
    default: module.FlowAnalysis,
  })),
)

const SIGN_UP = '/?hosted=1&page=signup'
const snapshot = demoSnapshot('demo-product')
const code = demoCodeTrail(snapshot)
const replay = demoAiReplay()

/** Recorded answers, when there are any for today's demo questions. */
function demoAiReplay(): AiReplay | undefined {
  const recording = recordedDemoAnswers as DemoAiRecording
  const { questions } = demoAiSetup(new Date(snapshot.loadedAt))
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

export function OpenDemo() {
  useEffect(() => track('demo_opened'), [])
  // Loomy asks whether it looks useful: once per browser, after a while.
  useEffect(() => askForFeedbackSoon('demo'), [])
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
          <p className="open-demo__note">
            <strong>Demo</strong> · a fictional product team. Nothing you do
            here is saved.
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
              snapshot={snapshot}
              filters={DEMO_FILTERS}
              aiChat={Boolean(replay)}
              aiReplay={replay}
              pullRequests={code.pullRequests}
              branches={code.branches}
              codeHint={<DemoCodeHint />}
            />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
