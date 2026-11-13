// @vitest-environment node
import { gzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { cappedJson, cappedText, ResponseTooLargeError } from './capped-body'

const stream = (chunks: Uint8Array[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
  )

it('reads an answer under the limit, across chunks and multi-byte characters', async () => {
  const bytes = new TextEncoder().encode('{"name":"Überblick"}')
  const response = stream([bytes.slice(0, 10), bytes.slice(10)])
  expect(await cappedJson(response, 1024)).toEqual({ name: 'Überblick' })
})

it('stops reading at the limit instead of holding the whole answer', async () => {
  let sent = 0
  const endless = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1
        controller.enqueue(new Uint8Array(1024))
      },
    }),
  )
  await expect(cappedText(endless, 10 * 1024)).rejects.toBeInstanceOf(
    ResponseTooLargeError,
  )
  // It gave up just past the limit, not after reading on.
  expect(sent).toBeLessThan(20)
})

it('counts what a compressed answer expands to, not what was sent', async () => {
  const small = gzipSync(Buffer.alloc(5 * 1024 * 1024))
  expect(small.byteLength).toBeLessThan(10 * 1024)
  const expanded = new Response(
    new Response(small).body!.pipeThrough(new DecompressionStream('gzip')),
  )
  await expect(cappedText(expanded, 1024 * 1024)).rejects.toBeInstanceOf(
    ResponseTooLargeError,
  )
})
