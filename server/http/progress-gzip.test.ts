// @vitest-environment node
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { progressStream } from './progress'
import { readProgressResponse } from '../../src/lib/progress'

it('streams progress then a gzip-compressed result the browser reader decodes', async () => {
  const big = {
    rows: Array.from({ length: 20000 }, (_, i) => ({ i, key: `DEMO-${i}` })),
  }
  const server = createServer((request, response) => {
    const stream = progressStream(response, request)
    stream.report({ step: 'items', label: 'Finding items' })
    stream.result(big)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const events: string[] = []
  const reply = await fetch(`http://127.0.0.1:${port}/`, {
    headers: { 'Accept-Encoding': 'gzip', Accept: 'application/x-ndjson' },
  })
  expect(reply.headers.get('content-encoding')).toBe('gzip')
  const read = await readProgressResponse<{ rows: unknown[] }>(
    reply,
    (event) => {
      events.push(event.step)
    },
  )
  server.close()
  expect(read.ok).toBe(true)
  expect(read.value.rows).toHaveLength(20000)
  expect(events).toEqual(['items'])
})
