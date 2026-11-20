// @vitest-environment node
import type { ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { readProgressResponse } from '../../src/lib/progress'
import { KEEP_ALIVE_MS, progressStream } from './progress'

afterEach(() => vi.useRealTimers())

/** A response that keeps what was written to it. */
function recorder() {
  const lines: string[] = []
  const response = {
    statusCode: 0,
    writableEnded: false,
    on: () => response,
    setHeader: () => response,
    write: (line: string) => lines.push(line),
    end: () => {
      response.writableEnded = true
    },
  }
  return { lines, response: response as unknown as ServerResponse }
}

it('bridges a silent stretch with keep-alive lines, and stops at the result', async () => {
  vi.useFakeTimers()
  const { lines, response } = recorder()
  const stream = progressStream(response)
  stream.report({ step: 'plan', label: 'Thinking' })
  // A model thinking for over a minute: nothing to report, yet not silent.
  vi.advanceTimersByTime(KEEP_ALIVE_MS * 3 + 10)
  expect(
    lines.map((line) => (JSON.parse(line) as { type: string }).type),
  ).toEqual(['progress', 'ping', 'ping', 'ping'])
  // Anything written starts the wait again.
  vi.advanceTimersByTime(KEEP_ALIVE_MS - 1_000)
  stream.text('It waits')
  vi.advanceTimersByTime(KEEP_ALIVE_MS - 1_000)
  expect(lines).toHaveLength(5)

  stream.result({ message: 'It waits for design.' })
  vi.advanceTimersByTime(KEEP_ALIVE_MS * 4)
  expect(lines).toHaveLength(6)
  vi.useRealTimers()

  // The browser's reader passes over the keep-alive lines.
  const steps: string[] = []
  const read = await readProgressResponse<{ message: string }>(
    new Response(lines.join(''), {
      headers: { 'Content-Type': 'application/x-ndjson' },
    }),
    (event) => steps.push(event.step),
  )
  expect(steps).toEqual(['plan'])
  expect(read.value.message).toBe('It waits for design.')
})

it('sends nothing before the first line or after a failure', () => {
  vi.useFakeTimers()
  const { lines, response } = recorder()
  const stream = progressStream(response)
  vi.advanceTimersByTime(KEEP_ALIVE_MS * 2)
  expect(lines).toEqual([])
  stream.fail('The AI request failed.', 502)
  vi.advanceTimersByTime(KEEP_ALIVE_MS * 2)
  expect(lines).toHaveLength(1)
})
