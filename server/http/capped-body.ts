/*
 * Reads an answer from another service without trusting its size. Anyone can
 * point a connection at a server of their own; a body of several gigabytes
 * (cheap to send compressed) would otherwise be held in memory whole and
 * take the server down for everyone. Bytes are counted after decompression,
 * as they arrive, and reading stops at the limit.
 */
export class ResponseTooLargeError extends Error {
  constructor() {
    super('The answer was too large to read.')
    this.name = 'ResponseTooLargeError'
  }
}

interface ReadableAnswer {
  body?: ReadableStream<Uint8Array> | null
  text(): Promise<string>
}

/** A board page with full history is a few megabytes; this is far above it. */
export const BOARD_RESPONSE_BYTES = 32 * 1024 * 1024
/** An AI answer or a model list. */
export const AI_RESPONSE_BYTES = 8 * 1024 * 1024
/** An error body, read only for its reason. */
export const ERROR_RESPONSE_BYTES = 64 * 1024

export async function cappedText(
  response: ReadableAnswer,
  limit: number,
): Promise<string> {
  const reader = response.body?.getReader?.()
  if (!reader) {
    // A stand-in without a stream (tests): nothing arrives over a network.
    const text = await response.text()
    if (text.length > limit) throw new ResponseTooLargeError()
    return text
  }
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      throw new ResponseTooLargeError()
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

export async function cappedJson(
  response: ReadableAnswer,
  limit: number,
): Promise<unknown> {
  return JSON.parse(await cappedText(response, limit)) as unknown
}
