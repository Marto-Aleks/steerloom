/**
 * Live progress for long operations (board loading, AI answers). The server
 * streams newline-delimited JSON when the request accepts
 * `application/x-ndjson`: any number of progress events, then one result or
 * error. Older servers answer with plain JSON, which callers still accept.
 */
export interface ProgressEvent {
  type: 'progress'
  /** Stable id of the current step, e.g. "history". */
  step: string
  /** What is happening, in plain words: "Reading status history". */
  label: string
  /** Optional detail: "120 of 340 items". */
  detail?: string
  done?: number
  total?: number
}

export type ProgressMessage<T> =
  | ProgressEvent
  | { type: 'text'; text: string }
  | { type: 'result'; value: T }
  | { type: 'error'; error: string; status?: number; reason?: string }

export const PROGRESS_CONTENT_TYPE = 'application/x-ndjson'

export type ProgressListener = (event: ProgressEvent) => void

/** Pieces of an answer as it is written. */
export type TextListener = (text: string) => void

/** Validates one streamed progress event; ignores anything malformed. */
export function readProgressEvent(value: unknown): ProgressEvent | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (
    item.type !== 'progress' ||
    typeof item.step !== 'string' ||
    typeof item.label !== 'string' ||
    item.step.length > 40 ||
    item.label.length > 160
  )
    return null
  const count = (input: unknown) =>
    typeof input === 'number' && Number.isInteger(input) && input >= 0
      ? input
      : undefined
  const done = count(item.done)
  const total = count(item.total)
  return {
    type: 'progress',
    step: item.step,
    label: item.label,
    ...(typeof item.detail === 'string' && item.detail.length <= 160
      ? { detail: item.detail }
      : {}),
    ...(done !== undefined ? { done } : {}),
    ...(total !== undefined ? { total } : {}),
  }
}

/**
 * What to tell people when the answer is not JSON at all, typically a proxy's
 * HTML error page (Cloudflare sends 524 after 100 seconds without an answer).
 */
export function unreadableResponseMessage(status: number): string {
  if (status === 524 || status === 504 || status === 408)
    return 'The server took too long to answer. Large boards can take a while: try again, or choose a board with fewer items.'
  if (status === 502 || status === 503)
    return 'Steerloom is restarting or briefly unavailable. Try again in a minute.'
  return 'The server sent an answer Steerloom could not read. Refresh the page and try again.'
}

/** Parses a JSON body, turning an HTML error page into a readable error. */
export async function readJsonBody<T>(response: Response): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(unreadableResponseMessage(response.status))
  }
}

/**
 * Reads a fetch response that is either plain JSON or an NDJSON progress
 * stream. Progress goes to `onProgress`; the result is returned; an error
 * line throws with the server's message.
 */
export async function readProgressResponse<T>(
  response: Response,
  onProgress?: ProgressListener,
  onText?: TextListener,
): Promise<{ ok: boolean; status: number; value: T }> {
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes(PROGRESS_CONTENT_TYPE) || !response.body) {
    const value = await readJsonBody<T>(response)
    return { ok: response.ok, status: response.status, value }
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let outcome: { ok: boolean; status: number; value: T } | null = null
  const handle = (line: string) => {
    if (!line.trim()) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }
    const item = parsed as ProgressMessage<T>
    if (item.type === 'result')
      outcome = { ok: true, status: 200, value: item.value }
    else if (item.type === 'error')
      outcome = {
        ok: false,
        status: item.status ?? 500,
        value: {
          error: item.error,
          ...(item.reason ? { reason: item.reason } : {}),
        } as T,
      }
    else if (item.type === 'text') {
      if (typeof item.text === 'string') onText?.(item.text)
    } else {
      const event = readProgressEvent(parsed)
      if (event) onProgress?.(event)
    }
  }
  // The final line is the whole payload, so scan only the new bytes for a
  // newline instead of the growing buffer each time.
  let scanned = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n', scanned)
    while (newline >= 0) {
      handle(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
    scanned = buffer.length
  }
  handle(buffer + decoder.decode())
  if (!outcome)
    return {
      ok: false,
      status: 502,
      value: { error: 'The connection closed before the answer arrived.' } as T,
    }
  return outcome
}
