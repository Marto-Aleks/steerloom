import type { AiJiraIssueEvidence } from '../../../src/lib/ai/jira-evidence'
import type { FlowBoardSnapshot } from '../../../src/types'
import { DEMO_ITEM_NOTES } from '../../../src/lib/workspace/demo'
import type { BoardReader } from '../board-reader'

/*
 * The open demo's board as a read-only reader, for recording the demo's
 * answers: each item's title, type, owner, status, status history, and the
 * comments and blocker a real tracker would hold (DEMO_ITEM_NOTES), read
 * from the same fictional snapshot the dashboard shows. Times are given as
 * days ago: the demo board moves with today, so a date in a recorded answer
 * would go stale.
 */
export function demoBoardReader(
  snapshot: FlowBoardSnapshot,
  /** Comments and blockers by key; the Kanban demo's by default. */
  notesByKey: typeof DEMO_ITEM_NOTES = DEMO_ITEM_NOTES,
): BoardReader {
  const now = Date.parse(snapshot.loadedAt)
  const ago = (iso: string) => {
    const days = Math.round((now - Date.parse(iso)) / 86_400_000)
    return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
  }
  const columnOf = new Map(
    snapshot.board.columns.flatMap((column) =>
      column.statusIds.map((status) => [status, column.name] as const),
    ),
  )
  const last = snapshot.board.columns.at(-1)?.name
  const first = snapshot.board.columns[0]?.name
  const items = snapshot.issues.map((issue): AiJiraIssueEvidence => {
    const moves = snapshot.transitions
      .filter((transition) => transition.issueId === issue.id)
      .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt))
    const status = columnOf.get(moves.at(-1)?.statusId ?? '') ?? 'Backlog'
    const notes = notesByKey[issue.key]
    return {
      key: issue.key,
      summary: issue.title ?? issue.key,
      issueType: issue.issueTypeName,
      status,
      statusCategory:
        status === last ? 'Done' : status === first ? 'To Do' : 'In Progress',
      priority: 'Medium',
      assignee: issue.assignee ?? null,
      components: [],
      createdAt: ago(issue.createdAt),
      ...(moves.length ? { updatedAt: ago(moves.at(-1)!.enteredAt) } : {}),
      ...(notes?.comments
        ? {
            comments: notes.comments.map((comment) => ({
              author: comment.author,
              createdAt: ago(
                new Date(now - comment.daysAgo * 86_400_000).toISOString(),
              ),
              body: comment.body,
            })),
          }
        : {}),
      ...(notes?.blockedBy
        ? {
            links: [
              {
                direction: 'inward' as const,
                relationship: 'is blocked by',
                key: notes.blockedBy.key,
                summary: notes.blockedBy.summary,
                issueType: 'Story',
                status: notes.blockedBy.status,
              },
            ],
          }
        : {}),
      history: moves.map((move, index) => ({
        changedAt: ago(move.enteredAt),
        changedBy: 'Board',
        field: 'status',
        fromValue: index
          ? (columnOf.get(moves[index - 1]!.statusId) ?? null)
          : null,
        toValue: columnOf.get(move.statusId) ?? null,
      })),
    }
  })
  const byKey = new Map(items.map((item) => [item.key, item]))
  const overview = (item: AiJiraIssueEvidence): AiJiraIssueEvidence => {
    const kept = { ...item }
    delete kept.history
    delete kept.comments
    delete kept.links
    return kept
  }
  return {
    label: 'Jira',
    keyExample: items[0]?.key ?? 'DEMO-36',
    // Keys of this board only, whatever its project.
    normaliseKey: (raw) => {
      const key = raw.trim().toUpperCase()
      return /^[A-Z][A-Z0-9_]*-\d+$/.test(key) ? key : null
    },
    items: (keys, detail) =>
      Promise.resolve({
        items: keys.flatMap((key) => {
          const item = byKey.get(key)
          return item ? [detail ? item : overview(item)] : []
        }),
        unavailable: keys.filter((key) => !byKey.has(key)),
      }),
    search: (query) => {
      const text = query.text?.toLowerCase()
      const matches = items.filter(
        (item) =>
          (query.state !== 'done' || item.statusCategory === 'Done') &&
          (query.state !== 'open' || item.statusCategory !== 'Done') &&
          (!query.status ||
            item.status.toLowerCase() === query.status.toLowerCase()) &&
          (!query.type ||
            item.issueType.toLowerCase() === query.type.toLowerCase()) &&
          (!query.assignee ||
            (query.assignee.toLowerCase() === 'unassigned'
              ? !item.assignee
              : (item.assignee ?? '')
                  .toLowerCase()
                  .includes(query.assignee.toLowerCase()))) &&
          (!text || item.summary.toLowerCase().includes(text)),
      )
      const limit = query.limit ?? 25
      return Promise.resolve({
        items: matches.slice(0, limit).map(overview),
        total: matches.length,
        more: matches.length > limit,
      })
    },
  }
}
