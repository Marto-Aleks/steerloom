import type {
  SprintData,
  SprintItemRecord,
  SprintRecord,
} from '../../src/types'

/*
 * Scrum boards: the board's sprints, and each item's sprints and estimate,
 * now and every change to them, read from fields and history the board load
 * fetches anyway. Read-only, and nothing about people.
 */

/** How many closed sprints a briefing compares; the next planned ones too. */
const CLOSED_KEPT = 6
const FUTURE_KEPT = 2

export interface JiraSprintResponse {
  id?: number | string
  name?: string
  state?: string
  startDate?: string
  endDate?: string
  completeDate?: string
  activatedDate?: string
  goal?: string
}

export interface JiraFieldResponse {
  id?: string
  name?: string
  schema?: { type?: string; custom?: string }
}

export interface JiraEstimation {
  type?: string
  field?: { fieldId?: string; displayName?: string }
}

interface ChangeItem {
  field?: string
  fieldId?: string
  from?: string | null
  fromString?: string | null
  to?: string | null
  /** Jira's field; every object also inherits a toString function. */
  toString?: unknown
}

export interface SprintIssue {
  id?: string
  fields?: object
  changelog?: {
    histories?: Array<{ created?: string | number; items?: ChangeItem[] }>
  }
}

export interface PointsField {
  id: string
  name: string
}

const SPRINT_SCHEMA = 'com.pyxis.greenhopper.jira:gh-sprint'
const TIME_FIELDS = new Set([
  'timeoriginalestimate',
  'timeestimate',
  'aggregatetimeoriginalestimate',
  'timetracking',
])
const POINT_NAMES = ['story points', 'story point estimate']

/** The Sprint field's id on this site (customfield_10020 on most). */
export function sprintFieldId(fields: JiraFieldResponse[]): string | undefined {
  return (
    fields.find((field) => field.schema?.custom === SPRINT_SCHEMA)?.id ??
    fields.find((field) => field.name?.trim().toLowerCase() === 'sprint')?.id
  )
}

/**
 * The board's estimate field when it estimates in story points. Boards that
 * count items or estimate in hours get none; their sprints count items.
 */
export function pointsField(
  estimation: JiraEstimation | undefined,
  fields: JiraFieldResponse[],
): PointsField | undefined {
  if (estimation?.type === 'field') {
    const id = estimation.field?.fieldId
    if (!id || TIME_FIELDS.has(id.toLowerCase())) return undefined
    const name =
      estimation.field?.displayName ??
      fields.find((field) => field.id === id)?.name ??
      'Story Points'
    return { id, name }
  }
  if (estimation?.type) return undefined
  // Team-managed boards may not report their estimate: use the points field.
  const found = fields.find(
    (field) =>
      field.id &&
      field.schema?.type === 'number' &&
      POINT_NAMES.includes(field.name?.trim().toLowerCase() ?? ''),
  )
  return found?.id
    ? { id: found.id, name: found.name ?? 'Story Points' }
    : undefined
}

/** The running sprint, the last closed ones and the next planned ones. */
export function keptSprints(values: JiraSprintResponse[]): SprintRecord[] {
  const all = values.flatMap((value): SprintRecord[] => {
    const state = value.state?.toLowerCase()
    if (value.id === undefined || !value.name) return []
    if (state !== 'active' && state !== 'closed' && state !== 'future')
      return []
    return [
      {
        id: String(value.id),
        name: value.name.trim().slice(0, 80),
        state,
        ...(isoOrUndefined(value.startDate)
          ? { startAt: isoOrUndefined(value.startDate) }
          : {}),
        ...(isoOrUndefined(value.endDate)
          ? { endAt: isoOrUndefined(value.endDate) }
          : {}),
        ...(isoOrUndefined(value.completeDate)
          ? { completedAt: isoOrUndefined(value.completeDate) }
          : {}),
        ...(isoOrUndefined(value.activatedDate)
          ? { activatedAt: isoOrUndefined(value.activatedDate) }
          : {}),
        ...(value.goal?.trim()
          ? { goal: value.goal.trim().slice(0, 300) }
          : {}),
      },
    ]
  })
  const closed = all
    .filter((sprint) => sprint.state === 'closed')
    .sort((a, b) =>
      (b.completedAt ?? b.endAt ?? '').localeCompare(
        a.completedAt ?? a.endAt ?? '',
      ),
    )
    .slice(0, CLOSED_KEPT)
  // Jira lists sprints in board order, so the first future ones come next.
  const future = all
    .filter((sprint) => sprint.state === 'future')
    .slice(0, FUTURE_KEPT)
  return [
    ...closed.reverse(),
    ...all.filter((sprint) => sprint.state === 'active'),
    ...future,
  ]
}

/**
 * Sprint ids from the Sprint field: objects on Cloud and newer Data Center,
 * "com.atlassian.greenhopper.service.sprint.Sprint@…[id=12,…]" text on older
 * Data Center.
 */
export function sprintIdsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): string[] => {
    if (typeof entry === 'number') return [String(entry)]
    if (typeof entry === 'string') {
      const id = /\bid=(\d+)/.exec(entry)?.[1]
      return id ? [id] : []
    }
    if (entry && typeof entry === 'object' && 'id' in entry) {
      const id = (entry as { id?: unknown }).id
      return typeof id === 'number' || typeof id === 'string'
        ? [String(id)]
        : []
    }
    return []
  })
}

/** "12, 13" in a Sprint change to ["12", "13"]. */
function idList(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part))
}

function pointsOf(value: unknown): number | undefined {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

/** Each item's sprints and estimate, with every change, from fields and history. */
export function sprintItems(
  issues: SprintIssue[],
  sprintField: string,
  points: PointsField | undefined,
): SprintItemRecord[] {
  const isSprint = (item: ChangeItem) =>
    item.fieldId === sprintField ||
    item.field?.trim().toLowerCase() === 'sprint'
  const isPoints = (item: ChangeItem) =>
    points !== undefined &&
    (item.fieldId === points.id ||
      item.field?.trim().toLowerCase() === points.name.trim().toLowerCase())
  return issues.flatMap((issue): SprintItemRecord[] => {
    if (!issue.id) return []
    const fields = (issue.fields ?? {}) as Record<string, unknown>
    const sprintIds = sprintIdsOf(fields[sprintField])
    const sprintChanges: SprintItemRecord['sprintChanges'] = []
    const pointChanges: SprintItemRecord['pointChanges'] = []
    for (const history of issue.changelog?.histories ?? []) {
      const at = isoOrUndefined(history.created)
      if (!at) continue
      for (const item of history.items ?? []) {
        if (isSprint(item))
          sprintChanges.push({
            at,
            from: idList(item.from),
            to: idList(item.to),
          })
        else if (isPoints(item))
          pointChanges.push({
            at,
            from: pointsOf(item.fromString ?? item.from) ?? null,
            to:
              pointsOf(
                typeof item.toString === 'string' ? item.toString : item.to,
              ) ?? null,
          })
      }
    }
    if (!sprintIds.length && !sprintChanges.length) return []
    const now = points ? pointsOf(fields[points.id]) : undefined
    const byTime = (a: { at: string }, b: { at: string }) =>
      a.at.localeCompare(b.at)
    return [
      {
        issueId: issue.id,
        sprintIds,
        ...(now !== undefined ? { points: now } : {}),
        sprintChanges: sprintChanges.sort(byTime),
        pointChanges: pointChanges.sort(byTime),
      },
    ]
  })
}

export function sprintData(
  sprints: SprintRecord[],
  items: SprintItemRecord[],
  points: PointsField | undefined,
): SprintData {
  return {
    estimate: points
      ? { kind: 'points', field: points.name }
      : { kind: 'items' },
    sprints,
    items,
  }
}

/** Jira text dates, or the epoch seconds or milliseconds of Cloud's bulk history. */
function isoOrUndefined(value: unknown): string | undefined {
  const epoch = (number: number) =>
    number > 0 ? (number < 1e11 ? number * 1000 : number) : NaN
  const time =
    typeof value === 'number'
      ? epoch(value)
      : typeof value === 'string' && /^\d{9,}$/.test(value.trim())
        ? epoch(Number(value.trim()))
        : typeof value === 'string' && value.trim()
          ? Date.parse(value)
          : NaN
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined
}
