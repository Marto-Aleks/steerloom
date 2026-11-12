/*
 * One unexpected error must not take the server down for everyone. A promise
 * that fails with nobody waiting for it, or an error thrown inside a
 * callback, ends a Node process by default: every request in flight is cut
 * off and, on the hosted site, everyone waits for the restart. The request
 * that hit the error has already failed; the others carry on.
 *
 * Each one is logged with a fixed prefix, so the hosting log (or an alert on
 * it) shows that something needs fixing. A burst of them means the process
 * itself is in trouble: then it does stop, and the host starts a fresh one.
 */
export const UNEXPECTED_ERROR = '[unexpected error]'

const BURST = 20
const BURST_WINDOW_MS = 60_000

type Listener = (reason: unknown) => void

export function keepServing({
  target = process,
  log = (...parts: unknown[]) => console.error(...parts),
  exit = (code: number) => process.exit(code),
  now = Date.now,
}: {
  target?: { on(event: string, listener: Listener): unknown }
  log?: (...parts: unknown[]) => void
  exit?: (code: number) => void
  now?: () => number
} = {}) {
  let recent: number[] = []
  const handle = (kind: string) => (reason: unknown) => {
    log(UNEXPECTED_ERROR, kind, reason)
    const at = now()
    recent = [...recent.filter((time) => time > at - BURST_WINDOW_MS), at]
    if (recent.length >= BURST) {
      log(
        UNEXPECTED_ERROR,
        `${BURST} in a minute: stopping so a fresh process can start.`,
      )
      exit(1)
    }
  }
  target.on('unhandledRejection', handle('unhandled rejection'))
  target.on('uncaughtException', handle('uncaught exception'))
}
