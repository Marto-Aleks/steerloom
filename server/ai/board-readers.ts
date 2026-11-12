import type {
  AiJiraComment,
  AiJiraHistoryEvent,
  AiJiraIssueEvidence,
  AiJiraIssueLink,
  AiJiraRelatedIssue,
} from '../../src/lib/ai/jira-evidence'
import type { JiraClient } from '../jira/jira-client'
import type {
  TrelloAiBoard,
  TrelloAiCard,
  TrelloClient,
} from '../trello/client'
import type { AzureAiWorkItem, AzureDevOpsClient } from '../azure-devops/client'
import {
  azureSearchWiql,
  DETAIL_LIMIT,
  filterItems,
  isUnassigned,
  OVERVIEW_LIMIT,
  type BoardReader,
} from './board-reader'

/* One BoardReader per provider; see board-reader.ts for the contract. */

const text = (value: unknown, max: number): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : ''

const iso = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const time = Date.parse(value)
  // Azure DevOps marks "not revised yet" with the year 9999.
  return Number.isFinite(time) && time < Date.parse('9000-01-01')
    ? new Date(time).toISOString()
    : undefined
}

/** HTML (Azure DevOps descriptions and comments) as plain text. */
export function plainText(html: unknown, max: number): string {
  if (typeof html !== 'string') return ''
  return html
    .replace(/<(?:br|\/p|\/div|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, max)
}

// ---- Jira ----------------------------------------------------------------

export function jiraReader(
  client: JiraClient,
  projectKey: string,
): BoardReader {
  const pattern = new RegExp(`^${projectKey}-\\d{1,9}$`)
  return {
    label: 'Jira',
    keyExample: `${projectKey}-123`,
    normaliseKey(raw) {
      const key = raw.trim().toUpperCase()
      if (pattern.test(key)) return key
      // A bare number means an item in this project.
      return /^\d{1,9}$/.test(key) ? `${projectKey}-${key}` : null
    },
    items: (keys, detail, signal) =>
      client.aiItems(projectKey, keys, detail, signal),
    search: (query, signal) => client.aiSearch(projectKey, query, signal),
  }
}

// ---- Trello --------------------------------------------------------------

export function trelloReader(
  client: TrelloClient,
  boardId: string,
): BoardReader {
  let board: Promise<TrelloAiBoard> | undefined
  const load = (signal?: AbortSignal) => {
    if (!board) {
      const loading = client.aiBoard(boardId, signal)
      board = loading
      // A failed read is not kept, so the next call tries again.
      loading.catch(() => {
        if (board === loading) board = undefined
      })
    }
    return board
  }
  return {
    label: 'Trello',
    keyExample: 'CARD-12',
    normaliseKey(raw) {
      const number = /^(?:CARD-)?#?(\d{1,7})$/i.exec(raw.trim())?.[1]
      return number ? `CARD-${Number(number)}` : null
    },
    async items(keys, detail, signal) {
      const loaded = await load(signal)
      const wanted = keys.slice(0, detail ? DETAIL_LIMIT : OVERVIEW_LIMIT)
      const items: AiJiraIssueEvidence[] = []
      const unavailable: string[] = []
      for (const key of wanted) {
        const card = loaded.cards.find((item) => `CARD-${item.idShort}` === key)
        if (!card) {
          unavailable.push(key)
          continue
        }
        const base = trelloOverview(card, loaded)
        items.push(
          detail
            ? trelloDetail(base, await client.aiCard(card.id, signal), loaded)
            : base,
        )
      }
      return { items, unavailable }
    },
    async search(query, signal) {
      const loaded = await load(signal)
      const want = query.limit ?? 15
      const matching = filterItems(
        loaded.cards
          .map((card) => trelloOverview(card, loaded))
          .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
        query,
        { inMemory: true, done: (item) => item.statusCategory === 'Archived' },
      )
      return {
        items: matching.slice(0, want),
        total: matching.length,
        more: matching.length > want,
      }
    },
  }
}

function trelloOverview(
  card: TrelloAiBoard['cards'][number],
  board: TrelloAiBoard,
): AiJiraIssueEvidence {
  const list = board.lists.find((item) => item.id === card.idList)
  const names = (card.idMembers ?? []).flatMap((id) => {
    const member = board.members.find((item) => item.id === id)
    const name = member?.fullName || member?.username
    return name ? [name] : []
  })
  const labels = (card.labels ?? []).flatMap((label) =>
    label.name ? [text(label.name, 60)] : [],
  )
  return {
    key: `CARD-${card.idShort}`,
    summary: text(card.name, 300) || `CARD-${card.idShort}`,
    issueType: 'Card',
    status: text(list?.name, 120) || 'Unknown list',
    statusCategory: card.closed ? 'Archived' : 'Open',
    priority: 'Not supplied',
    assignee: names.length ? names.join(', ') : null,
    components: [],
    ...(labels.length ? { labels } : {}),
    ...(iso(card.dateLastActivity)
      ? { updatedAt: iso(card.dateLastActivity) }
      : {}),
    ...(iso(card.due) ? { dueDate: iso(card.due)!.slice(0, 10) } : {}),
  }
}

function trelloDetail(
  base: AiJiraIssueEvidence,
  card: TrelloAiCard,
  board: TrelloAiBoard,
): AiJiraIssueEvidence {
  const memberName = (id?: string) => {
    const member = board.members.find((item) => item.id === id)
    return member?.fullName || member?.username || 'someone'
  }
  const actions = [...(card.actions ?? [])].sort((a, b) =>
    (a.date ?? '').localeCompare(b.date ?? ''),
  )
  const comments: AiJiraComment[] = actions
    .filter((action) => action.type === 'commentCard' && action.data?.text)
    .slice(-8)
    .flatMap((action) => {
      const createdAt = iso(action.date)
      return createdAt
        ? [
            {
              author: text(action.memberCreator?.fullName, 120) || 'Unknown',
              createdAt,
              body: text(action.data?.text, 800),
            },
          ]
        : []
    })
  const history: AiJiraHistoryEvent[] = actions
    .flatMap((action): AiJiraHistoryEvent[] => {
      const changedAt = iso(action.date)
      if (!changedAt) return []
      const changedBy = text(action.memberCreator?.fullName, 120) || 'Unknown'
      if (action.type === 'updateCard' && action.data?.listAfter)
        return [
          {
            changedAt,
            changedBy,
            field: 'List',
            fromValue: text(action.data.listBefore?.name, 120) || null,
            toValue: text(action.data.listAfter.name, 120) || null,
          },
        ]
      if (
        action.type === 'updateCard' &&
        action.data?.old?.closed !== undefined
      )
        return [
          {
            changedAt,
            changedBy,
            field: 'Archived',
            fromValue: String(action.data.old.closed),
            toValue: String(!action.data.old.closed),
          },
        ]
      if (
        action.type === 'addMemberToCard' ||
        action.type === 'removeMemberFromCard'
      ) {
        const who =
          text(action.data?.member?.name, 120) ||
          memberName(action.data?.idMember)
        return [
          {
            changedAt,
            changedBy,
            field: 'Member',
            fromValue: action.type === 'removeMemberFromCard' ? who : null,
            toValue: action.type === 'addMemberToCard' ? who : null,
          },
        ]
      }
      return []
    })
    .slice(-25)
  const checklists = (card.checklists ?? [])
    .map((list) => {
      const items = list.checkItems ?? []
      const open = items
        .filter((item) => item.state !== 'complete')
        .map((item) => text(item.name, 80))
        .slice(0, 8)
      return `Checklist "${text(list.name, 80)}": ${items.length - open.length} of ${items.length} done${open.length ? `; open: ${open.join('; ')}` : ''}`
    })
    .join('\n')
  const description = [text(card.desc, 1800), checklists]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 2_400)
  return {
    ...base,
    ...(description ? { description } : {}),
    comments,
    history,
  }
}

// ---- Azure DevOps ----------------------------------------------------------

const AZURE_DONE = /^(?:done|closed|completed|resolved|removed)$/i
const AZURE_NEW = /^(?:new|proposed|to do|approved)$/i

const azureId = (key: string) => Number(/^#(\d{1,9})$/.exec(key)?.[1] ?? NaN)

const person = (value: unknown): string | null => {
  if (value && typeof value === 'object' && 'displayName' in value)
    return text((value as { displayName?: unknown }).displayName, 120) || null
  return typeof value === 'string'
    ? text(value.replace(/<.*>/, ''), 120) || null
    : null
}

function azureOverview(item: AzureAiWorkItem): AiJiraIssueEvidence {
  const f = item.fields ?? {}
  const state = text(f['System.State'], 120) || 'Unknown'
  const tags = text(f['System.Tags'], 400)
    .split(';')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 15)
  const priority = f['Microsoft.VSTS.Common.Priority']
  const parent = f['System.Parent']
  return {
    key: `#${item.id}`,
    summary: text(f['System.Title'], 500) || `#${item.id}`,
    issueType: text(f['System.WorkItemType'], 120) || 'Work item',
    status: state,
    statusCategory: AZURE_DONE.test(state)
      ? 'Done'
      : AZURE_NEW.test(state)
        ? 'To Do'
        : 'In Progress',
    priority:
      typeof priority === 'number' || typeof priority === 'string'
        ? String(priority)
        : 'Unspecified',
    assignee: person(f['System.AssignedTo']),
    components: text(f['System.AreaPath'], 200)
      ? [text(f['System.AreaPath'], 200)]
      : [],
    ...(tags.length ? { labels: tags } : {}),
    ...(text(f['System.IterationPath'], 200)
      ? { fixVersions: [text(f['System.IterationPath'], 200)] }
      : {}),
    ...(iso(f['System.CreatedDate'])
      ? { createdAt: iso(f['System.CreatedDate']) }
      : {}),
    ...(iso(f['System.ChangedDate'])
      ? { updatedAt: iso(f['System.ChangedDate']) }
      : {}),
    ...(iso(f['Microsoft.VSTS.Scheduling.TargetDate'])
      ? {
          dueDate: iso(f['Microsoft.VSTS.Scheduling.TargetDate'])!.slice(0, 10),
        }
      : {}),
    ...(typeof parent === 'number'
      ? {
          parent: {
            key: `#${parent}`,
            summary: `#${parent}`,
            status: 'Unknown',
            issueType: 'Work item',
          },
        }
      : {}),
  }
}

/** How Azure DevOps names a link, as the link reads from this item. */
function azureRelationship(rel: string, name?: string): string {
  if (rel === 'System.LinkTypes.Dependency-Reverse') return 'depends on'
  if (rel === 'System.LinkTypes.Dependency-Forward') return 'is needed by'
  if (rel === 'System.LinkTypes.Duplicate-Forward') return 'is duplicated by'
  if (rel === 'System.LinkTypes.Duplicate-Reverse') return 'duplicates'
  if (rel === 'System.LinkTypes.Related') return 'relates to'
  return text(name, 80).toLowerCase() || 'is linked to'
}

const HISTORY_FIELDS: Record<string, string> = {
  'System.State': 'Status',
  'System.AssignedTo': 'Assignee',
  'System.BoardColumn': 'Board column',
  'System.IterationPath': 'Iteration',
  'Microsoft.VSTS.Common.Priority': 'Priority',
}

export function azureReader(client: AzureDevOpsClient): BoardReader {
  return {
    label: 'Azure DevOps',
    keyExample: '#1234',
    normaliseKey(raw) {
      const number = /^#?(\d{1,9})$/.exec(raw.trim())?.[1]
      return number ? `#${Number(number)}` : null
    },
    async items(keys, detail, signal) {
      const ids = keys
        .slice(0, detail ? DETAIL_LIMIT : OVERVIEW_LIMIT)
        .map(azureId)
        .filter(Number.isInteger)
      const found = await client.aiWorkItems(ids, detail, signal)
      let items = found.map(azureOverview)
      if (detail) items = await azureDetails(client, found, items, signal)
      const seen = new Set(items.map((item) => item.key))
      return {
        items: keys
          .map((key) => items.find((item) => item.key === key))
          .filter((item): item is AiJiraIssueEvidence => !!item),
        unavailable: keys.filter((key) => !seen.has(key)),
      }
    },
    async search(query, signal) {
      const want = query.limit ?? 15
      const byName = !!query.assignee && !isUnassigned(query.assignee)
      const top = byName ? 100 : want + 1
      const ids = await client.aiQuery(azureSearchWiql(query), top, signal)
      const found = (await client.aiWorkItems(ids, false, signal)).map(
        azureOverview,
      )
      const ordered = ids
        .map((id) => found.find((item) => item.key === `#${id}`))
        .filter((item): item is AiJiraIssueEvidence => !!item)
      const matching = filterItems(ordered, query)
      return {
        items: matching.slice(0, want),
        total: null,
        more: matching.length > want || ids.length >= top,
      }
    },
  }
}

async function azureDetails(
  client: AzureDevOpsClient,
  raw: AzureAiWorkItem[],
  items: AiJiraIssueEvidence[],
  signal?: AbortSignal,
): Promise<AiJiraIssueEvidence[]> {
  // Titles and states of linked items, in one request.
  const relatedIds = new Set<number>()
  raw.forEach((item) =>
    (item.relations ?? []).forEach((relation) => {
      const id = Number(/workItems\/(\d+)$/i.exec(relation.url ?? '')?.[1])
      if (Number.isInteger(id)) relatedIds.add(id)
    }),
  )
  const related = new Map<number, AiJiraRelatedIssue>(
    (await client.aiWorkItems([...relatedIds].slice(0, 60), false, signal)).map(
      (item) => {
        const overview = azureOverview(item)
        return [
          item.id,
          {
            key: overview.key,
            summary: overview.summary,
            status: overview.status,
            issueType: overview.issueType,
          },
        ]
      },
    ),
  )
  return Promise.all(
    raw.map(async (item, index) => {
      const base = items[index]!
      const f = item.fields ?? {}
      const [comments, updates] = await Promise.all([
        client.aiComments(item.id, signal),
        client.aiUpdates(item.id, signal),
      ])
      const links: AiJiraIssueLink[] = []
      const subtasks: AiJiraRelatedIssue[] = []
      let parent = base.parent
      ;(item.relations ?? []).forEach((relation) => {
        const id = Number(/workItems\/(\d+)$/i.exec(relation.url ?? '')?.[1])
        const target = related.get(id)
        if (!target) return
        if (relation.rel === 'System.LinkTypes.Hierarchy-Forward')
          subtasks.push(target)
        else if (relation.rel === 'System.LinkTypes.Hierarchy-Reverse')
          parent = target
        else
          links.push({
            direction: 'outward',
            relationship: azureRelationship(
              relation.rel ?? '',
              relation.attributes?.name,
            ),
            ...target,
          })
      })
      const description = [
        plainText(f['System.Description'], 1_600),
        plainText(f['Microsoft.VSTS.Common.AcceptanceCriteria'], 600),
        plainText(f['Microsoft.VSTS.TCM.ReproSteps'], 600),
      ]
        .filter(Boolean)
        .join('\n\n')
      const history: AiJiraHistoryEvent[] = updates
        .flatMap((update) => {
          const changedAt =
            iso(update.fields?.['System.ChangedDate']?.newValue) ??
            iso(update.revisedDate)
          if (!changedAt) return []
          return Object.entries(update.fields ?? {}).flatMap(
            ([field, change]) => {
              const label = HISTORY_FIELDS[field]
              if (!label) return []
              const value = (input: unknown) =>
                person(input) ??
                (typeof input === 'number' ? String(input) : null)
              return [
                {
                  changedAt,
                  changedBy: person(update.revisedBy) ?? 'Unknown',
                  field: label,
                  fromValue: value(change.oldValue),
                  toValue: value(change.newValue),
                },
              ]
            },
          )
        })
        .slice(-25)
      return {
        ...base,
        ...(description ? { description } : {}),
        ...(parent ? { parent } : {}),
        subtasks: subtasks.slice(0, 15),
        links: links.slice(0, 15),
        comments: comments
          .flatMap((comment) => {
            const createdAt = iso(comment.createdDate)
            const body = plainText(comment.text, 800)
            return createdAt && body
              ? [
                  {
                    author: person(comment.createdBy) ?? 'Unknown',
                    createdAt,
                    body,
                  },
                ]
              : []
          })
          .reverse(),
        history,
      }
    }),
  )
}
