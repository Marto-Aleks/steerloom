import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ProgressEvent } from '../../../src/lib/progress'
import {
  contextFingerprint,
  demoAiSetup,
  type DemoAiRecording,
  type DemoTeam,
  type RecordedAnswer,
} from '../../../src/features/analysis/demo-ai'
import { finishAnswer } from '../answer-card'
import { runAgent } from '../agent'
import { AiClient } from '../client'
import { aiConfigFromKey, DEFAULT_ANTHROPIC_MODEL } from '../workspace-key'
import { demoBoardReader } from './demo-board'
import { DEMO_ITEM_NOTES } from '../../../src/lib/workspace/demo'
import { SCRUM_DEMO_NOTES } from '../../../src/lib/workspace/demo-scrum'

/*
 * Records Steerloom AI's answers to the open demo's questions, on the demo
 * board, with the real assistant. The demo replays them, so visitors see it
 * work without an account or a key. Run it again whenever the demo board,
 * its questions or the assistant change (a test says when):
 *
 *   ANTHROPIC_API_KEY in .env.local (or the environment), then
 *   npm run ai:demo-record
 *
 * Uses Steerloom's default Claude model, the one most people will pick.
 */

/** Which demo team: npm run ai:demo-record -- scrum (Kanban by default). */
const TEAM: DemoTeam = process.argv[2] === 'scrum' ? 'scrum' : 'kanban'
const OUT = resolve(
  TEAM === 'scrum'
    ? 'src/features/analysis/demo-ai-answers-scrum.json'
    : 'src/features/analysis/demo-ai-answers.json',
)

function anthropicKey(): string {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const file = resolve('.env.local')
  if (existsSync(file)) {
    const line = readFileSync(file, 'utf8')
      .split('\n')
      .find((entry) => /^\s*ANTHROPIC_API_KEY\s*=/.test(entry))
    const value = line
      ?.split('=')
      .slice(1)
      .join('=')
      .trim()
      .replace(/^["']|["']$/g, '')
    if (value) return value
  }
  throw new Error('Add ANTHROPIC_API_KEY to .env.local first.')
}

async function main() {
  const model = process.env.DEMO_AI_MODEL || DEFAULT_ANTHROPIC_MODEL
  const client = new AiClient(
    aiConfigFromKey({ provider: 'anthropic', apiKey: anthropicKey(), model }),
  )
  const boardNow = new Date()
  const { snapshot, context, questions } = demoAiSetup(boardNow, TEAM)
  const answers: RecordedAnswer[] = []
  console.log(
    `Recording ${questions.length} ${TEAM} demo answers with ${model}\n`,
  )
  for (const question of questions) {
    const started = Date.now()
    const trail: RecordedAnswer['trail'] = []
    const result = await runAgent({
      client,
      reader: demoBoardReader(
        snapshot,
        TEAM === 'scrum' ? SCRUM_DEMO_NOTES : DEMO_ITEM_NOTES,
      ),
      context,
      messages: [{ role: 'user', content: question.question }],
      boardAllowed: true,
      boardDeclined: false,
      report: (event: Omit<ProgressEvent, 'type'>) =>
        trail.push({
          step: event.step,
          label: event.label,
          at: Date.now() - started,
        }),
      signal: AbortSignal.timeout(240_000),
    })
    const jira = result.jira as { checkedKeys?: string[] } | undefined
    const checked = jira?.checkedKeys ?? []
    const finished = finishAnswer(
      typeof result.message === 'string' ? result.message : '',
      context,
      { checked: new Set(checked) },
    )
    if (!finished.message) throw new Error(`No answer for "${question.label}"`)
    const skill = result.skill as RecordedAnswer['skill']
    answers.push({
      ...question,
      message: finished.message,
      ...(finished.card ? { card: finished.card } : {}),
      ...(checked.length ? { checkedJiraKeys: checked } : {}),
      ...(skill ? { skill } : {}),
      trail,
    })
    console.log(
      `✓ ${question.label} · ${Math.round((Date.now() - started) / 1000)}s · ${finished.card ? 'card' : 'text'}`,
    )
  }
  const recording: DemoAiRecording = {
    model,
    recordedAt: new Date().toISOString(),
    boardNow: boardNow.toISOString(),
    fingerprint: contextFingerprint(context),
    answers,
  }
  writeFileSync(OUT, `${JSON.stringify(recording, null, 2)}\n`)
  console.log(`\nSaved ${OUT}`)
}

main().catch((caught: unknown) => {
  console.error(caught instanceof Error ? caught.message : caught)
  process.exitCode = 1
})
