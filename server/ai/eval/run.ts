import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { RELEASE } from '../../http/release'
import { loadInstallationProxy } from '../../jira/config'
import { systemProxy } from '../../local/system-proxy'
import { WorkspaceStore } from '../../workspace/store'
import type { AnswerCard } from '../../../src/lib/ai/answer-card'
import type { AiReportContext } from '../../../src/lib/ai/report-context'
import { finishAnswer } from '../answer-card'
import { runAgent } from '../agent'
import { AiClient, type AiUsage } from '../client'
import { loadAiServerConfig, type AiServerConfig } from '../config'
import { aiConfigFromKey } from '../workspace-key'
import {
  EVAL_CONTEXT,
  EVAL_CONTEXT_NO_CODE,
  EVAL_SPRINT_CONTEXT,
  evalBoard,
} from './board'
import { EVAL_CASES, scoreAnswer, type EvalCase } from './cases'

/*
 * Runs the test questions against the real AI, on the fictional board, and
 * scores each answer. Read-only and offline from Jira and GitHub: the board
 * is in memory. Only the AI provider is called, and that costs money.
 *
 *   npm run ai:eval                         AI from the environment / .env.local
 *   npm run ai:eval -- --workspace ~/steerloom/steerloom-local/.flowlens
 *                                           the AI key saved in that app
 *   npm run ai:eval -- --only rework-quiet,standup
 *   npm run ai:eval -- --runs 3             each question three times: answers
 *                                           vary, so one pass says little
 *   npm run ai:eval -- --no-judge           word checks only, no model grader
 *   npm run ai:eval -- --rejudge .eval/ai-eval-….json
 *                                           grade a saved run again with
 *                                           today's checks (add --record to
 *                                           keep the line); --rescore does the
 *                                           word checks only, with no AI call
 *
 * A run of every question adds one line to history.csv beside this file, so
 * a release can be compared with the one before.
 */

const args = process.argv.slice(2)
const option = (name: string) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}
const flag = (name: string) => args.includes(`--${name}`)
const expand = (path: string) => resolve(path.replace(/^~(?=\/|$)/, homedir()))

const HISTORY = join(import.meta.dirname, 'history.csv')
const HISTORY_COLUMNS =
  'date,release,model,questions,runs_each,passed_runs,total_runs,median_seconds,model_calls,input_tokens,cached_tokens,output_tokens'

const BOARDS: Record<NonNullable<EvalCase['board']>, AiReportContext> = {
  kanban: EVAL_CONTEXT,
  hosted: EVAL_CONTEXT_NO_CODE,
  sprint: EVAL_SPRINT_CONTEXT,
}

function aiConfig(): AiServerConfig {
  const workspace = option('workspace')
  if (!workspace) {
    const fromEnvironment = loadAiServerConfig()
    if (!fromEnvironment.missing.length && !fromEnvironment.invalid.length)
      return fromEnvironment
    // The demo recorder's key, when the app's own AI settings are not set.
    const key = anthropicKey()
    return key
      ? aiConfigFromKey({
          provider: 'anthropic',
          apiKey: key,
          model: process.env.EVAL_AI_MODEL || 'claude-sonnet-5-5',
        })
      : fromEnvironment
  }
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

/** ANTHROPIC_API_KEY from the environment or .env.local, as the recorder reads it. */
function anthropicKey(): string | undefined {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const file = resolve('.env.local')
  if (!existsSync(file)) return undefined
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((entry) => /^\s*ANTHROPIC_API_KEY\s*=/.test(entry))
  return (
    line
      ?.split('=')
      .slice(1)
      .join('=')
      .trim()
      .replace(/^["']|["']$/g, '') || undefined
  )
}

/** "38400 in (31000 cached), 2100 out": what the provider counted. */
function tokens(
  usage: Pick<AiUsage, 'inputTokens' | 'cachedTokens' | 'outputTokens'>,
): string {
  return `${usage.inputTokens} in (${usage.cachedTokens} cached), ${usage.outputTokens} out`
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : 0
}

/*
 * The model grader. Word checks catch hard rules (a field name, a pronoun,
 * an invented key) and miss judgment: a right cause in other words fails
 * them, a wrong one with the right words passes. A second model reads the
 * answer against what a correct one says.
 */
const JUDGE = `You grade one answer from an assistant that explains a fictional delivery board to the person who leads the team. You are given the question, what a correct answer says, what it must not claim, and the answer.

Reply with one JSON object and nothing else:
{"correct": true or false, "invented": true or false, "actionable": true or false, "why": "one sentence"}

- correct: the answer says what the expected line says, in any wording, and gives it first or prominently. Further points that are true of the same board do not make it incorrect; an answer that leaves the expected point out, or contradicts it, is not correct.
- invented: the answer states as fact a cause, an event or something about a person that contradicts the expected line or is on the must-not list. A possibility offered as a possibility is not invented, and neither is an extra point the expected line does not mention.
- actionable: an answer to a why or what-to-do question ends in a step that a named person or the team can take. When the question asks for a fact, a number, where the time goes, whether something moved, how something is calculated or a draft message, this is true whatever the answer ends with.

Judge only against what you are given. Be strict about correct and invented, and brief in why.`

interface Verdict {
  pass: boolean
  why: string
}

async function judgeOnce(
  client: AiClient,
  test: EvalCase,
  answer: string,
): Promise<Verdict> {
  const mustNot = [
    ...[...(test.never ?? []), ...(test.verdictNever ?? [])].map(
      ({ idea }) => idea,
    ),
    ...(test.mustNot ?? []),
  ]
    .map((idea) => `- ${idea}`)
    .join('\n')
  const reply = await client.ask(
    JUDGE,
    `QUESTION\n${test.question}\n\nA CORRECT ANSWER SAYS\n${test.expect}\n\nIT MUST NOT\n${mustNot || '- (nothing listed)'}\n\nTHE ANSWER\n${answer}`,
    AbortSignal.timeout(120_000),
  )
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1)) as {
      correct?: unknown
      invented?: unknown
      actionable?: unknown
      why?: unknown
    }
    const problems = [
      parsed.correct === true ? '' : 'not the expected answer',
      parsed.invented === false ? '' : 'states something invented',
      parsed.actionable === true ? '' : 'no step anyone can take',
    ].filter(Boolean)
    const why = typeof parsed.why === 'string' ? parsed.why.slice(0, 240) : ''
    return {
      pass: problems.length === 0,
      why: problems.length ? `${problems.join(', ')}: ${why}` : why,
    }
  } catch {
    return { pass: false, why: 'the grader did not answer in a readable shape' }
  }
}

/** The grader's verdict; asked once more when its reply cannot be read. */
async function judge(
  client: AiClient,
  test: EvalCase,
  answer: string,
): Promise<Verdict> {
  const first = await judgeOnce(client, test, answer)
  return first.why.startsWith('the grader did not answer')
    ? judgeOnce(client, test, answer)
    : first
}

interface Run {
  pass: boolean
  failures: string[]
  answer: string
  card?: AnswerCard
  reads: Array<{ keys: string[]; detail: boolean }>
  seconds: number
  usage: AiUsage
  judge?: string
}

async function ask(
  config: AiServerConfig,
  test: EvalCase,
  grader: AiClient | null,
): Promise<Run> {
  const board = evalBoard()
  const context = BOARDS[test.board ?? 'kanban']
  // One client per answer, so its counts are that answer's cost.
  const client = new AiClient(config)
  const started = Date.now()
  let answer = ''
  let card: AnswerCard | undefined
  let error: string | undefined
  try {
    const result = await runAgent({
      client,
      reader: board.reader,
      context,
      messages: [
        ...(test.history ?? []),
        { role: 'user', content: test.question },
      ],
      boardAllowed: !test.declined,
      boardDeclined: test.declined === true,
      report: () => undefined,
      signal: AbortSignal.timeout(240_000),
    })
    // As the reader sees it: a checked card's text, or the plain answer.
    const finished = finishAnswer(
      typeof result.message === 'string' ? result.message : '',
      context,
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
    : scoreAnswer(test, answer, board.readKeys(), card ? 'card' : 'text')
  let graded: Verdict | undefined
  if (grader && !error && answer)
    graded = await judge(grader, test, answer).catch(
      (caught: unknown): Verdict => ({
        pass: false,
        why: `the grader failed: ${caught instanceof Error ? caught.message : String(caught)}`,
      }),
    )
  const failures = [
    ...score.failures,
    ...(graded && !graded.pass ? [`grader: ${graded.why}`] : []),
  ]
  return {
    pass: failures.length === 0,
    failures,
    answer,
    ...(card ? { card } : {}),
    reads: board.reads,
    seconds,
    usage: client.usage(),
    ...(graded ? { judge: graded.why } : {}),
  }
}

/**
 * Grades answers saved by an earlier run again, with today's checks: the
 * word checks alone (--rescore, no AI call), or with the model grader too
 * (--rejudge), so a run from before a change to the checks can be compared
 * with one from after it without asking every question again.
 */
async function regrade(path: string, grader: AiClient | null) {
  const saved = JSON.parse(readFileSync(expand(path), 'utf8')) as {
    model?: string
    release?: string
    runsEach?: number
    total?: {
      requests: number
      inputTokens: number
      cachedTokens: number
      outputTokens: number
    }
    results: Array<{
      id: string
      answer?: string
      reads?: Array<{ keys: string[] }>
      runs?: Array<{
        answer: string
        card?: unknown
        seconds?: number
        reads: Array<{ keys: string[] }>
      }>
    }>
  }
  let passed = 0
  let total = 0
  let questions = 0
  const seconds: number[] = []
  for (const result of saved.results) {
    const test = EVAL_CASES.find((item) => item.id === result.id)
    if (!test) continue
    questions++
    const runs = result.runs ?? [
      { answer: result.answer ?? '', reads: result.reads ?? [] },
    ]
    let passes = 0
    const failures = new Set<string>()
    for (const run of runs) {
      const score = scoreAnswer(
        test,
        run.answer,
        new Set(run.reads.flatMap((read) => read.keys)),
        'card' in run ? (run.card ? 'card' : 'text') : undefined,
      )
      const graded =
        grader && run.answer
          ? await judge(grader, test, run.answer).catch(
              (): Verdict => ({ pass: false, why: 'the grader failed' }),
            )
          : undefined
      score.failures.forEach((failure) => failures.add(failure))
      if (graded && !graded.pass) failures.add(`grader: ${graded.why}`)
      total++
      if ('seconds' in run && typeof run.seconds === 'number')
        seconds.push(run.seconds)
      if (score.pass && (!graded || graded.pass)) {
        passed++
        passes++
      }
    }
    console.log(
      `${passes === runs.length ? '✓' : passes ? '~' : '✗'} ${`${passes}/${runs.length}`.padEnd(4)} ${test.id.padEnd(22)} ${[...failures].join('; ')}`,
    )
  }
  console.log(
    `\n${passed} of ${total} runs passed (${grader ? 're-graded by word checks and a model' : 'word checks only, re-scored'})`,
  )
  if (flag('record') && grader) {
    if (!existsSync(HISTORY)) writeFileSync(HISTORY, `${HISTORY_COLUMNS}\n`)
    const used = grader.usage()
    appendFileSync(
      HISTORY,
      `${[
        new Date().toISOString().slice(0, 10),
        `${saved.release ?? 'unknown'} re-graded`,
        saved.model ?? 'unknown',
        questions,
        saved.runsEach ?? 1,
        passed,
        total,
        median(seconds),
        (saved.total?.requests ?? 0) + used.requests,
        (saved.total?.inputTokens ?? 0) + used.inputTokens,
        (saved.total?.cachedTokens ?? 0) + used.cachedTokens,
        (saved.total?.outputTokens ?? 0) + used.outputTokens,
      ].join(',')}\n`,
    )
    console.log(`Recorded in ${HISTORY}`)
  }
}

async function main() {
  const saved = option('rescore')
  if (saved) return regrade(saved, null)
  const config = aiConfig()
  if (config.missing.length || config.invalid.length)
    throw new Error(
      `The AI is not set up: ${[...config.missing, ...config.invalid].join(', ')}. Use --workspace with the Steerloom app's .flowlens folder.`,
    )
  const again = option('rejudge')
  if (again) return regrade(again, new AiClient(config))
  const only = option('only')?.split(',')
  const runsEach = Math.max(1, Math.min(5, Number(option('runs')) || 1))
  const cases = EVAL_CASES.filter((test) => !only || only.includes(test.id))
  const grader = flag('no-judge') ? null : new AiClient(config)
  const total = {
    requests: 0,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
  }
  const results = []
  console.log(
    `Steerloom AI test questions · ${config.model} · ${cases.length} questions × ${runsEach}${grader ? ' · graded by word checks and a model' : ' · word checks only'}\n`,
  )
  for (const test of cases) {
    const runs: Run[] = []
    for (let index = 0; index < runsEach; index++)
      runs.push(await ask(config, test, grader))
    for (const run of runs) {
      total.requests += run.usage.requests
      total.inputTokens += run.usage.inputTokens
      total.cachedTokens += run.usage.cachedTokens
      total.outputTokens += run.usage.outputTokens
    }
    const passes = runs.filter((run) => run.pass).length
    const failures = [...new Set(runs.flatMap((run) => run.failures))]
    results.push({
      id: test.id,
      board: test.board ?? 'kanban',
      question: test.question,
      expect: test.expect,
      passes,
      runs,
    })
    console.log(
      `${passes === runs.length ? '✓' : passes ? '~' : '✗'} ${`${passes}/${runs.length}`.padEnd(4)} ${test.id.padEnd(22)} ${String(median(runs.map((run) => run.seconds))).padStart(3)}s  ${runs.map((run) => (run.card ? 'card' : 'text')).join(',')}  ${failures.join('; ')}`,
    )
  }
  const totalRuns = results.reduce((sum, result) => sum + result.runs.length, 0)
  const passedRuns = results.reduce((sum, result) => sum + result.passes, 0)
  const seconds = median(
    results.flatMap((result) => result.runs.map((run) => run.seconds)),
  )
  // The grader's own calls are part of what a run costs.
  const graderUsage = grader?.usage()
  if (graderUsage) {
    total.requests += graderUsage.requests
    total.inputTokens += graderUsage.inputTokens
    total.cachedTokens += graderUsage.cachedTokens
    total.outputTokens += graderUsage.outputTokens
  }
  console.log(
    `\n${passedRuns} of ${totalRuns} runs passed · ${results.filter((result) => result.passes === result.runs.length).length} of ${results.length} questions passed every run`,
  )
  console.log(
    `${total.requests} model calls · ${tokens(total)} · median ${seconds}s an answer`,
  )

  const out = expand(option('out') ?? '.eval')
  mkdirSync(out, { recursive: true })
  const when = new Date().toISOString()
  const stamp = when.replace(/[:.]/g, '-').slice(0, 19)
  const json = join(out, `ai-eval-${stamp}.json`)
  writeFileSync(
    json,
    JSON.stringify(
      {
        model: config.model,
        release: RELEASE.version,
        when,
        runsEach,
        passedRuns,
        totalRuns,
        total,
        results,
      },
      null,
      2,
    ),
  )
  const markdown = join(out, `ai-eval-${stamp}.md`)
  writeFileSync(
    markdown,
    [
      `# Steerloom AI test questions · ${config.model} · release ${RELEASE.version}`,
      `${passedRuns} of ${totalRuns} runs passed · ${when}`,
      ...results.map((result) => {
        const shown = result.runs.find((run) => !run.pass) ?? result.runs[0]!
        return `\n## ${result.passes === result.runs.length ? '✓' : '✗'} ${result.passes}/${result.runs.length} · ${result.question}\n\n**Board:** ${result.board} · **Expected:** ${result.expect}\n\n${shown.failures.length ? `**Failed:** ${shown.failures.join('; ')}\n\n` : ''}**Read:** ${[...new Set(shown.reads.flatMap((read) => read.keys))].join(', ') || 'nothing'} · ${shown.seconds}s · ${shown.usage.requests} model calls\n\n${shown.answer}`
      }),
    ].join('\n'),
  )
  console.log(`Answers: ${markdown}`)

  // One line per full run, kept with the code: a release against the last.
  if (!only && !flag('no-record')) {
    if (!existsSync(HISTORY)) writeFileSync(HISTORY, `${HISTORY_COLUMNS}\n`)
    appendFileSync(
      HISTORY,
      `${[
        when.slice(0, 10),
        RELEASE.version,
        config.model || 'gateway default',
        results.length,
        runsEach,
        passedRuns,
        totalRuns,
        seconds,
        total.requests,
        total.inputTokens,
        total.cachedTokens,
        total.outputTokens,
      ].join(',')}\n`,
    )
    console.log(`Recorded in ${HISTORY}`)
  }
  process.exitCode = passedRuns === totalRuns ? 0 : 1
}

main().catch((caught: unknown) => {
  console.error(caught instanceof Error ? caught.message : caught)
  process.exitCode = 2
})
