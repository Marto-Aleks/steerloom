import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { loadInstallationProxy } from '../../jira/config'
import { systemProxy } from '../../local/system-proxy'
import { WorkspaceStore } from '../../workspace/store'
import type { AnswerCard } from '../../../src/lib/ai/answer-card'
import { finishAnswer } from '../answer-card'
import { runAgent } from '../agent'
import { AiClient } from '../client'
import { loadAiServerConfig, type AiServerConfig } from '../config'
import { aiConfigFromKey } from '../workspace-key'
import { EVAL_CONTEXT, evalBoard } from './board'
import { EVAL_CASES, scoreAnswer } from './cases'

/*
 * Runs the test questions against the real AI, on the fictional board, and
 * scores each answer. Read-only and offline from Jira and GitHub: the board
 * is in memory. Only the AI provider is called.
 *
 *   npm run ai:eval                         AI from the environment / .env.local
 *   npm run ai:eval -- --workspace ~/steerloom/steerloom-local/.flowlens
 *                                           the AI key saved in that app
 *   npm run ai:eval -- --only rework-quiet,standup
 */

const args = process.argv.slice(2)
const option = (name: string) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}
const expand = (path: string) => resolve(path.replace(/^~(?=\/|$)/, homedir()))

function aiConfig(): AiServerConfig {
  const workspace = option('workspace')
  if (!workspace) return loadAiServerConfig()
  const store = new WorkspaceStore(expand(workspace))
  const userId = store.aiUserIds()[0]
  const key = userId ? store.aiKey(userId) : undefined
  if (!key) throw new Error(`No AI key is saved in ${workspace}.`)
  // The same way out as the app: its own proxy setting, else the Mac's.
  const proxyUrl =
    process.env.FLOWLENS_AI_PROXY ||
    loadInstallationProxy(dirname(expand(workspace))) ||
    systemProxy()
  if (proxyUrl) console.log(`Through the proxy at ${new URL(proxyUrl).host}`)
  return aiConfigFromKey(key, { proxyUrl })
}

/** Applies today's checks to answers saved by an earlier run: no AI call. */
function rescore(path: string) {
  const saved = JSON.parse(readFileSync(expand(path), 'utf8')) as {
    results: Array<{
      id: string
      answer: string
      reads: Array<{ keys: string[] }>
    }>
  }
  let passed = 0
  for (const result of saved.results) {
    const test = EVAL_CASES.find((item) => item.id === result.id)
    if (!test) continue
    const score = scoreAnswer(
      test,
      result.answer,
      new Set(result.reads.flatMap((read) => read.keys)),
    )
    if (score.pass) passed++
    console.log(
      `${score.pass ? '✓' : '✗'} ${test.id.padEnd(20)} ${score.failures.join('; ')}`,
    )
  }
  console.log(`\n${passed} of ${saved.results.length} passed (re-scored)`)
}

async function main() {
  const saved = option('rescore')
  if (saved) return rescore(saved)
  const config = aiConfig()
  if (config.missing.length || config.invalid.length)
    throw new Error(
      `The AI is not set up: ${[...config.missing, ...config.invalid].join(', ')}. Use --workspace with the Steerloom app's .flowlens folder.`,
    )
  const client = new AiClient(config)
  const only = option('only')?.split(',')
  const cases = EVAL_CASES.filter((test) => !only || only.includes(test.id))
  const results = []
  console.log(
    `Steerloom AI test questions · ${config.model} · ${cases.length} questions\n`,
  )
  for (const test of cases) {
    const board = evalBoard()
    const started = Date.now()
    let answer = ''
    let card: AnswerCard | undefined
    let error: string | undefined
    try {
      const result = await runAgent({
        client,
        reader: board.reader,
        context: EVAL_CONTEXT,
        messages: [{ role: 'user', content: test.question }],
        boardAllowed: true,
        boardDeclined: false,
        report: () => undefined,
        signal: AbortSignal.timeout(240_000),
      })
      // As the reader sees it: a checked card's text, or the plain answer.
      const finished = finishAnswer(
        typeof result.message === 'string' ? result.message : '',
        EVAL_CONTEXT,
        {
          checked: new Set(
            (result.jira as { checkedKeys?: string[] } | undefined)
              ?.checkedKeys ?? [],
          ),
        },
      )
      answer = finished.message
      card = finished.card
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    const seconds = Math.round((Date.now() - started) / 1000)
    const score = error
      ? { pass: false, failures: [`error: ${error}`] }
      : scoreAnswer(test, answer, board.readKeys())
    results.push({
      id: test.id,
      question: test.question,
      expect: test.expect,
      answer,
      card,
      reads: board.reads,
      searches: board.searches,
      seconds,
      words: answer.split(/\s+/).filter(Boolean).length,
      ...score,
    })
    console.log(
      `${score.pass ? '✓' : '✗'} ${test.id.padEnd(20)} ${String(seconds).padStart(4)}s  ${card ? 'card' : 'text'}  ${score.failures.join('; ')}`,
    )
  }
  const passed = results.filter((result) => result.pass).length
  console.log(`\n${passed} of ${results.length} passed`)

  const out = expand(option('out') ?? '.eval')
  mkdirSync(out, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const json = join(out, `ai-eval-${stamp}.json`)
  writeFileSync(
    json,
    JSON.stringify(
      { model: config.model, when: new Date().toISOString(), passed, results },
      null,
      2,
    ),
  )
  const markdown = join(out, `ai-eval-${stamp}.md`)
  writeFileSync(
    markdown,
    [
      `# Steerloom AI test questions · ${config.model}`,
      `${passed} of ${results.length} passed · ${new Date().toISOString()}`,
      ...results.map(
        (result) =>
          `\n## ${result.pass ? '✓' : '✗'} ${result.question}\n\n**Expected:** ${result.expect}\n\n${result.failures.length ? `**Failed:** ${result.failures.join('; ')}\n\n` : ''}**Read:** ${[...new Set(result.reads.flatMap((read) => read.keys))].join(', ') || 'nothing'} · ${result.seconds}s · ${result.words} words\n\n${result.answer}`,
      ),
    ].join('\n'),
  )
  console.log(`Answers: ${markdown}`)
  process.exitCode = passed === results.length ? 0 : 1
}

main().catch((caught: unknown) => {
  console.error(caught instanceof Error ? caught.message : caught)
  process.exitCode = 2
})
