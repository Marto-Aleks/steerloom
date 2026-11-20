import type {
  AiSprintContext,
  AiSprintItemState,
} from '../../src/lib/ai/report-context'

/*
 * The Sprint tab's facts in an AI request, checked field by field like the
 * rest of the report context: keys and numbers, bounded; anything malformed
 * fails the whole request instead of reaching the prompt.
 */

const ITEM_LIMIT = 80
const SPRINT_LIMIT = 6
const KEY = /^[A-Z][A-Z0-9_]{0,29}-\d{1,9}$/
const STATES = new Set<AiSprintItemState>([
  'done',
  'on track',
  'in progress',
  'at risk',
  'not started',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() && value.trim().length <= max
    ? value.trim()
    : null
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
const keys = (value: unknown) =>
  Array.isArray(value) &&
  value.length <= ITEM_LIMIT &&
  value.every((key) => typeof key === 'string' && KEY.test(key))
    ? (value as string[])
    : null
const optional = <T>(value: unknown, parse: (value: unknown) => T | null) =>
  value === undefined ? undefined : parse(value)

/** undefined: no sprint; null: present but invalid. */
export function parseSprintContext(
  value: unknown,
): AiSprintContext | null | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return null
  if (value.unit !== 'points' && value.unit !== 'items') return null
  const running = optional(value.running, parseRunning)
  const planning = optional(value.planning, parsePlanning)
  const pointsPredictTime = optional(value.pointsPredictTime, parsePoints)
  const lastSprints =
    Array.isArray(value.lastSprints) && value.lastSprints.length <= SPRINT_LIMIT
      ? value.lastSprints.map(parseClosed)
      : null
  if (
    running === null ||
    planning === null ||
    pointsPredictTime === null ||
    !lastSprints ||
    lastSprints.some((sprint) => sprint === null)
  )
    return null
  return {
    unit: value.unit,
    ...(running ? { running } : {}),
    ...(planning ? { planning } : {}),
    ...(pointsPredictTime ? { pointsPredictTime } : {}),
    lastSprints: lastSprints as AiSprintContext['lastSprints'],
  }
}

function parseRunning(
  value: unknown,
): NonNullable<AiSprintContext['running']> | null {
  if (!isRecord(value)) return null
  const name = text(value.name, 80)
  const goal = optional(value.goal, (goal) => text(goal, 300))
  const day = count(value.day)
  const days = count(value.days)
  const daysLeft = count(value.daysLeft)
  const finishedLast90Days = count(value.finishedLast90Days)
  const forecast = optional(value.forecast, (forecast) => {
    if (!isRecord(forecast)) return null
    const likelyDone = count(forecast.likelyDone)
    const atLeast85 = count(forecast.atLeast85)
    const sampleItems = count(forecast.sampleItems)
    return likelyDone === null || atLeast85 === null || sampleItems === null
      ? null
      : { likelyDone, atLeast85, sampleItems }
  })
  const points = optional(value.points, (points) => {
    if (!isRecord(points)) return null
    const likely = count(points.likely)
    const total = count(points.total)
    const atRisk = count(points.atRisk)
    const unestimated = count(points.unestimated)
    return likely === null ||
      total === null ||
      atRisk === null ||
      unestimated === null
      ? null
      : { likely, total, atRisk, unestimated }
  })
  const items =
    Array.isArray(value.items) && value.items.length <= ITEM_LIMIT
      ? value.items.map(parseItem)
      : null
  const scope = isRecord(value.scopeChange) ? value.scopeChange : null
  const plannedItems = count(scope?.plannedItems)
  const added = keys(scope?.added)
  const removed = keys(scope?.removed)
  if (
    !name ||
    goal === null ||
    day === null ||
    days === null ||
    daysLeft === null ||
    finishedLast90Days === null ||
    forecast === null ||
    points === null ||
    !items ||
    items.some((item) => item === null) ||
    plannedItems === null ||
    !added ||
    !removed
  )
    return null
  return {
    name,
    ...(goal ? { goal } : {}),
    day,
    days,
    daysLeft,
    ...(forecast ? { forecast } : {}),
    finishedLast90Days,
    ...(points ? { points } : {}),
    items: items as NonNullable<AiSprintContext['running']>['items'],
    scopeChange: { plannedItems, added, removed },
  }
}

function parseItem(value: unknown) {
  if (!isRecord(value)) return null
  const key = typeof value.key === 'string' && KEY.test(value.key)
  const state = STATES.has(value.state as AiSprintItemState)
  const status = text(value.status, 120)
  const chancePercent = optional(value.chancePercent, (chance) =>
    count(chance) !== null && (chance as number) <= 100
      ? (chance as number)
      : null,
  )
  const points = optional(value.points, count)
  const sprintsSoFar = count(value.sprintsSoFar)
  if (
    !key ||
    !state ||
    !status ||
    chancePercent === null ||
    points === null ||
    sprintsSoFar === null ||
    typeof value.addedMidSprint !== 'boolean'
  )
    return null
  return {
    key: value.key as string,
    state: value.state as AiSprintItemState,
    status,
    ...(chancePercent !== undefined ? { chancePercent } : {}),
    ...(points !== undefined ? { points } : {}),
    sprintsSoFar,
    addedMidSprint: value.addedMidSprint,
  }
}

function parsePlanning(value: unknown): AiSprintContext['planning'] | null {
  if (!isRecord(value)) return null
  const sprint = text(value.sprint, 80)
  const items =
    Array.isArray(value.items) && value.items.length <= ITEM_LIMIT
      ? value.items.map((item) => {
          if (!isRecord(item)) return null
          const points = optional(item.points, count)
          return typeof item.key === 'string' &&
            KEY.test(item.key) &&
            points !== null
            ? {
                key: item.key,
                ...(points !== undefined ? { points } : {}),
              }
            : null
        })
      : null
  if (!items || items.some((item) => item === null)) return null
  const numbers = [
    'planned',
    'unestimatedItems',
    'lastSprints',
    'low',
    'high',
    'usual',
  ].map((field) => count(value[field]))
  if (!sprint || numbers.some((entry) => entry === null)) return null
  const [planned, unestimatedItems, lastSprints, low, high, usual] =
    numbers as number[]
  return {
    sprint,
    items: items as Array<{ key: string; points?: number }>,
    planned: planned!,
    unestimatedItems: unestimatedItems!,
    lastSprints: lastSprints!,
    low: low!,
    high: high!,
    usual: usual!,
  }
}

function parsePoints(
  value: unknown,
): AiSprintContext['pointsPredictTime'] | null {
  if (!isRecord(value)) return null
  const verdict = value.verdict
  if (verdict !== 'yes' && verdict !== 'partly' && verdict !== 'no') return null
  const estimatedItems = count(value.estimatedItems)
  const smallUpToPoints = count(value.smallUpToPoints)
  const smallMedianDays = count(value.smallMedianDays)
  const largeMedianDays = count(value.largeMedianDays)
  if (
    estimatedItems === null ||
    smallUpToPoints === null ||
    smallMedianDays === null ||
    largeMedianDays === null
  )
    return null
  return {
    verdict,
    estimatedItems,
    smallUpToPoints,
    smallMedianDays,
    largeMedianDays,
  }
}

function parseClosed(
  value: unknown,
): AiSprintContext['lastSprints'][number] | null {
  if (!isRecord(value)) return null
  const name = text(value.name, 80)
  const goal = optional(value.goal, (goal) => text(goal, 300))
  const planned = count(value.planned)
  const finishedPlanned = count(value.finishedPlanned)
  const added = count(value.added)
  const removed = count(value.removed)
  const backToBacklog = optional(value.backToBacklog, count)
  const carriedOver = optional(value.carriedOver, count)
  const finishedPoints = optional(value.finishedPoints, count)
  if (
    !name ||
    goal === null ||
    planned === null ||
    finishedPlanned === null ||
    added === null ||
    removed === null ||
    backToBacklog === null ||
    carriedOver === null ||
    finishedPoints === null
  )
    return null
  return {
    name,
    ...(goal ? { goal } : {}),
    planned,
    finishedPlanned,
    added,
    removed,
    ...(backToBacklog !== undefined ? { backToBacklog } : {}),
    ...(carriedOver !== undefined ? { carriedOver } : {}),
    ...(finishedPoints !== undefined ? { finishedPoints } : {}),
  }
}
