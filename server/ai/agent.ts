import type { AiReportContext } from '../../src/lib/ai/report-context'
import { AI_CONVERSATION_MESSAGE_LIMIT } from '../../src/lib/ai/conversation'
import type { ProgressReporter } from '../http/progress'
import { chooseAiSkill } from './agent-plan'
import {
  AGENT_STEP_LIMIT,
  boardTools,
  describeToolCall,
  newToolUsage,
  runBoardTool,
  type AgentToolResult,
  codeTool,
  runCodeTool,
} from './agent-tools'
import type { BoardReader } from './board-reader'
import {
  AiUpstreamError,
  buildAiSystemPrompt,
  type AgentMessage,
  type AiChatMessage,
  type AiClient,
} from './client'
import type { AiServerConfig } from './config'
import { getAiSkill } from './skills/registry'

/*
 * The assistant as an agent: the model reads the board itself through the
 * read-only tools in agent-tools.ts, a few calls at a time, until it can
 * answer. The person allows board reading once per conversation; until
 * then the first tool request comes back as a question for them.
 */

/** Gateways that refused tools, by address and model: they get the planner. */
export const toollessEndpoints = new Set<string>()

export const endpointKey = (config: AiServerConfig) =>
  `${config.endpoint}|${config.model}`

/** Calls the model may make in one turn; more are answered as skipped. */
const CALLS_PER_TURN = 6

/** Why and what-to-do questions, whose answer lies in the tickets. */
const diagnosisPattern =
  /\b(?:why|slow\w*|stuck|cause\w*|pattern|bottleneck|block\w*|coach\w*|what (?:should|would|can) (?:i|we|you) do)\b/i

/** Sent once when the model answers a why question without reading the board. */
const CHECK_FIRST =
  'Before you answer, check it on the board: search the stage where work piles up to see whose items they are, and read its oldest three to five items with detail. Then answer in the same shape, with what you found.'

/** A gateway that does not take tool definitions, as opposed to any other failure. */
export function rejectsTools(caught: unknown): boolean {
  if (!(caught instanceof AiUpstreamError)) return false
  if (![400, 404, 415, 422, 501].includes(caught.status)) return false
  return /\b(?:tools?|tool_choice|functions?|function_?call(?:ing)?|functionDeclarations)\b/i.test(
    caught.reason || caught.message,
  )
}

export interface AgentRun {
  client: AiClient
  reader: BoardReader
  context: AiReportContext
  messages: AiChatMessage[]
  conversationSummary?: string
  /** The person allowed board reading for this conversation. */
  boardAllowed: boolean
  /** The person said no: answer from the report alone. */
  boardDeclined: boolean
  report: ProgressReporter
  /** The answer as the AI writes it, piece by piece. */
  onText?: (text: string) => void
  signal: AbortSignal
}

export async function runAgent(
  run: AgentRun,
): Promise<Record<string, unknown>> {
  const { client, reader, signal, report } = run
  const question = run.messages.at(-1)?.content ?? ''
  const skill = getAiSkill(chooseAiSkill(question))
  const system = buildAiSystemPrompt(
    run.context,
    skill,
    run.conversationSummary,
    { board: reader.label, tools: !run.boardDeclined },
  )
  const transcript: AgentMessage[] = run.messages
    .slice(-AI_CONVERSATION_MESSAGE_LIMIT)
    .map((message) =>
      message.role === 'user'
        ? { role: 'user' as const, content: message.content }
        : { role: 'assistant' as const, content: message.content },
    )
  const skillTrace = { id: skill.id, name: skill.name }

  if (run.boardDeclined) {
    report({ step: 'answer', label: 'Writing' })
    const message = await client.chat(
      run.context,
      run.messages.slice(-AI_CONVERSATION_MESSAGE_LIMIT),
      skill,
      run.conversationSummary,
      signal,
    )
    return { message, skill: skillTrace }
  }

  const lookup = run.context.codeLookup ?? []
  const tools = [
    ...boardTools(reader),
    ...(lookup.length ? [codeTool(reader.keyExample)] : []),
  ]
  const usage = newToolUsage()
  const checked = new Set<string>()
  const unavailable = new Set<string>()
  /** Titles of the items read, so the panel can show them on hover. */
  const titles: Record<string, string> = {}
  let detail = false
  let nudged = false
  /** Items whose code trail was read, for the progress line. */
  const codeKeys = new Set<string>()
  /** What has been read so far, so a long wait still says what it rests on. */
  const readSoFar = () =>
    [
      checked.size
        ? `${checked.size} ${checked.size === 1 ? 'item' : 'items'}`
        : '',
      codeKeys.size
        ? `${codeKeys.size} code ${codeKeys.size === 1 ? 'trail' : 'trails'}`
        : '',
    ]
      .filter(Boolean)
      .join(' · ')
  const answer = (text: string) => ({
    message:
      notOnBoard(askedKeys(reader, question), checked, unavailable) ?? text,
    skill: skillTrace,
    ...(checked.size || unavailable.size
      ? {
          jira: {
            requestedKeys: [...checked, ...unavailable],
            checkedKeys: [...checked],
            unavailableKeys: [...unavailable].filter(
              (key) => !checked.has(key),
            ),
            mode: detail ? 'detail' : 'overview',
            source: 'agent-selected report tickets',
            omittedCount: 0,
            titles,
          },
        }
      : {}),
  })

  for (let turn = 0; turn < AGENT_STEP_LIMIT; turn++) {
    report(
      turn === 0
        ? { step: 'plan', label: 'Planning' }
        : { step: 'plan', label: 'Thinking', detail: readSoFar() },
    )
    const step = await client.agentStep(
      system,
      transcript,
      tools,
      signal,
      false,
      run.onText,
    )
    // What the model said it would do next, when it says it: one sentence.
    const intent = firstSentence(step.text)
    if (step.toolCalls.length && intent) report({ step: 'note', label: intent })
    if (!step.toolCalls.length) {
      // Models skip the prompt's "check first" often enough that it is
      // enforced: one nudge when a why question got an answer without reads.
      if (!nudged && !checked.size && diagnosisPattern.test(question)) {
        nudged = true
        if (step.text)
          transcript.push({ role: 'assistant', content: step.text })
        transcript.push({ role: 'user', content: CHECK_FIRST })
        continue
      }
      return answer(step.text)
    }
    if (!run.boardAllowed)
      return {
        confirmation: {
          board: reader.label,
          requests: step.toolCalls
            .slice(0, CALLS_PER_TURN)
            .map((call) => describeToolCall(reader, call)),
          skill: skillTrace,
        },
      }
    transcript.push({
      role: 'assistant',
      content: step.text,
      toolCalls: step.toolCalls,
      raw: step.raw,
    })
    const results: AgentToolResult[] = []
    for (const [index, call] of step.toolCalls.entries()) {
      if (index >= CALLS_PER_TURN) {
        results.push({
          id: call.id,
          name: call.name,
          content: JSON.stringify({
            error: `Skipped: at most ${CALLS_PER_TURN} reads at a time. Ask again if it still matters.`,
          }),
        })
        continue
      }
      if (call.name === 'get_code') {
        if (Array.isArray(call.args.keys))
          call.args.keys
            .filter((key): key is string => typeof key === 'string')
            .forEach((key) => codeKeys.add(key.toUpperCase()))
        report({
          step: 'jira',
          label: describeToolCall(reader, call),
          detail: 'Read-only · GitHub, already loaded',
        })
        results.push(runCodeTool(lookup, call, usage))
        continue
      }
      report({
        step: 'jira',
        label: describeToolCall(reader, call),
        detail: `Read-only · ${reader.label}`,
      })
      const done = await runBoardTool(reader, call, usage, signal)
      done.checked.forEach((key) => checked.add(key))
      Object.assign(titles, done.titles)
      done.unavailable.forEach((key) => unavailable.add(key))
      detail ||= done.detail
      results.push(done.result)
    }
    transcript.push({ role: 'tool', results })
  }

  // Out of turns: answer with what was read.
  report({ step: 'answer', label: 'Writing', detail: readSoFar() })
  const final = await client.agentStep(
    system,
    [
      ...transcript,
      {
        role: 'user',
        content:
          'Answer now with what you have read. Do not call more tools; say what you could not check.',
      },
    ],
    tools,
    signal,
    true,
    run.onText,
  )
  if (!final.text)
    throw new AiUpstreamError(
      502,
      'The AI model kept asking for more board reads without answering. Ask a narrower question.',
    )
  return answer(final.text)
}

/** The first sentence of a model's working note, short enough for a status line. */
export function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  const end = clean.search(/[.!?](\s|$)/)
  const sentence = end > 0 ? clean.slice(0, end + 1) : clean
  return sentence.length > 150
    ? `${sentence.slice(0, 149).trimEnd()}…`
    : sentence
}

/** Item keys the question names, in this board's form. */
export function askedKeys(reader: BoardReader, question: string): string[] {
  const keys = (question.match(/\b[A-Za-z][A-Za-z0-9]*-\d+\b/g) ?? [])
    .map((raw) => reader.normaliseKey(raw))
    .filter((key): key is string => Boolean(key))
  return [...new Set(keys)]
}

/**
 * When every item the question names turned out not to exist, the answer is
 * that, in one sentence: models otherwise fill the gap with other items.
 */
export function notOnBoard(
  asked: string[],
  checked: ReadonlySet<string>,
  unavailable: ReadonlySet<string>,
): string | undefined {
  if (!asked.length) return undefined
  if (!asked.every((key) => unavailable.has(key) && !checked.has(key)))
    return undefined
  const list = asked.join(', ')
  return asked.length === 1
    ? `**${list} is not on this board**, or Steerloom cannot read it. Check the key and ask again.`
    : `**${list} are not on this board**, or Steerloom cannot read them. Check the keys and ask again.`
}
