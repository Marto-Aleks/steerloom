import type {
  FlowBoardSnapshot,
  FlowMetrics,
  WorkInProgressAgePoint,
} from '../../types'
import { uniqueIssuesByIdentity } from '../issue-identity'
import { findDelayedWorkInProgress } from '.'
import { issueJourney, orderedEventsByIssue, stageZoneLookup } from './journey'
import {
  PILE_UP_MINIMUM,
  PILE_UP_SHARE,
  stageTimeShares,
  startFinishBalance,
  startsOutrunFinishes,
} from './stage-time'

export type FocusSignalSeverity = 'critical' | 'warning' | 'info' | 'healthy'

export interface FocusSignal {
  id:
    | 'delayed-wip'
    | 'wip-concentration'
    | 'owner-concentration'
    | 'no-owner'
    | 'active-reentry'
    | 'throughput-drop'
    | 'start-finish'
    | 'insufficient-history'
    | 'healthy'
    | 'review-wait'
    | 'merged-not-done'
    | 'checks-failing'
    | 'approved-not-merged'
    | 'large-pull-requests'
  severity: FocusSignalSeverity
  title: string
  evidence: string
  action: string
  /** Short meta line for the card: the affected items or the time range. */
  meta?: string
  jiraFilter?: JiraFilterLink
}

export interface JiraFilterLink {
  label: string
  href: string
}

export interface FocusNowSummary {
  signals: FocusSignal[]
  delayedWorkInProgress: WorkInProgressAgePoint[]
  reenteredWorkInProgress: Array<{
    item: string
    currentStatus: string
  }>
}

export const TODAY_PRIORITY_LIMIT = 3

/** One person holds at least this share of active work… */
export const OWNER_SHARE = 0.4
/** …and at least this many items, on a board where several people hold work. */
export const OWNER_MINIMUM = 5
/** Active items nobody holds, on a board that assigns work. */
export const NO_OWNER_MINIMUM = 3

export interface TodaySignalSelection {
  priorities: FocusSignal[]
  additional: FocusSignal[]
}

interface FocusNowInput {
  snapshot: FlowBoardSnapshot
  selectedColumnIds: string[]
  metrics: FlowMetrics
  windowDays: number | null
  /** Share of finished items' time per measured column id; computed from the snapshot when absent. */
  timeShares?: Map<string, number>
}

export interface CurrentWorkItem {
  item: string
  browseUrl?: string
  title?: string
  column: string
  selectedVisitCount: number
  assignee?: string
  ownerKnown?: boolean
}

export function selectTodaySignals(
  signals: FocusSignal[],
  limit = TODAY_PRIORITY_LIMIT,
): TodaySignalSelection {
  const safeLimit = Math.max(1, Math.floor(limit))
  return {
    priorities: signals.slice(0, safeLimit),
    additional: signals.slice(safeLimit),
  }
}

export function focusSignalActionLabel(signal: FocusSignal): string {
  switch (signal.id) {
    case 'delayed-wip':
      return 'Investigate aging items'
    case 'wip-concentration':
      return 'Investigate work concentration'
    case 'owner-concentration':
      return 'Investigate the load'
    case 'no-owner':
      return 'Review the unowned items'
    case 'active-reentry':
      return 'Review re-entered items'
    case 'throughput-drop':
      return 'Investigate throughput drop'
    case 'start-finish':
      return 'Investigate what was started'
    case 'insufficient-history':
      return 'Review available evidence'
    case 'healthy':
      return 'Review flow health'
    case 'review-wait':
      return 'Investigate the review wait'
    case 'merged-not-done':
      return 'Review the merged items'
    case 'checks-failing':
      return 'Investigate the failing checks'
    case 'approved-not-merged':
      return 'Review the approved work'
    case 'large-pull-requests':
      return 'Investigate the large changes'
  }
}

export function focusSignalAgentPrompt(signal: FocusSignal): string {
  return `${signal.title}\n${signal.evidence}\n\n${focusSignalInvestigationPrompt(signal)} Cite relevant ticket evidence, distinguish observed facts from possible causes, and end with a concrete team action and a measurable checkpoint.`
}

function focusSignalInvestigationPrompt(signal: FocusSignal): string {
  switch (signal.id) {
    case 'delayed-wip':
      return 'Help me decide what to address first in the delayed WIP. Use the report evidence, distinguish age from cause, and propose the smallest useful board check before recommending action.'
    case 'wip-concentration':
      return 'Assess the work concentration signal in this report. Treat possible causes as hypotheses, explain what decision the team may need to make, and identify the smallest evidence check that would reduce uncertainty.'
    case 'owner-concentration':
      return "One person holds much of the active work. Treat it as a load and single-point-of-failure problem, never as that person's performance. Check which of the items others could take or finish together, and propose what to hand over this week with a measurable checkpoint."
    case 'no-owner':
      return 'Active items have no owner. Check whether each one is really in progress, who could own it, or whether it should go back to the backlog, and propose a checkpoint for the next refresh.'
    case 'active-reentry':
      return 'Review the active re-entry signal. Explain what the report proves, what it does not prove, and the smallest board check that could distinguish rework from an unclear flow policy.'
    case 'start-finish':
      return 'More items were started than finished. List what was started, whether it was pulled or pushed, and what the team could finish first before starting more. Frame the decision as a limit on work in progress with a measurable checkpoint.'
    case 'throughput-drop':
      return 'Explain the throughput deterioration in this report. Compare the available periods and sample sizes, avoid unsupported causal claims, and frame the next team decision with a measurable checkpoint.'
    case 'insufficient-history':
      return 'Explain which insights are available without a completed cycle-time sample. Use observed current-work evidence and do not invent a service-level baseline.'
    case 'healthy':
      return 'Prepare a short flow health review from this report. Summarize what looks clear, what still deserves watching, and when the team should review the evidence again.'
    case 'review-wait':
      return 'Pull requests wait long for a first review. Treat it as a team agreement problem, never as any reviewer’s performance. Check which items wait now and propose a review agreement with a measurable checkpoint.'
    case 'merged-not-done':
      return 'Items are merged but still in progress on the board. Check for each whether testing happens after the merge or the card was not moved, and propose the smallest board or policy change.'
    case 'checks-failing':
      return 'Pull requests have failing checks on their latest commit. For each, say how long it has been open, whether it is already approved, and what the red build holds back on the board. Propose the smallest team agreement, such as fixing a red build before new work, with a measurable checkpoint. Never blame whoever wrote the code.'
    case 'approved-not-merged':
      return 'Approved pull requests wait days to be merged. Check how long each has waited since approval, what the card on the board says, and what merging would unblock. Treat it as a missing team agreement about who merges, and propose one with a measurable checkpoint.'
    case 'large-pull-requests':
      return 'Large pull requests take much longer to merge than small ones. Show the comparison with the numbers, name any large one open now and where its item stands, and propose a concrete size agreement with a measurable checkpoint. Treat size as a way of slicing work, never as anyone’s fault.'
  }
}

export function buildFocusNowSummary({
  snapshot,
  selectedColumnIds,
  metrics,
  windowDays,
  timeShares,
}: FocusNowInput): FocusNowSummary {
  const delayedWorkInProgress = findDelayedWorkInProgress(
    snapshot,
    selectedColumnIds,
    metrics.percentile85CycleTime ?? Number.POSITIVE_INFINITY,
  )
  const currentWork = currentWorkItems(snapshot, selectedColumnIds)
  const signals: FocusSignal[] = []
  if (metrics.workItemCount === 0)
    signals.push({
      id: 'insufficient-history',
      severity: 'warning',
      title: 'No usual limit yet',
      evidence:
        'No finished items match this scope, so aging work cannot be compared with a usual limit (P85). Treat today’s view as incomplete.',
      action:
        'Review current work and confirm the measured stages and period. Collect completed history before interpreting service levels.',
    })

  if (delayedWorkInProgress.length) {
    const usual = metrics.percentile85CycleTime ?? 0
    const oldest = [...delayedWorkInProgress].sort(
      (left, right) => right.ageInSelectedColumns - left.ageInSelectedColumns,
    )[0]
    const oldestPhrase = oldest
      ? `Oldest: ${oldest.item}, ${formatDayCount(oldest.ageInSelectedColumns)} in progress${usual > 0 ? `, ${formatMultiple(oldest.ageInSelectedColumns / usual)} the usual` : ''}. `
      : ''
    signals.push({
      id: 'delayed-wip',
      severity: 'critical',
      title: `${formatCount(delayedWorkInProgress.length, 'item')} past the usual ${formatDayCount(usual)}`,
      evidence: `${oldestPhrase}85% of finished items were done within ${formatDayCount(usual)}, so these are already late.`,
      action: 'Review the delayed items and agree what to unblock first.',
      meta: itemList(
        [...delayedWorkInProgress]
          .sort(
            (left, right) =>
              right.ageInSelectedColumns - left.ageInSelectedColumns,
          )
          .map(({ item }) => item),
      ),
      jiraFilter: buildJiraFilter(
        delayedWorkInProgress,
        'Open the delayed items in Jira',
      ),
    })
  }

  const balance = startFinishBalance(snapshot, selectedColumnIds)
  if (balance && startsOutrunFinishes(balance)) {
    signals.push({
      id: 'start-finish',
      severity: 'warning',
      title: 'Starting more than finishing',
      evidence: `${formatCount(balance.started, 'item')} started and ${balance.finished} finished in the last two complete weeks. Active work grew from ${balance.activeThen} to ${balance.activeNow}.`,
      meta: 'Last 2 complete weeks',
      action: 'Finish before starting: agree what the team completes first.',
    })
  }

  const pile = pileUpColumn(
    snapshot,
    selectedColumnIds,
    currentWork,
    timeShares ?? stageTimeShares(snapshot, selectedColumnIds),
  )
  if (pile) {
    signals.push({
      id: 'wip-concentration',
      severity: 'warning',
      title: `Work is piling up in “${pile.column}”`,
      evidence: `Finished items spent ${formatPercentage(pile.share)} of their time in ${pile.column}, and ${pile.count} of ${currentWork.length} active items sit there now.`,
      meta: `${formatCount(pile.count, 'item')} in ${pile.column}`,
      action:
        'Review capacity, handoffs, and pull policy at this workflow step.',
    })
  }

  const load = ownerConcentration(currentWork)
  if (load) {
    signals.push({
      id: 'owner-concentration',
      severity: 'warning',
      title: 'Work piles on one person',
      evidence: `${load.owner} holds ${load.items.length} of ${currentWork.length} active items (${formatPercentage(load.items.length / currentWork.length)}). If ${load.owner} is out, no one else holds them.`,
      meta: `${formatCount(load.items.length, 'item')} with ${load.owner}`,
      action: `Spread the load: agree what ${load.owner} hands over this week.`,
      jiraFilter: buildJiraFilter(
        load.items,
        `Open ${load.owner}’s items in Jira`,
      ),
    })
  }

  const unowned = unownedWork(currentWork)
  if (unowned.length) {
    signals.push({
      id: 'no-owner',
      severity: 'warning',
      title: `${formatCount(unowned.length, 'active item')} have no owner`,
      evidence: `${formatCount(unowned.length, 'item')} ${unowned.length === 1 ? 'is' : 'are'} in progress but assigned to nobody.`,
      meta: itemList(unowned.map(({ item }) => item)),
      action: 'Give each one an owner today, or move it back to the backlog.',
      jiraFilter: buildJiraFilter(unowned, 'Open the unowned items in Jira'),
    })
  }

  const reentered = findReenteredWorkInProgress(snapshot, selectedColumnIds)
  if (reentered.length) {
    signals.push({
      id: 'active-reentry',
      severity: 'info',
      title: `${formatCount(reentered.length, 'active item')} re-entered the flow`,
      evidence: `${formatCount(reentered.length, 'item')} came back after leaving the measured stages: often rework or an unclear done policy.`,
      meta: itemList(reentered.map(({ item }) => item)),
      action:
        'Review the re-entered items and check whether rework or an unclear exit policy caused the return.',
      jiraFilter: buildJiraFilter(
        reentered,
        'Open the re-entered items in Jira',
      ),
    })
  }

  const throughputSignal = throughputDropSignal(
    metrics,
    snapshot.loadedAt,
    windowDays,
  )
  if (throughputSignal) signals.push(throughputSignal)

  if (!signals.length) {
    signals.push({
      id: 'healthy',
      severity: 'healthy',
      title: 'No immediate flow risk detected',
      evidence:
        'No active item is past the usual limit (P85), and the pile-up, rework and slowdown rules did not fire.',
      action:
        'Keep the current flow policies and review again after the next refresh.',
    })
  }

  return {
    signals,
    delayedWorkInProgress,
    reenteredWorkInProgress: reentered.map(({ item, column }) => ({
      item,
      currentStatus: column,
    })),
  }
}

export function findReenteredWorkInProgress(
  snapshot: FlowBoardSnapshot,
  selectedColumnIds: string[],
) {
  return currentWorkItems(snapshot, selectedColumnIds).filter(
    ({ selectedVisitCount }) => selectedVisitCount > 1,
  )
}

function currentWorkItems(
  snapshot: FlowBoardSnapshot,
  selectedColumnIds: string[],
): CurrentWorkItem[] {
  if (!selectedColumnIds.length) return []
  const zoneOf = stageZoneLookup(snapshot.board, selectedColumnIds)
  const columnByStatus = new Map<string, string>()
  snapshot.board.columns.forEach((column) => {
    const selected = selectedColumnIds.includes(column.id)
    column.statusIds.forEach((statusId) => {
      if (!columnByStatus.has(statusId) || selected)
        columnByStatus.set(statusId, column.name)
    })
  })
  const eventsByIssue = orderedEventsByIssue(snapshot)

  return uniqueIssuesByIdentity(snapshot.issues).flatMap(
    (issue): CurrentWorkItem[] => {
      const journey = issueJourney(
        issue,
        eventsByIssue.get(issue.id) ?? [],
        zoneOf,
      )
      if (journey.outcome !== 'active') return []
      return [
        {
          item: issue.key,
          browseUrl: issue.browseUrl,
          ...(issue.title ? { title: issue.title } : {}),
          ...(issue.assignee ? { assignee: issue.assignee } : {}),
          ...(issue.ownerKnown ? { ownerKnown: true } : {}),
          column:
            columnByStatus.get(journey.currentStatusId) ??
            journey.currentStatusId,
          // Separate trips through the measured stages; a pause in an
          // unmeasured stage between them (Blocked) is not a new trip.
          selectedVisitCount: journey.journeys,
        },
      ]
    },
  )
}

/**
 * The person holding the largest share of active work, when it is a real
 * concentration: several people hold work on this board, and one of them
 * holds at least OWNER_SHARE of it and OWNER_MINIMUM items.
 */
function ownerConcentration(
  currentWork: CurrentWorkItem[],
): { owner: string; items: CurrentWorkItem[] } | null {
  const byOwner = new Map<string, CurrentWorkItem[]>()
  currentWork.forEach((item) => {
    if (!item.assignee) return
    byOwner.set(item.assignee, [...(byOwner.get(item.assignee) ?? []), item])
  })
  if (byOwner.size < 2) return null
  const [owner, items] = [...byOwner].sort(
    (left, right) =>
      right[1].length - left[1].length || left[0].localeCompare(right[0]),
  )[0]!
  if (items.length < OWNER_MINIMUM) return null
  if (items.length / currentWork.length < OWNER_SHARE) return null
  return { owner, items }
}

/**
 * Active items with no owner, only on boards that assign work: when nobody
 * holds anything, the team simply does not use the field.
 */
function unownedWork(currentWork: CurrentWorkItem[]): CurrentWorkItem[] {
  const tracked = currentWork.filter(({ ownerKnown }) => ownerKnown)
  if (!tracked.some(({ assignee }) => assignee)) return []
  const unowned = tracked.filter(({ assignee }) => !assignee)
  return unowned.length >= NO_OWNER_MINIMUM ? unowned : []
}

/**
 * The measured stage where finished work spent most of its time, when enough
 * active items sit there now. Null when time is spread out, when nothing has
 * finished yet, or when the stage is slow but not holding a pile today.
 */
function pileUpColumn(
  snapshot: FlowBoardSnapshot,
  selectedColumnIds: string[],
  currentWork: CurrentWorkItem[],
  timeShares: Map<string, number>,
): { column: string; share: number; count: number } | null {
  const slowest = [...timeShares.entries()]
    .filter(([id]) => selectedColumnIds.includes(id))
    .sort((left, right) => right[1] - left[1])[0]
  if (!slowest || slowest[1] < PILE_UP_SHARE) return null
  const column = snapshot.board.columns.find(({ id }) => id === slowest[0])
  if (!column) return null
  const count = currentWork.filter((item) => item.column === column.name).length
  if (count < PILE_UP_MINIMUM) return null
  return { column: column.name, share: slowest[1], count }
}

function throughputDropSignal(
  metrics: FlowMetrics,
  loadedAt: string,
  windowDays: number | null,
): FocusSignal | null {
  if (windowDays !== null && windowDays < 28) return null

  const loadedAtTime = Date.parse(loadedAt)
  if (!Number.isFinite(loadedAtTime)) return null
  const currentWeekStart = startOfUtcWeek(loadedAtTime)
  const firstWeekStart = currentWeekStart - 4 * 7 * 86_400_000
  const weeklyCounts = [0, 0, 0, 0]

  metrics.cycleTimes.forEach(({ cycleEnd }) => {
    const exitTime = Date.parse(cycleEnd)
    if (exitTime < firstWeekStart || exitTime >= currentWeekStart) return
    const index = Math.floor((exitTime - firstWeekStart) / (7 * 86_400_000))
    if (index >= 0 && index < weeklyCounts.length) {
      weeklyCounts[index] = (weeklyCounts[index] ?? 0) + 1
    }
  })

  const previousExits = (weeklyCounts[0] ?? 0) + (weeklyCounts[1] ?? 0)
  const recentExits = (weeklyCounts[2] ?? 0) + (weeklyCounts[3] ?? 0)
  if (
    previousExits < 2 ||
    recentExits >= previousExits ||
    recentExits / previousExits > 0.75
  ) {
    return null
  }

  return {
    id: 'throughput-drop',
    severity: 'warning',
    title: 'Fewer items finished recently',
    evidence: `${formatCount(recentExits, 'item')} finished in the last two complete weeks, down from ${previousExits} in the two before. If this holds, the forecast dates move later.`,
    meta: 'Last 4 complete weeks',
    action:
      'Check whether growing WIP or a downstream queue is slowing completion.',
  }
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

function formatCount(count: number, singular: string) {
  return `${count.toLocaleString()} ${count === 1 ? singular : `${singular}s`}`
}

function formatDayCount(days: number) {
  const value = days.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return `${value} ${days === 1 ? 'day' : 'days'}`
}

function formatMultiple(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}×`
}

// Up to six item keys, then a count of the rest.
function itemList(keys: string[]) {
  const shown = keys.slice(0, 6).join(', ')
  return keys.length > 6 ? `${shown} + ${keys.length - 6} more` : shown
}

function formatPercentage(value: number) {
  return `${Math.round(value * 100)}%`
}

function buildJiraFilter(
  tickets: Array<{ item: string; browseUrl?: string }>,
  label: string,
): JiraFilterLink | undefined {
  const jiraBase = tickets
    .map(({ browseUrl }) => jiraIssueNavigatorUrl(browseUrl))
    .find((url): url is URL => Boolean(url))
  if (!jiraBase) return undefined

  const keys = [
    ...new Set(
      tickets
        .map(({ item }) => item.trim())
        .filter((item) => /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(item)),
    ),
  ]
  if (!keys.length) return undefined

  jiraBase.searchParams.set('jql', `key in (${keys.join(', ')})`)
  return { label, href: jiraBase.toString() }
}

function jiraIssueNavigatorUrl(browseUrl?: string): URL | null {
  if (!browseUrl) return null
  try {
    const url = new URL(browseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const browseMarker = '/browse/'
    const browseIndex = url.pathname.lastIndexOf(browseMarker)
    if (browseIndex < 0) return null

    const contextPath = url.pathname.slice(0, browseIndex)
    url.pathname = `${contextPath}/issues/`
    url.search = ''
    url.hash = ''
    return url
  } catch {
    return null
  }
}
