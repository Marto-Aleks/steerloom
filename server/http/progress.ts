import type { IncomingMessage, ServerResponse } from 'node:http'
import { constants, createGzip } from 'node:zlib'
import {
  PROGRESS_CONTENT_TYPE,
  type ProgressEvent,
} from '../../src/lib/progress'

export type ProgressReporter = (event: Omit<ProgressEvent, 'type'>) => void

/**
 * The machine-readable reason a thrown error carries, when it is one the
 * connect form can act on (gateway key, rejected token, unreachable host).
 */
export function clientReason(caught: unknown): string | undefined {
  const reason = (caught as { reason?: unknown } | null)?.reason
  return typeof reason === 'string' && /^[a-z-]{3,40}$/.test(reason)
    ? reason
    : undefined
}

/** Whether the client asked for a live progress stream. */
export function wantsProgress(request: IncomingMessage): boolean {
  return (request.headers.accept ?? '').includes(PROGRESS_CONTENT_TYPE)
}

/**
 * Streams progress lines, then exactly one result or error line. Headers go
 * out with the first event; `no-transform` keeps proxies from buffering for
 * compression.
 */
export function progressStream(
  response: ServerResponse,
  request?: IncomingMessage,
) {
  let started = false
  let ended = false
  // The result line is the whole board: several MB of JSON that shrinks
  // about tenfold. Compress here, flushing per line so progress still shows.
  const gzip = (request?.headers['accept-encoding'] ?? '').includes('gzip')
    ? createGzip({ flush: constants.Z_SYNC_FLUSH })
    : null
  const start = () => {
    if (started) return
    started = true
    response.statusCode = 200
    response.setHeader(
      'Content-Type',
      `${PROGRESS_CONTENT_TYPE}; charset=utf-8`,
    )
    response.setHeader('Cache-Control', 'no-store, no-transform')
    response.setHeader('X-Accel-Buffering', 'no')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (gzip) {
      response.setHeader('Content-Encoding', 'gzip')
      response.setHeader('Vary', 'Accept-Encoding')
      gzip.pipe(response)
    }
  }
  const write = (value: unknown) => {
    if (ended || response.writableEnded) return
    start()
    const line = `${JSON.stringify(value)}\n`
    if (gzip) {
      gzip.write(line)
      gzip.flush()
    } else response.write(line)
  }
  const end = () => {
    if (ended) return
    ended = true
    if (gzip) gzip.end()
    else response.end()
  }
  return {
    report: ((event) =>
      write({ type: 'progress', ...event })) as ProgressReporter,
    /** A piece of the answer as the AI writes it. */
    text(text: string) {
      if (text) write({ type: 'text', text })
    },
    result(value: unknown) {
      write({ type: 'result', value })
      end()
    },
    fail(error: string, status = 400, reason?: string) {
      write({ type: 'error', error, status, ...(reason ? { reason } : {}) })
      end()
    },
  }
}
