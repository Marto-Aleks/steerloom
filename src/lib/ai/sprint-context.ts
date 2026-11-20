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

/*
 * Jira lets a team write a long goal, sprint name or status; the server
 * accepts them up to these lengths. Longer ones are shortened here, so free
 * text can never turn a question into an invalid request.
 */
const GOAL_CHARS = 300
const NAME_CHARS = 80
const STATUS_CHARS = 120
const within = (value: string, max: number) => {
  const text = value.trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

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
            name: within(active.sprint.name, NAME_CHARS),
            ...(active.sprint.goal?.trim()
              ? { goal: within(active.sprint.goal, GOAL_CHARS) }
              : {}),
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
              status: within(item.status, STATUS_CHARS),
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
            sprint: within(planning.sprint.name, NAME_CHARS),
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
      name: within(view.sprint.name, NAME_CHARS),
      ...(view.sprint.goal?.trim()
        ? { goal: within(view.sprint.goal, GOAL_CHARS) }
        : {}),
      planned: view.planned.length,
      finishedPlanned: view.finishedPlanned,
      added: view.added.length,
      // What did not finish, by where it went. "Removed" alone would lump
      // work carried into the next sprint with work taken out for good.
      backToBacklog: view.removed.length - view.movedOn.length,
      carriedOver: view.carriedOver.length,
      ...(unit === 'points'
        ? {
            plannedPoints: view.plannedPoints,
            finishedPoints: view.finishedPoints,
          }
        : {}),
    })),
  }
}
