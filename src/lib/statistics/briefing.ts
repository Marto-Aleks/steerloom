import type { AgingWorkItem } from './aging-work'
import type { DataQualityStatus } from './data-quality'
import type { FocusSignal } from './focus-now'
import type { FlowPeriodComparison } from './flow-evidence'
import { PILE_UP_MINIMUM, PILE_UP_SHARE } from './stage-time'

/*
 * Plain-language briefing for the top of a report. Every sentence is built
 * from numbers the report already computed; nothing here estimates, forecasts
 * or refers to individuals. The rules are deliberately few and visible:
 *
 *  insufficient  no completed sample → typical time and the usual limit are
 *                unknown, so the briefing never gives an all-clear.
 *  attention     at least one active item is past the usual limit (P85), or a
 *                critical signal fired.
 *  watch         a warning signal fired (work piling up in one stage, fewer
 *                items finishing), or fewer than SMALL_SAMPLE items finished.
 *  steady        everything else: healthy or informational signals only.
 */

export type BriefingTone = 'steady' | 'watch' | 'attention' | 'insufficient'

export interface Briefing {
  tone: BriefingTone
  headline: string
  summary: string
  caveats: string[]
}

export interface BriefingInput {
  completedCount: number
  medianDays: number | null
  p85Days: number | null
  signals: FocusSignal[]
  activeCount: number
  beyondLimitCount: number
  reenteredCount?: number
  comparison?: FlowPeriodComparison | null
  dataQuality?: DataQualityStatus
}

export const SMALL_SAMPLE = 10

export function buildBriefing(input: BriefingInput): Briefing {
  const caveats = qualityCaveats(input)
  const {
    completedCount,
    medianDays,
    p85Days,
    signals,
    activeCount,
    beyondLimitCount,
  } = input

  if (completedCount <= 0 || medianDays === null || p85Days === null) {
    return {
      tone: 'insufficient',
      headline: 'Not enough finished work to judge delivery yet.',
      summary:
        activeCount > 0
          ? `${countOf(activeCount, 'active item')} ${activeCount === 1 ? 'sits' : 'sit'} in the measured stages, but nothing finished in this period, so typical times and the usual limit cannot be calculated.`
          : 'Nothing finished in this period and nothing is active in the measured stages, so there is no delivery to judge yet.',
      caveats: ['No completed sample: this is not an all-clear.', ...caveats],
    }
  }

  const warnings = signals.filter(
    (signal) =>
      signal.severity === 'warning' && signal.id !== 'insufficient-history',
  )
  const critical = signals.some((signal) => signal.severity === 'critical')
  const facts = `Half of the ${countOf(completedCount, 'finished item')} took ${days(medianDays)} or less; 85% within ${days(p85Days)}`
  const trend = typicalTimeTrend(input.comparison)
  const extras = warnings.map(warningPhrase).filter(Boolean)

  if (beyondLimitCount > 0) {
    // Ties the count to the active total shown beside it, and says what
    // "usual" means instead of naming a percentile.
    return {
      tone: 'attention',
      headline: `${formatNumber(beyondLimitCount)} of ${countOf(activeCount, 'item')} in progress ${beyondLimitCount === 1 ? 'has' : 'have'} taken longer than usual.`,
      // One short fact. The trend is on the tiles below, so it is not
      // repeated here.
      summary: `Usual is ${days(p85Days)}, from ${countOf(completedCount, 'finished item')}.`,
      caveats,
    }
  }

  if (critical) {
    return {
      tone: 'attention',
      headline: 'A signal on this board needs a decision today.',
      summary: sentence([facts, trend]),
      caveats,
    }
  }

  if (warnings.length) {
    const [first] = extras
    return {
      tone: 'watch',
      headline: `Delivery is moving, but ${first ?? 'one rule-based signal needs a look'}.`,
      summary: sentence([facts, trend]),
      caveats,
    }
  }

  if (completedCount < SMALL_SAMPLE) {
    return {
      tone: 'watch',
      headline: `Early signs look steady, but only ${countOf(completedCount, 'item')} ${completedCount === 1 ? 'has' : 'have'} finished so far.`,
      summary: sentence([facts, trend]),
      caveats,
    }
  }

  return {
    tone: 'steady',
    headline: `Delivery is steady: ${countOf(completedCount, 'item')} finished, typical time ${days(medianDays)}.`,
    summary: sentence([facts, trend]),
    caveats,
  }
}

function qualityCaveats(input: BriefingInput): string[] {
  const caveats: string[] = []
  if (input.completedCount > 0 && input.completedCount < SMALL_SAMPLE) {
    caveats.push(
      `Small sample: only ${countOf(input.completedCount, 'item')} finished, so treat these numbers as indicative.`,
    )
  }
  if (input.dataQuality && input.dataQuality !== 'ready') {
    caveats.push(
      'Data checks found something worth a look (see How this was measured).',
    )
  }
  return caveats
}

function warningPhrase(signal: FocusSignal): string {
  switch (signal.id) {
    case 'wip-concentration':
      return lowerFirst(signal.title)
    case 'throughput-drop':
      return 'fewer items finished in the last two weeks than in the two before'
    case 'start-finish':
      return 'more work was started than finished in the last two weeks'
    default:
      return ''
  }
}

function typicalTimeTrend(
  comparison: FlowPeriodComparison | null | undefined,
): string {
  if (!comparison) return ''
  const current = comparison.current.medianCycleTimeDays
  const previous = comparison.previous.medianCycleTimeDays
  if (current === null || previous === null) return ''
  const period = `the previous ${comparison.previous.period.days} days`
  const difference = current - previous
  // An unchanged trend is not news; the briefing stays one short sentence.
  if (Math.abs(difference) < 0.05) return ''
  return `typical time is ${days(Math.abs(difference))} ${difference < 0 ? 'quicker' : 'slower'} than ${period}`
}

export interface StageLoad {
  id: string
  name: string
  count: number
  /** Of `count`, items already past the usual limit (P85); set when known. */
  late?: number
  /** Share (0–1) of finished items' cycle time spent in this stage; set when known. */
  timeShare?: number
}

// Active items per measured stage, in board order, including empty stages.
// An unmeasured stage between them (Blocked) shows only while it holds work.
export function stageLoads(
  columns: Array<{ id: string; name: string }>,
  selectedColumnIds: string[],
  items: AgingWorkItem[],
  isLate?: (item: AgingWorkItem) => boolean,
): StageLoad[] {
  return columns
    .filter(
      (column) =>
        selectedColumnIds.includes(column.id) ||
        items.some((item) => item.columnId === column.id),
    )
    .map((column) => {
      const inStage = items.filter((item) => item.columnId === column.id)
      return {
        id: column.id,
        name: column.name,
        count: inStage.length,
        ...(isLate ? { late: inStage.filter(isLate).length } : {}),
      }
    })
}

// The stage where finished work spent most of its time and enough active
// items sit now, mirroring the work-concentration rule in focus-now, or null
// when time is spread out or the time shares are unknown.
export function pileUpStage(loads: StageLoad[]): StageLoad | null {
  const slowest = loads
    .filter((load) => load.timeShare !== undefined)
    .sort((left, right) => (right.timeShare ?? 0) - (left.timeShare ?? 0))[0]
  if (!slowest || (slowest.timeShare ?? 0) < PILE_UP_SHARE) return null
  return slowest.count >= PILE_UP_MINIMUM ? slowest : null
}

function sentence(parts: string[]): string {
  const filled = parts.filter((part) => part.length > 0)
  return `${filled.join('; ')}.`
}

function countOf(count: number, singular: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : `${singular}s`}`
}

function days(value: number): string {
  return `${formatNumber(value)} ${value === 1 ? 'day' : 'days'}`
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1)
}
