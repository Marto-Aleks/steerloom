/*
 * Reports that someone reached a step on the hosted site (landing, demo,
 * film, a real briefing, a one-click answer to "Was this useful?")
 * and, if they came through a tagged link, which one. Steps only: no board
 * data, no text. Never runs in
 * the local app or on the development server, and never blocks or fails
 * anything the person is doing.
 */
export type TrackedStep =
  | 'landing_view'
  | 'demo_opened'
  | 'film_played'
  | 'briefing_built'
  | 'briefing_useful'
  | 'briefing_not_useful'
  | 'demo_useful'
  | 'demo_not_useful'

const SOURCE_KEY = 'steerloom:source'
const SOURCE_DAYS = 30

/**
 * Which tagged link brought this visitor (`?src=li` on a LinkedIn post), so
 * the usage page can show what a post led to. Remembered for 30 days in this
 * browser so later steps, such as a first briefing, count for the same link.
 */
function linkSource(): string | undefined {
  try {
    const tagged = new URLSearchParams(window.location.search).get('src')
    if (tagged && /^[a-z0-9-]{1,24}$/i.test(tagged)) {
      const source = tagged.toLowerCase()
      localStorage.setItem(
        SOURCE_KEY,
        JSON.stringify({ source, at: Date.now() }),
      )
      return source
    }
    const saved = JSON.parse(localStorage.getItem(SOURCE_KEY) ?? 'null') as {
      source?: unknown
      at?: unknown
    } | null
    if (
      typeof saved?.source === 'string' &&
      typeof saved.at === 'number' &&
      Date.now() - saved.at < SOURCE_DAYS * 86_400_000
    )
      return saved.source
  } catch {
    /* No storage: the step still counts, just without a source. */
  }
  return undefined
}

export function track(step: TrackedStep): void {
  if (typeof document === 'undefined') return
  const hosted =
    document
      .querySelector('meta[name="steerloom-mode"]')
      ?.getAttribute('content') === 'hosted'
  if (!hosted) return
  try {
    void fetch('/api/hosted/event', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step, source: linkSource() }),
    }).catch(() => undefined)
  } catch {
    /* Counting never gets in the way. */
  }
}
