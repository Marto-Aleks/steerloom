import type { AiAgentSkillTrace } from '../../lib/ai/agent'
import type { AnswerCard } from '../../lib/ai/answer-card'
import type { AiReportContext } from '../../lib/ai/report-context'
import {
  codeMismatchQuestion,
  selectedWorkPrompt,
  standupPrompt,
} from '../../lib/ai/review-prompts'
import { demoCodeTrail } from '../../lib/workspace/demo-github'
import { DEMO_FILTERS, demoSnapshot } from '../../lib/workspace/demo'
import { focusSignalAgentPrompt } from '../../lib/statistics/focus-now'
import {
  buildSprintBriefing,
  sprintDescopePrompt,
  sprintGoalPrompt,
  sprintHistoryPrompt,
  sprintPlanningPrompt,
  sprintTodayPrompt,
} from '../../lib/statistics/sprint'
import {
  SCRUM_DEMO_FILTERS,
  scrumDemoCode,
  scrumDemoSnapshot,
} from '../../lib/workspace/demo-scrum'
import {
  activeItemsWithCode,
  codeReview,
  codeTrailGroups,
  computeReport,
  dashboardAiContext,
} from './dashboard-evidence'

/*
 * Steerloom AI in the open demo: answers the real assistant gave on the demo
 * board, recorded once (npm run ai:demo-record) and replayed, so visitors
 * see it work without an account or an AI key. Only the questions recorded
 * here are answered; anything else invites them to try their own board.
 */

/** A question a visitor can pick, and the exact text the dashboard sends. */
export interface DemoAiQuestion {
  label: string
  question: string
  /** Offered in the panel; the rest answer the dashboard's own buttons. */
  starter?: boolean
}

/** What the assistant did and said for one question. */
export interface RecordedAnswer extends DemoAiQuestion {
  message: string
  card?: AnswerCard
  checkedJiraKeys?: string[]
  skill?: AiAgentSkillTrace
  /** The steps shown while it worked, with when each started (ms). */
  trail: Array<{ step: string; label: string; at: number }>
}

export interface DemoAiRecording {
  model: string
  recordedAt: string
  /** The demo's "now" during recording; the board is relative to it. */
  boardNow: string
  /** What the assistant was given, so a changed demo is noticed. */
  fingerprint: string
  answers: RecordedAnswer[]
}

export type DemoTeam = 'kanban' | 'scrum'

/** The demo board as the dashboard computes it, and its AI questions. */
export function demoAiSetup(now = new Date(), team: DemoTeam = 'kanban') {
  if (team === 'scrum') return scrumAiSetup(now)
  const snapshot = demoSnapshot('demo-product', now)
  const code = demoCodeTrail(snapshot)
  const report = computeReport(snapshot, DEMO_FILTERS)
  const review = codeReview(report, code.pullRequests, code.branches)
  const context = dashboardAiContext({
    snapshot,
    filters: DEMO_FILTERS,
    report,
    review,
    pullRequests: code.pullRequests,
    branches: code.branches,
  })
  const p85 = report.metrics.percentile85CycleTime
  const disagree = (codeTrailGroups(report, review)?.groups ?? [])
    .flatMap((group) => group.items)
    .filter((item) => item.mismatch)
    .map((item) => item.key)
  const oldest = [...activeItemsWithCode(report.agingWork, review)].sort(
    (a, b) => b.ageInSelectedColumns - a.ageInSelectedColumns,
  )[0]
  const late = report.focusNow.signals.find(
    (signal) => signal.id === 'delayed-wip',
  )
  // The signal cards' "Ask AI" buttons. Only signals that read the same on
  // every day of the week: "started more than finished" counts calendar
  // weeks, so a recorded answer could contradict the screen.
  const signals = [...report.focusNow.signals, ...(review?.signals ?? [])]
  const signalQuestions = (
    [
      ['active-reentry', 'Why did an item come back?'],
      ['review-wait', 'Why do pull requests wait for review?'],
      ['merged-not-done', 'Why are merged items not Done?'],
      ['checks-failing', 'What is the failing build holding up?'],
    ] as const
  ).flatMap(([id, label]) => {
    const signal = signals.find((candidate) => candidate.id === id)
    return signal ? [{ label, question: focusSignalAgentPrompt(signal) }] : []
  })
  const questions: DemoAiQuestion[] = [
    {
      label: 'What should we raise today?',
      question: standupPrompt(report.agingWork, p85),
      starter: true,
    },
    ...(disagree.length
      ? [
          {
            label: 'Where do the board and the code disagree?',
            question: codeMismatchQuestion(disagree),
            starter: true,
          },
        ]
      : []),
    ...(oldest
      ? [
          {
            label: `Why is ${oldest.item} taking so long?`,
            question: selectedWorkPrompt([oldest], p85),
            starter: true,
          },
        ]
      : []),
    ...(late
      ? [
          {
            label: 'What do we address first in the late work?',
            question: focusSignalAgentPrompt(late),
            starter: true,
          },
        ]
      : []),
    ...signalQuestions,
  ]
  // Only questions about items: their ages and code read the same every
  // day, while weekly totals move with the day of the week, so a recorded
  // period summary could contradict the screen.
  return { snapshot, context, questions }
}

/**
 * The Scrum team: the Sprint tab's questions, exactly as its buttons send
 * them. Its sprint is pinned to today (always day 10 of 14), so they read
 * the same on every day.
 */
function scrumAiSetup(now: Date) {
  const snapshot = scrumDemoSnapshot(now)
  const code = scrumDemoCode(snapshot)
  const report = computeReport(snapshot, SCRUM_DEMO_FILTERS)
  const review = codeReview(report, code.pullRequests, code.branches)
  const sprint = buildSprintBriefing(snapshot)!
  const context = dashboardAiContext({
    snapshot,
    filters: SCRUM_DEMO_FILTERS,
    report,
    review,
    pullRequests: code.pullRequests,
    branches: code.branches,
    sprint,
  })
  const active = sprint.active!
  const questions: DemoAiQuestion[] = [
    {
      label: 'What to raise today',
      question: sprintTodayPrompt(active),
      starter: true,
    },
    {
      label: 'Will we meet the goal?',
      question: sprintGoalPrompt(active),
      starter: true,
    },
    {
      label: 'What to descope',
      question: sprintDescopePrompt(active, sprint.unit),
      starter: true,
    },
    {
      label: 'What do the last sprints tell us?',
      question: sprintHistoryPrompt(sprint.history, sprint.unit),
      starter: true,
    },
    ...(sprint.planning && sprint.planning.planned > sprint.planning.high
      ? [
          {
            label: 'Choose what to leave out',
            question: sprintPlanningPrompt(sprint.planning, sprint.unit),
          },
        ]
      : []),
    ...sprint.signals.map((signal) => ({
      label: signal.title,
      question: focusSignalAgentPrompt(signal),
    })),
  ]
  return { snapshot, context, questions }
}

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The recorded answer to exactly this question, if there is one. */
export function recordedAnswer(
  recording: DemoAiRecording | undefined,
  question: string,
): RecordedAnswer | undefined {
  const wanted = normalise(question)
  return recording?.answers.find(
    (answer) => normalise(answer.question) === wanted,
  )
}

/**
 * A short stable hash of what the assistant is given, without the times
 * that move with the day (the board is relative to "now").
 */
export function contextFingerprint(context: AiReportContext): string {
  const text = JSON.stringify(context).replace(
    /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g,
    '',
  )
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
