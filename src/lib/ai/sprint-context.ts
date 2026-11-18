import type { SprintBriefing, SprintItemState } from '../statistics/sprint'
import type { AiSprintContext, AiSprintItemState } from './report-context'

/*
 * The Sprint tab's facts for Steerloom AI: what it shows, as keys and
 * numbers. Titles stay out, as everywhere else in the report context; the
 * assistant reads them from the board when it needs them.
 */

/** Enough for a large sprint; the rest is counted, not listed. */
const ITEM_LIMIT = 80

const stateWord: Record<SprintItemState, AiSprintItemState> = {
  done: 'done',
  track: 'on track',
  open: 'in progress',
  risk: 'at risk',
  todo: 'not started',
}

const round = (value: number) => Math.round(value * 10) / 10

export function toAiSprintContext(
  briefing: SprintBriefing,
): AiSprintContext | undefined {
  if (briefing.unavailable) return undefined
  const { active, planning, pointsTime, history, unit } = briefing
  const end = active?.sprint.endAt ? Date.parse(active.sprint.endAt) : NaN
  return {
    unit,
    ...(active
      ? {
          running: {
            name: active.sprint.name,
            ...(active.sprint.goal ? { goal: active.sprint.goal } : {}),
            day: active.day,
            days: active.days,
            // Whole days, as the Sprint tab shows them.
            daysLeft: Number.isFinite(end)
              ? Math.max(0, active.days - active.day)
              : 0,
            ...(active.sample
              ? {
                  forecast: {
                    likelyDone: active.likely,
                    atLeast85: active.atLeast,
                    sampleItems: active.sample,
                  },
                }
              : {}),
            finishedLast90Days: active.finishedRecently,
            ...(active.points ? { points: active.points } : {}),
            items: active.items.slice(0, ITEM_LIMIT).map((item) => ({
              key: item.key,
              state: stateWord[item.state],
              status: item.status,
              ...(item.chance !== undefined
                ? { chancePercent: Math.round(item.chance * 100) }
                : {}),
              ...(item.points !== undefined ? { points: item.points } : {}),
              sprintsSoFar: item.sprints,
              addedMidSprint: item.added,
            })),
            scopeChange: {
              plannedItems: active.planned.length,
              added: active.added.map((ref) => ref.key),
              removed: active.removed.map((ref) => ref.key),
            },
          },
        }
      : {}),
    ...(planning
      ? {
          planning: {
            sprint: planning.sprint.name,
            items: planning.items.slice(0, ITEM_LIMIT).map((item) => ({
              key: item.key,
              ...(item.points !== undefined ? { points: item.points } : {}),
            })),
            planned: planning.planned,
            unestimatedItems: planning.unestimated,
            lastSprints: planning.sprints,
            low: planning.low,
            high: planning.high,
            usual: planning.usual,
          },
        }
      : {}),
    ...(pointsTime
      ? {
          pointsPredictTime: {
            verdict: pointsTime.verdict,
            estimatedItems: pointsTime.items,
            smallUpToPoints: pointsTime.smallUpTo,
            smallMedianDays: round(pointsTime.smallMedian),
            largeMedianDays: round(pointsTime.largeMedian),
          },
        }
      : {}),
    lastSprints: history.map((view) => ({
      name: view.sprint.name,
      ...(view.sprint.goal ? { goal: view.sprint.goal } : {}),
      planned: view.planned.length,
      finishedPlanned: view.finishedPlanned,
      added: view.added.length,
      removed: view.removed.length,
      ...(unit === 'points' ? { finishedPoints: view.finishedPoints } : {}),
    })),
  }
}
