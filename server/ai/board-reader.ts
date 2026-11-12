import type { AiJiraIssueEvidence } from '../../src/lib/ai/jira-evidence'

/*
 * The assistant's read-only window into the board: the same two questions
 * asked of Jira, Trello and Azure DevOps. "Which items match?" (search) and
 * "Tell me everything about these items" (items). Each provider answers in
 * the shared evidence shape, so the model reads one format.
 *
 * Nothing here can change the board. Searches are built from structured
 * filters, never free text the model writes, and stay inside the board's
 * project.
 */

export const DETAIL_LIMIT = 5
export const OVERVIEW_LIMIT = 25

export interface BoardSearch {
  /** Words in the item's title (Jira: anywhere in its text). */
  text?: string
  /** Exact status or list name. */
  status?: string
  /** Part of the assignee's name, or "unassigned". */
  assignee?: string
  /** Item type (Jira, Azure DevOps) or label (Trello). */
  type?: string
  /** Children of this item (epic, feature, parent). */
  parent?: string
  /** open: not finished; done: finished; any (default). */
  state?: 'open' | 'done' | 'any'
  updatedWithinDays?: number
  notUpdatedForDays?: number
  limit?: number
}

export interface BoardItemsResult {
  items: AiJiraIssueEvidence[]
  unavailable: string[]
}

export interface BoardSearchResult {
  items: AiJiraIssueEvidence[]
  /** How many match in all, when the provider says. */
  total: number | null
  /** More match than were returned. */
  more: boolean
}

export interface BoardReader {
  /** "Jira", "Trello" or "Azure DevOps", for the person and the model. */
  label: string
  /** What an item key looks like here, for the tool description. */
  keyExample: string
  /** A key the model gave, in this board's form, or null when it is not one. */
  normaliseKey(raw: string): string | null
  items(
    keys: string[],
    detail: boolean,
    signal?: AbortSignal,
  ): Promise<BoardItemsResult>
  search(query: BoardSearch, signal?: AbortSignal): Promise<BoardSearchResult>
}

/** Days between 1 and 3650, or undefined. */
export function days(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return undefined
  const whole = Math.round(number)
  return whole >= 1 && whole <= 3650 ? whole : undefined
}

/** Short plain text, or undefined. Filters are never longer than this. */
export function filterText(value: unknown, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f]/g, ' ').trim()
  return clean ? clean.slice(0, max) : undefined
}

/** Reads the model's search arguments into a safe BoardSearch. */
export function readSearch(args: Record<string, unknown>): BoardSearch {
  const state =
    args.state === 'open' || args.state === 'done' ? args.state : 'any'
  const limit =
    typeof args.limit === 'number' && Number.isFinite(args.limit)
      ? Math.min(OVERVIEW_LIMIT, Math.max(1, Math.round(args.limit)))
      : 15
  const query: BoardSearch = { state, limit }
  const text = filterText(args.text, 80)
  const status = filterText(args.status, 80)
  const assignee = filterText(args.assignee, 80)
  const type = filterText(args.type, 60)
  const parent = filterText(args.parent, 40)
  const within = days(args.updated_within_days)
  const quiet = days(args.not_updated_for_days)
  if (text) query.text = text
  if (status) query.status = status
  if (assignee) query.assignee = assignee
  if (type) query.type = type
  if (parent) query.parent = parent
  if (within) query.updatedWithinDays = within
  if (quiet) query.notUpdatedForDays = quiet
  return query
}

export const isUnassigned = (assignee: string | undefined) =>
  !!assignee && /^(?:unassigned|nobody|none|no one|empty)$/i.test(assignee)

/** Case-insensitive "name contains" match for assignees. */
export function assigneeMatches(
  item: Pick<AiJiraIssueEvidence, 'assignee'>,
  wanted: string,
): boolean {
  if (isUnassigned(wanted)) return !item.assignee
  return (item.assignee ?? '').toLowerCase().includes(wanted.toLowerCase())
}

const jqlString = (value: string) =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * JQL for a search, inside one project. Text is reduced to words so JQL's
 * reserved characters cannot break or widen the query. Assignee names are
 * matched afterwards (Jira wants account ids or user names, not names).
 */
export function jiraSearchJql(
  projectKey: string,
  query: BoardSearch,
  cloud: boolean,
): string {
  const clauses = [`project = ${jqlString(projectKey)}`]
  const words = (query.text ?? '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (words) clauses.push(`text ~ ${jqlString(words)}`)
  if (query.status) clauses.push(`status = ${jqlString(query.status)}`)
  if (query.type) clauses.push(`issuetype = ${jqlString(query.type)}`)
  if (isUnassigned(query.assignee)) clauses.push('assignee is EMPTY')
  if (query.parent) {
    const parent = query.parent.toUpperCase()
    if (/^[A-Z][A-Z0-9_]{1,29}-\d+$/.test(parent))
      clauses.push(
        cloud
          ? `parent = ${parent}`
          : `(parent = ${parent} OR "Epic Link" = ${parent})`,
      )
  }
  if (query.state === 'open') clauses.push('statusCategory != Done')
  if (query.state === 'done') clauses.push('statusCategory = Done')
  if (query.updatedWithinDays)
    clauses.push(`updated >= -${query.updatedWithinDays}d`)
  if (query.notUpdatedForDays)
    clauses.push(`updated <= -${query.notUpdatedForDays}d`)
  return `${clauses.join(' AND ')} ORDER BY updated DESC`
}

const wiqlString = (value: string) => `'${value.replace(/'/g, "''")}'`

/** States Azure DevOps processes use for finished work. */
const AZURE_DONE_STATES = ['Done', 'Closed', 'Completed', 'Resolved', 'Removed']

/** WIQL for a search, inside the project. Assignee names are matched afterwards. */
export function azureSearchWiql(query: BoardSearch): string {
  const clauses = ['[System.TeamProject] = @project']
  if (query.text)
    clauses.push(`[System.Title] CONTAINS ${wiqlString(query.text)}`)
  if (query.status) clauses.push(`[System.State] = ${wiqlString(query.status)}`)
  if (query.type)
    clauses.push(`[System.WorkItemType] = ${wiqlString(query.type)}`)
  if (isUnassigned(query.assignee)) clauses.push(`[System.AssignedTo] = ''`)
  const parent = /^#?(\d{1,9})$/.exec(query.parent ?? '')?.[1]
  if (parent) clauses.push(`[System.Parent] = ${parent}`)
  const done = AZURE_DONE_STATES.map(wiqlString).join(', ')
  if (query.state === 'open') clauses.push(`[System.State] NOT IN (${done})`)
  if (query.state === 'done') clauses.push(`[System.State] IN (${done})`)
  if (query.updatedWithinDays)
    clauses.push(`[System.ChangedDate] >= @today - ${query.updatedWithinDays}`)
  if (query.notUpdatedForDays)
    clauses.push(`[System.ChangedDate] < @today - ${query.notUpdatedForDays}`)
  return `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(' AND ')} ORDER BY [System.ChangedDate] DESC`
}

/**
 * Applies the filters a provider cannot express in its own query: assignee
 * names everywhere, and everything on Trello, which has no query language.
 */
export function filterItems(
  items: AiJiraIssueEvidence[],
  query: BoardSearch,
  options: {
    inMemory?: boolean
    now?: number
    done?: (item: AiJiraIssueEvidence) => boolean
  } = {},
): AiJiraIssueEvidence[] {
  const now = options.now ?? Date.now()
  const age = (item: AiJiraIssueEvidence) =>
    item.updatedAt ? (now - Date.parse(item.updatedAt)) / 86_400_000 : null
  return items.filter((item) => {
    if (query.assignee && !assigneeMatches(item, query.assignee)) return false
    if (!options.inMemory) return true
    const text = query.text?.toLowerCase()
    if (
      text &&
      !`${item.summary} ${item.description ?? ''}`.toLowerCase().includes(text)
    )
      return false
    if (
      query.status &&
      item.status.toLowerCase() !== query.status.toLowerCase()
    )
      return false
    if (
      query.type &&
      !(item.labels ?? []).some(
        (label) => label.toLowerCase() === query.type!.toLowerCase(),
      ) &&
      item.issueType.toLowerCase() !== query.type.toLowerCase()
    )
      return false
    const done = options.done?.(item) ?? false
    if (query.state === 'open' && done) return false
    if (query.state === 'done' && !done) return false
    const updated = age(item)
    if (
      query.updatedWithinDays &&
      (updated === null || updated > query.updatedWithinDays)
    )
      return false
    if (
      query.notUpdatedForDays &&
      (updated === null || updated < query.notUpdatedForDays)
    )
      return false
    return true
  })
}
