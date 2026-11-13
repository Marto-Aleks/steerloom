import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

/*
 * Usage counts for the hosted site: how many people reach each step, so the
 * operator can see where testers drop out. Steps only, never content: no
 * board data, no names, no emails. A person is a one-way code (HMAC of their
 * account id with a salt kept in the same file), only to count them once per
 * step. Stored as one small JSON file on the server's persistent disk.
 */

export const PERSON_STEPS = [
  'signed_in',
  'workspace_created',
  'board_connected',
  'briefing_built',
  'ai_question',
  'feedback_sent',
  'briefing_useful',
  'briefing_not_useful',
] as const
export const VISITOR_STEPS = [
  'landing_view',
  'demo_opened',
  'film_played',
  'install_started',
  'update_started',
  'demo_useful',
  'demo_not_useful',
] as const
export type UsageStep =
  | (typeof PERSON_STEPS)[number]
  | (typeof VISITOR_STEPS)[number]
/** Steps the browser may report; the rest are counted by the server itself. */
export const CLIENT_STEPS: ReadonlySet<string> = new Set([
  'landing_view',
  'demo_opened',
  'film_played',
  'briefing_built',
  'briefing_useful',
  'briefing_not_useful',
  'demo_useful',
  'demo_not_useful',
])
const ALL_STEPS: readonly UsageStep[] = [...VISITOR_STEPS, ...PERSON_STEPS]
const KEEP_DAYS = 90
const MAX_PEOPLE = 50_000
/** Distinct link sources kept; later ones are counted as "other". */
const MAX_SOURCES = 30

/** A link source as written in `?src=` (li, newsletter, …), or undefined. */
export function usageSource(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9-]{1,24}$/i.test(value)
    ? value.toLowerCase()
    : undefined
}

interface StepData {
  total: number
  people: string[]
}
interface UsageFile {
  salt: string
  since: string
  steps: Partial<Record<UsageStep, StepData>>
  days: Record<string, Partial<Record<UsageStep, number>>>
  /** Steps reached by visitors who arrived through a tagged link. */
  sources?: Record<string, Partial<Record<UsageStep, number>>>
}

export interface UsageReport {
  since: string
  steps: Array<{ step: UsageStep; people: number | null; total: number }>
  days: Array<{ day: string; counts: Partial<Record<UsageStep, number>> }>
  sources: Array<{
    source: string
    counts: Partial<Record<UsageStep, number>>
  }>
}

export interface UsageCounter {
  count(step: UsageStep, accountId?: string, source?: string): void
  report(): UsageReport
  flush(): void
}

/** The account id inside a Supabase access token (its `sub`), without verifying it. */
export function accountIdFromToken(accessToken: string): string | undefined {
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return undefined
    const value = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { sub?: unknown }
    return typeof value.sub === 'string' && value.sub.length <= 100
      ? value.sub
      : undefined
  } catch {
    return undefined
  }
}

export function usageCounter(
  file?: string,
  now: () => Date = () => new Date(),
): UsageCounter {
  const fresh = (): UsageFile => ({
    salt: randomBytes(32).toString('hex'),
    since: now().toISOString(),
    steps: {},
    days: {},
  })
  let data: UsageFile = fresh()
  if (file && existsSync(file)) {
    try {
      const loaded = JSON.parse(readFileSync(file, 'utf8')) as UsageFile
      if (typeof loaded.salt === 'string' && loaded.steps && loaded.days)
        data = loaded
    } catch {
      /* A damaged file starts over rather than stopping the server. */
    }
  }
  let timer: NodeJS.Timeout | undefined
  const save = () => {
    timer = undefined
    if (!file) return
    try {
      const temporary = `${file}.tmp`
      writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 })
      renameSync(temporary, file)
    } catch {
      /* Counting must never break the site. */
    }
  }
  const later = () => {
    timer ??= setTimeout(save, 5000)
    timer.unref?.()
  }
  const person = (accountId: string) =>
    createHmac('sha256', data.salt).update(accountId).digest('hex').slice(0, 24)
  return {
    count(step, accountId, source) {
      const entry = (data.steps[step] ??= { total: 0, people: [] })
      entry.total += 1
      if (accountId && entry.people.length < MAX_PEOPLE) {
        const code = person(accountId)
        if (!entry.people.includes(code)) entry.people.push(code)
      }
      if (source) {
        const sources = (data.sources ??= {})
        const key =
          Object.hasOwn(sources, source) ||
          Object.keys(sources).length < MAX_SOURCES
            ? source
            : 'other'
        const counts = (sources[key] ??= {})
        counts[step] = (counts[step] ?? 0) + 1
      }
      const day = now().toISOString().slice(0, 10)
      const counts = (data.days[day] ??= {})
      counts[step] = (counts[step] ?? 0) + 1
      const oldest = new Date(now().getTime() - KEEP_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10)
      for (const key of Object.keys(data.days))
        if (key < oldest) delete data.days[key]
      later()
    },
    report() {
      const personal = new Set<string>(PERSON_STEPS)
      return {
        since: data.since,
        steps: ALL_STEPS.map((step) => ({
          step,
          people: personal.has(step)
            ? (data.steps[step]?.people.length ?? 0)
            : null,
          total: data.steps[step]?.total ?? 0,
        })),
        days: Object.keys(data.days)
          .sort()
          .reverse()
          .slice(0, 14)
          .map((day) => ({ day, counts: data.days[day] ?? {} })),
        sources: Object.entries(data.sources ?? {})
          .map(([source, counts]) => ({ source, counts }))
          .sort(
            (a, b) =>
              (b.counts.landing_view ?? 0) +
              (b.counts.demo_opened ?? 0) -
              (a.counts.landing_view ?? 0) -
              (a.counts.demo_opened ?? 0),
          ),
      }
    },
    flush() {
      if (timer) clearTimeout(timer)
      save()
    },
  }
}
