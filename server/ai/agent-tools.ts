import type { AiJiraIssueEvidence } from '../../src/lib/ai/jira-evidence'
import type { AiItemPullRequests } from '../../src/lib/ai/pull-request-evidence'
import {
  DETAIL_LIMIT,
  OVERVIEW_LIMIT,
  readSearch,
  type BoardReader,
  type BoardSearch,
} from './board-reader'

/*
 * The tools the assistant may call, in a provider-neutral form that the AI
 * client turns into OpenAI, Anthropic or Gemini tool definitions. Both are
 * read-only. Limits per answer keep a runaway loop from reading the whole
 * board or the model's context from overflowing.
 */

export interface AgentTool {
  name: string
  description: string
  /** JSON Schema subset all three APIs accept: no additionalProperties. */
  parameters: Record<string, unknown>
}

export interface AgentToolCall {
  /** The provider's call id (OpenAI, Anthropic); generated for Gemini. */
  id: string
  name: string
  args: Record<string, unknown>
}

export interface AgentToolResult {
  id: string
  name: string
  content: string
}

/** Per answer: enough to cover a whole set of late items in detail. */
export const TOOL_BUDGET = { detailed: 30, items: 150, searches: 8, code: 30 }
/** Items one get_code call returns. */
const CODE_PER_CALL = 10
/** Model turns per answer before it must answer with what it has. */
export const AGENT_STEP_LIMIT = 8
const RESULT_CHAR_LIMIT = 30_000

export function boardTools(reader: BoardReader): AgentTool[] {
  return [
    {
      name: 'get_items',
      description: `Read items on the team's ${reader.label} board, read-only. Without detail: title, status, assignee, priority, type and dates, for up to ${OVERVIEW_LIMIT} items. With detail: also the description, recent comments, the history of status and assignee changes, parent, children and links, for up to ${DETAIL_LIMIT} items. Keys look like ${reader.keyExample}.`,
      parameters: {
        type: 'object',
        properties: {
          keys: {
            type: 'array',
            items: { type: 'string' },
            description: `Item keys, like ${reader.keyExample}.`,
          },
          detail: {
            type: 'boolean',
            description:
              'true for description, comments, history and links (up to 5 items).',
          },
        },
        required: ['keys'],
      },
    },
    {
      name: 'search_items',
      description: `Find items on the team's ${reader.label} board, read-only, newest change first. Use it for work that is not in the report: an epic's or parent's children, what someone holds, items that have gone quiet, items about a topic. Returns overview fields; read promising ones with get_items and detail.`,
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Words in the title.' },
          status: {
            type: 'string',
            description: `Exact status${reader.label === 'Trello' ? ' (list name)' : ''}.`,
          },
          assignee: {
            type: 'string',
            description: 'Part of the assignee’s name, or "unassigned".',
          },
          type: {
            type: 'string',
            description:
              reader.label === 'Trello'
                ? 'A label name.'
                : 'Item type, like Bug or Story.',
          },
          parent: {
            type: 'string',
            description: `Key of a parent or epic whose children to list, like ${reader.keyExample}.`,
          },
          state: {
            type: 'string',
            enum: ['open', 'done', 'any'],
            description: 'open: not finished; done: finished. Default any.',
          },
          updated_within_days: {
            type: 'integer',
            description: 'Changed in the last N days.',
          },
          not_updated_for_days: {
            type: 'integer',
            description: 'Not changed for at least N days.',
          },
          limit: {
            type: 'integer',
            description: `At most ${OVERVIEW_LIMIT}. Default 15.`,
          },
        },
      },
    },
  ]
}

/** One line for the person: what the assistant wants to read or is reading. */
export function describeToolCall(
  reader: BoardReader,
  call: AgentToolCall,
): string {
  if (call.name === 'get_items') {
    const keys = keysOf(reader, call.args.keys)
    const list =
      keys.length > 4
        ? `${keys.slice(0, 4).join(', ')} and ${keys.length - 4} more`
        : keys.join(', ')
    return call.args.detail === true
      ? `Read ${list || 'items'} in detail: description, comments, history and links`
      : `Read ${list || 'items'}: status, owner, priority and dates`
  }
  if (call.name === 'search_items') {
    return `Search ${reader.label}: ${describeSearch(readSearch(call.args))}`
  }
  if (call.name === 'get_code') {
    const keys = keysOf(reader, call.args.keys)
    const list =
      keys.length > 4
        ? `${keys.slice(0, 4).join(', ')} and ${keys.length - 4} more`
        : keys.join(', ')
    return `Read the code trail of ${list || 'items'}: branch, pull requests and review timing`
  }
  return `Use ${call.name}`
}

export function describeSearch(query: BoardSearch): string {
  const parts = [
    query.state === 'open'
      ? 'open items'
      : query.state === 'done'
        ? 'finished items'
        : 'items',
  ]
  if (query.text) parts.push(`about “${query.text}”`)
  if (query.type) parts.push(`of type ${query.type}`)
  if (query.status) parts.push(`in ${query.status}`)
  if (query.parent) parts.push(`under ${query.parent}`)
  if (query.assignee)
    parts.push(
      /^unassigned$/i.test(query.assignee)
        ? 'with nobody assigned'
        : `assigned to “${query.assignee}”`,
    )
  if (query.updatedWithinDays)
    parts.push(`changed in the last ${query.updatedWithinDays} days`)
  if (query.notUpdatedForDays)
    parts.push(`unchanged for ${query.notUpdatedForDays}+ days`)
  return parts.join(' ')
}

function keysOf(reader: BoardReader, value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const keys = value.flatMap((raw) => {
    if (typeof raw !== 'string' && typeof raw !== 'number') return []
    const key = reader.normaliseKey(String(raw))
    return key ? [key] : []
  })
  return [...new Set(keys)]
}

export interface ToolRun {
  result: AgentToolResult
  checked: string[]
  unavailable: string[]
  detail: boolean
  /** Item titles by key, for hover text in the panel. */
  titles: Record<string, string>
}

/** Counts across one answer. */
export interface ToolUsage {
  detailed: number
  items: number
  searches: number
  code: number
}

export const newToolUsage = (): ToolUsage => ({
  detailed: 0,
  items: 0,
  searches: 0,
  code: 0,
})

/**
 * get_code: an item's code trail (branch, pull requests, review timing,
 * comment counts) from what the briefing already loaded from GitHub. It
 * reads no system: it looks keys up in data the browser sent, so it cannot
 * change anything anywhere.
 */
export function codeTool(keyExample: string): AgentTool {
  return {
    name: 'get_code',
    description: `Read the code trail of items from GitHub, read-only: the code state (no code, coding, in review, approved, merged), the branch's last commit, and each pull request's timeline (ready, first review, changes requested, approved, merged, last activity, comment count), its size in lines and files, and whether the checks on its latest commit pass, fail or still run. Use it for an item the report's pullRequests does not list, or to see one item's full trail. Up to ${CODE_PER_CALL} items. Keys look like ${keyExample}. No people and no comment text.`,
    parameters: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: `Item keys, like ${keyExample}.`,
        },
      },
      required: ['keys'],
    },
  }
}

/** Looks the keys up in the code trail the browser sent. */
export function runCodeTool(
  lookup: AiItemPullRequests[],
  call: AgentToolCall,
  usage: ToolUsage,
): AgentToolResult {
  const reply = (value: unknown) => ({
    id: call.id,
    name: call.name,
    content: bounded(value),
  })
  const asked = Array.isArray(call.args.keys)
    ? [
        ...new Set(
          call.args.keys
            .filter((key): key is string => typeof key === 'string')
            .map((key) => key.trim().toUpperCase())
            .filter(Boolean),
        ),
      ]
    : []
  if (!asked.length) return reply({ error: 'Give item keys.' })
  const room = Math.min(CODE_PER_CALL, TOOL_BUDGET.code - usage.code)
  if (room <= 0)
    return reply({
      error:
        'The code reading limit for this answer is used up. Answer with what you have.',
    })
  const keys = asked.slice(0, room)
  usage.code += keys.length
  const byKey = new Map(lookup.map((item) => [item.key.toUpperCase(), item]))
  const items = keys.flatMap((key) => {
    const found = byKey.get(key)
    return found ? [found] : []
  })
  const missing = keys.filter((key) => !byKey.has(key))
  return reply({
    items,
    ...(missing.length
      ? {
          no_code_found: missing,
          note: 'No branch or pull request names these keys in the last year, or the item is not on this board.',
        }
      : {}),
    ...(asked.length > keys.length
      ? { not_read: asked.slice(keys.length) }
      : {}),
  })
}

/**
 * Runs one tool call. Problems the model can act on (a wrong key, a status
 * that does not exist, a used-up budget) come back as the tool's answer, so
 * it can correct course; a cancelled request still throws.
 */
export async function runBoardTool(
  reader: BoardReader,
  call: AgentToolCall,
  usage: ToolUsage,
  signal?: AbortSignal,
): Promise<ToolRun> {
  const answer = (value: unknown, extra: Partial<ToolRun> = {}): ToolRun => ({
    result: { id: call.id, name: call.name, content: bounded(value) },
    checked: [],
    unavailable: [],
    detail: false,
    titles: {},
    ...extra,
  })
  const titlesOf = (items: AiJiraIssueEvidence[]) =>
    Object.fromEntries(
      items.flatMap((item) =>
        item.summary && item.summary !== item.key
          ? [[item.key, item.summary.slice(0, 200)]]
          : [],
      ),
    )
  try {
    if (call.name === 'get_items') {
      const detail = call.args.detail === true
      const all = keysOf(reader, call.args.keys)
      if (!all.length)
        return answer({
          error: `Give item keys like ${reader.keyExample}.`,
        })
      const room = Math.min(
        detail ? DETAIL_LIMIT : OVERVIEW_LIMIT,
        detail
          ? TOOL_BUDGET.detailed - usage.detailed
          : TOOL_BUDGET.items - usage.items,
      )
      if (room <= 0)
        return answer({
          error:
            'The reading limit for this answer is used up. Answer with what you have and say which items you could not check.',
        })
      const keys = all.slice(0, room)
      const { items, unavailable } = await reader.items(keys, detail, signal)
      if (detail) usage.detailed += keys.length
      usage.items += keys.length
      return answer(
        {
          items,
          ...(unavailable.length
            ? { not_found_or_not_visible: unavailable }
            : {}),
          ...(all.length > keys.length
            ? {
                not_read: all.slice(keys.length),
                note: `Read ${keys.length} of ${all.length}; ask for the rest in another call if they matter.`,
              }
            : {}),
        },
        {
          checked: items.map((item) => item.key),
          unavailable,
          detail,
          titles: titlesOf(items),
        },
      )
    }
    if (call.name === 'search_items') {
      if (usage.searches >= TOOL_BUDGET.searches)
        return answer({
          error:
            'The search limit for this answer is used up. Answer with what you have.',
        })
      usage.searches += 1
      const query = readSearch(call.args)
      const found = await reader.search(query, signal)
      usage.items += found.items.length
      return answer(
        {
          searched: describeSearch(query),
          ...(found.total !== null ? { total_matching: found.total } : {}),
          returned: found.items.length,
          ...(found.more ? { more_exist: true } : {}),
          items: found.items.map(overview),
        },
        {
          checked: found.items.map((item) => item.key),
          titles: titlesOf(found.items),
        },
      )
    }
    return answer({ error: `There is no tool called ${call.name}.` })
  } catch (caught) {
    if (signal?.aborted) throw caught
    const message =
      caught instanceof Error && caught.message
        ? caught.message
        : `${reader.label} could not answer.`
    return answer({ error: message.slice(0, 400) })
  }
}

/** Search results: the fields that tell items apart. */
function overview(item: AiJiraIssueEvidence) {
  return {
    key: item.key,
    title: item.summary,
    type: item.issueType,
    status: item.status,
    assignee: item.assignee ?? 'unassigned',
    ...(item.priority && item.priority !== 'Not supplied'
      ? { priority: item.priority }
      : {}),
    ...(item.updatedAt ? { updated: item.updatedAt } : {}),
    ...(item.dueDate ? { due: item.dueDate } : {}),
    ...(item.parent ? { parent: item.parent.key } : {}),
  }
}

/** JSON within the size limit: long texts shrink before anything is dropped. */
function bounded(value: unknown): string {
  let text = JSON.stringify(value)
  if (text.length <= RESULT_CHAR_LIMIT) return text
  const shrunk = JSON.parse(text, (key, field: unknown) => {
    if (typeof field !== 'string') return field
    if (key === 'description') return field.slice(0, 500)
    if (key === 'body') return field.slice(0, 300)
    return field
  }) as unknown
  text = JSON.stringify(shrunk)
  return text.length <= RESULT_CHAR_LIMIT
    ? text
    : `${text.slice(0, RESULT_CHAR_LIMIT)}… [cut: ask for fewer items]`
}
