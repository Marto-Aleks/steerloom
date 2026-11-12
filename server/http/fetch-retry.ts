/**
 * Retries a read request the provider throttled or briefly failed, honouring
 * Retry-After, with a short jittered back-off otherwise. Only for requests
 * that are safe to repeat (reads, and POSTs that only query).
 */
export const RETRY_STATUSES = new Set([429, 502, 503, 504])
const MAX_WAIT_MS = 10_000

export interface RetryOptions {
  /** Total attempts, including the first (default 3). */
  attempts?: number
  /** The caller's signal: an abort stops retrying at once. */
  signal?: AbortSignal
  /**
   * Also retry an attempt that is cut off (connection reset) or stays
   * silent past attemptTimeoutMs. Company VPNs drop a share of requests
   * without a word; one silent request must not fail a whole board.
   */
  retryDropped?: boolean
  /** With retryDropped: how long the reply may take to start. */
  attemptTimeoutMs?: number
  /** Test hook: how to wait. */
  wait?: (ms: number) => Promise<void>
  /** Test hook: jitter in [0, 1). */
  random?: () => number
}

/** The attempt receives the signal to pass to fetch (caller's + its own limit). */
type FetchLike<
  R extends { status: number; headers: { get(n: string): string | null } },
> = (signal: AbortSignal | undefined) => Promise<R>

/** Failures that will not change on a second try: fail fast with them. */
const LASTING_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED'])

/** A reset, a cut or a silent attempt; not a refusal, a bad address or a bug. */
export function isDropped(caught: unknown): boolean {
  if (!caught || typeof caught !== 'object') return false
  const error = caught as { name?: string; cause?: { code?: string } }
  if (error.name === 'TimeoutError') return true
  return (
    caught instanceof TypeError && !LASTING_CODES.has(error.cause?.code ?? '')
  )
}

export async function fetchWithRetry<
  R extends {
    status: number
    headers: { get(name: string): string | null }
    body?: { cancel(): Promise<void> } | null
  },
>(
  attempt: FetchLike<R>,
  {
    attempts = 3,
    signal,
    retryDropped = false,
    attemptTimeoutMs,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
  }: RetryOptions = {},
): Promise<R> {
  // The limit covers the wait for the reply to start, not reading the body:
  // a large page that is arriving is never cut off.
  const once = async () => {
    if (!retryDropped || !attemptTimeoutMs) return attempt(signal)
    const limit = new AbortController()
    const timer = setTimeout(
      () =>
        limit.abort(
          new DOMException('The reply did not start in time.', 'TimeoutError'),
        ),
      attemptTimeoutMs,
    )
    try {
      return await attempt(
        signal ? AbortSignal.any([signal, limit.signal]) : limit.signal,
      )
    } finally {
      clearTimeout(timer)
    }
  }
  for (let made = 1; ; made++) {
    let response: R
    try {
      response = await once()
    } catch (caught) {
      if (
        !retryDropped ||
        made >= attempts ||
        signal?.aborted ||
        !isDropped(caught)
      )
        throw caught
      await wait(retryDelayMs(null, made, random))
      if (signal?.aborted) throw caught
      continue
    }
    if (
      made >= attempts ||
      !RETRY_STATUSES.has(response.status) ||
      signal?.aborted
    )
      return response
    const delay = retryDelayMs(
      response.headers.get('retry-after'),
      made,
      random,
    )
    // Let the socket go before waiting; the body of a refusal is never read.
    await response.body?.cancel().catch(() => undefined)
    await wait(delay)
    if (signal?.aborted) return response
  }
}

/** Retry-After in seconds or as a date, capped; else 500 ms · 2^n with jitter. */
export function retryDelayMs(
  retryAfter: string | null,
  made: number,
  random: () => number = Math.random,
): number {
  if (retryAfter) {
    const seconds = Number(retryAfter)
    const fromHeader = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now()
    if (Number.isFinite(fromHeader) && fromHeader > 0)
      return Math.min(MAX_WAIT_MS, fromHeader)
  }
  const base = 500 * 2 ** (made - 1)
  return Math.min(MAX_WAIT_MS, base + random() * base)
}
