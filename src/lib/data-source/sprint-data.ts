import type { SprintData, SprintItemRecord, SprintRecord } from '../../types'

/*
 * The sprint part of a Jira board payload, checked field by field: anything
 * malformed is dropped, so a bad payload costs the Sprint tab, never the
 * briefing.
 */

const text = (value: unknown, max = 300) =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : undefined
const time = (value: unknown) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : undefined
const ids = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string')
    : []
const points = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null

function sprint(value: unknown): SprintRecord | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const id = text(raw.id, 40)
  const name = text(raw.name, 80)
  const state = raw.state
  if (!id || !name) return undefined
  if (state !== 'active' && state !== 'closed' && state !== 'future')
    return undefined
  return {
    id,
    name,
    state,
    ...(time(raw.startAt) ? { startAt: time(raw.startAt) } : {}),
    ...(time(raw.endAt) ? { endAt: time(raw.endAt) } : {}),
    ...(time(raw.completedAt) ? { completedAt: time(raw.completedAt) } : {}),
    ...(text(raw.goal) ? { goal: text(raw.goal) } : {}),
  }
}

function item(value: unknown): SprintItemRecord | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const issueId = text(raw.issueId, 40)
  if (!issueId) return undefined
  const now = points(raw.points)
  const changes = (list: unknown) =>
    Array.isArray(list)
      ? list.filter(
          (change): change is Record<string, unknown> =>
            !!change &&
            typeof change === 'object' &&
            !!time((change as { at?: unknown }).at),
        )
      : []
  return {
    issueId,
    sprintIds: ids(raw.sprintIds),
    ...(now !== null ? { points: now } : {}),
    sprintChanges: changes(raw.sprintChanges).map((change) => ({
      at: change.at as string,
      from: ids(change.from),
      to: ids(change.to),
    })),
    pointChanges: changes(raw.pointChanges).map((change) => ({
      at: change.at as string,
      from: points(change.from),
      to: points(change.to),
    })),
  }
}

export function readSprintData(value: unknown): SprintData | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const estimate = raw.estimate as { kind?: unknown; field?: unknown }
  const field = text(estimate?.field, 80)
  return {
    estimate:
      estimate?.kind === 'points' && field
        ? { kind: 'points', field }
        : { kind: 'items' },
    sprints: Array.isArray(raw.sprints)
      ? raw.sprints.flatMap((entry) => sprint(entry) ?? [])
      : [],
    items: Array.isArray(raw.items)
      ? raw.items.flatMap((entry) => item(entry) ?? [])
      : [],
    ...(raw.unavailable === 'permission'
      ? { unavailable: 'permission' as const }
      : {}),
  }
}
