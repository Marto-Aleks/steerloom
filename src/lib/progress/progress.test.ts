import { describe, expect, it } from 'vitest'
import { PROGRESS_CONTENT_TYPE, readJsonBody, readProgressResponse } from '.'
import type { ProgressEvent } from '.'

function streamed(chunks: string[]) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': `${PROGRESS_CONTENT_TYPE}; charset=utf-8` } },
  )
}

describe('readProgressResponse', () => {
  it('reads events and the result when lines are split across chunks', async () => {
    const events: ProgressEvent[] = []
    const lines = [
      {
        type: 'progress',
        step: 'items',
        label: 'Finding items',
        detail: '12 found',
      },
      {
        type: 'progress',
        step: 'history',
        label: 'Reading',
        done: 6,
        total: 12,
      },
      { type: 'result', value: { payload: { board: 'Fictional' } } },
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join('')
    const chunks = [lines.slice(0, 17), lines.slice(17, 90), lines.slice(90)]
    const read = await readProgressResponse(streamed(chunks), (event) =>
      events.push(event),
    )
    expect(events).toEqual([
      {
        type: 'progress',
        step: 'items',
        label: 'Finding items',
        detail: '12 found',
      },
      {
        type: 'progress',
        step: 'history',
        label: 'Reading',
        done: 6,
        total: 12,
      },
    ])
    expect(read).toEqual({
      ok: true,
      status: 200,
      value: { payload: { board: 'Fictional' } },
    })
  })

  it('returns the server error from an error line as not ok', async () => {
    const read = await readProgressResponse(
      streamed([
        '{"type":"progress","step":"board","label":"Reading board settings"}\n',
        '{"type":"error","error":"Fictional board is unavailable.","status":400}\n',
      ]),
    )
    expect(read).toEqual({
      ok: false,
      status: 400,
      value: { error: 'Fictional board is unavailable.' },
    })
  })

  it('reports a stream that ends without an answer', async () => {
    const read = await readProgressResponse(
      streamed(['{"type":"progress","step":"board","label":"Reading"}\n']),
    )
    expect(read.ok).toBe(false)
    expect(read.status).toBe(502)
  })

  it('falls back to plain JSON from servers that do not stream', async () => {
    const events: ProgressEvent[] = []
    const read = await readProgressResponse(
      Response.json({ error: 'Sign in to your workspace.' }, { status: 401 }),
      (event) => events.push(event),
    )
    expect(events).toEqual([])
    expect(read).toEqual({
      ok: false,
      status: 401,
      value: { error: 'Sign in to your workspace.' },
    })
  })
})

describe('readJsonBody', () => {
  it('turns a proxy timeout page into a readable message', async () => {
    const page = new Response('<!DOCTYPE html><html>timeout</html>', {
      status: 524,
      headers: { 'Content-Type': 'text/html' },
    })
    await expect(readJsonBody(page)).rejects.toThrow(/took too long/)
  })

  it('reads ordinary JSON', async () => {
    await expect(readJsonBody(Response.json({ ok: true }))).resolves.toEqual({
      ok: true,
    })
  })
})
