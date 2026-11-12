import type { FlowBoardSnapshot } from '../../types'
import { uniqueIssuesByIdentity } from '../issue-identity'
import { collectAgingWork } from './aging-work'
import { issueJourney, orderedEventsByIssue, stageZoneLookup } from './journey'
import { snapshotAtTime } from './snapshot-filter'

/*
 * Two causes of delay read from the same history as the symptoms:
 *  - where finished items spent their time, per measured stage;
 *  - how many items were started against finished in the last two complete
 *    weeks, with the size of active work then and now.
 */

const DAY = 86_400_000
const WEEK = 7 * DAY

/*
 * A stage is a pile-up when finished work spent most of its measured time
 * there and enough active items sit there now. Time share says where delay
 * comes from; the count says the pile is real today, not just a slow stage.
 */
export const PILE_UP_SHARE = 0.6
export const PILE_UP_MINIMUM = 4

/**
 * Share (0–1) of finished items' measured cycle time spent in each measured
 * column, keyed by column id. Only items that finished count, so the answer
 * is what normally happens on this board, not where today's work sits.
 */
export function stageTimeShares(
  snapshot: FlowBoardSnapshot,
  selectedColumnIds: string[],
): Map<string, number> {
  const shares = new Map<string, number>()
  if (!selectedColumnIds.length) return shares
  const zoneOf = stageZoneLookup(snapshot.board, selectedColumnIds)
  const columnByStatus = new Map<string, string>()
  snapshot.board.columns.forEach((column) => {
    if (!selectedColumnIds.includes(column.id)) return
    column.statusIds.forEach((statusId) => {
      if (!columnByStatus.has(statusId)) columnByStatus.set(statusId, column.id)
    })
  })
  const eventsByIssue = orderedEventsByIssue(snapshot)
  const timeByColumn = new Map<string, number>()
  let total = 0
  uniqueIssuesByIdentity(snapshot.issues).forEach((issue) => {
    const events = eventsByIssue.get(issue.id) ?? []
    if (issueJourney(issue, events, zoneOf).outcome !== 'finished') return
    events.forEach((event, index) => {
      if (zoneOf(event.statusId) !== 'tracked') return
      const next = events[index + 1]
      if (!next || next.time < event.time) return
      const column = columnByStatus.get(event.statusId)
      if (!column) return
      const spent = next.time - event.time
      timeByColumn.set(column, (timeByColumn.get(column) ?? 0) + spent)
      total += spent
    })
  })
  if (total <= 0) return shares
  timeByColumn.forEach((spent, column) => shares.set(column, spent / total))
  return shares
}

export interface StartFinishBalance {
  /** Items that first entered a measured stage in the window. */
  started: number
  /** Items that left the measured stages for good in the window. */
  finished: number
  days: number
  /** Active items at the start of the window and now. */
  activeThen: number
  activeNow: number
  windowStart: string
  windowEnd: string
}

/**
 * Started against finished over the last two complete weeks (Monday to
 * Sunday, UTC), the same window the throughput-drop rule reads.
 */
export function startFinishBalance(
  snapshot: FlowBoardSnapshot,
  selectedColumnIds: string[],
): StartFinishBalance | null {
  if (!selectedColumnIds.length) return null
  const loadedAt = Date.parse(snapshot.loadedAt)
  if (!Number.isFinite(loadedAt)) return null
  const end = startOfUtcWeek(loadedAt)
  const start = end - 2 * WEEK
  if (!historyReaches(snapshot, start)) return null

  const zoneOf = stageZoneLookup(snapshot.board, selectedColumnIds)
  const eventsByIssue = orderedEventsByIssue(snapshot)
  let started = 0
  let finished = 0
  uniqueIssuesByIdentity(snapshot.issues).forEach((issue) => {
    const events = eventsByIssue.get(issue.id) ?? []
    const journey = issueJourney(issue, events, zoneOf)
    const firstEntry = Date.parse(journey.firstEntry)
    if (Number.isFinite(firstEntry) && firstEntry >= start && firstEntry < end)
      started += 1
    if (
      journey.outcome === 'finished' &&
      journey.finishedTime >= start &&
      journey.finishedTime < end
    )
      finished += 1
  })
  const windowStart = new Date(start).toISOString()
  const activeThen = collectAgingWork(
    snapshotAtTime(snapshot, windowStart),
    selectedColumnIds,
  ).length
  const activeNow = collectAgingWork(snapshot, selectedColumnIds).length
  return {
    started,
    finished,
    days: 14,
    activeThen,
    activeNow,
    windowStart,
    windowEnd: new Date(end).toISOString(),
  }
}

/** Started outruns finished clearly, and active work grew with it. */
export function startsOutrunFinishes(balance: StartFinishBalance): boolean {
  return (
    balance.started - balance.finished >= 3 &&
    balance.started >= 1.5 * balance.finished &&
    balance.activeNow > balance.activeThen
  )
}

function historyReaches(snapshot: FlowBoardSnapshot, time: number) {
  return snapshot.transitions.some((transition) => {
    const entered = Date.parse(transition.enteredAt)
    return Number.isFinite(entered) && entered < time
  })
}

function startOfUtcWeek(value: number) {
  const date = new Date(value)
  const day = date.getUTCDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceMonday,
  )
}
