import type { AiServerConfig } from './config'

/*
 * Streaming answers: the provider sends its answer in pieces as server-sent
 * events. Each piece of text goes to `onText` as it arrives, and the pieces
 * are put back together into the same payload the provider returns without
 * streaming, so everything that reads a payload stays as it is.
 */

type Format = AiServerConfig['format']

/** The request body with streaming switched on, in the provider's terms. */
export function streamingBody(body: string, format: Format): string {
  if (format === 'gemini') return body // Gemini streams by address instead.
  const parsed = JSON.parse(body) as Record<string, unknown>
  return JSON.stringify({ ...parsed, stream: true })
}

/** Gemini's streaming address for a generateContent address. */
export function streamingUrl(url: string, format: Format): string {
  return format === 'gemini'
    ? `${url.replace(/:generateContent$/, ':streamGenerateContent')}${url.includes('?') ? '&' : '?'}alt=sse`
    : url
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every `data:` payload in a server-sent event stream, as it arrives. */
async function* events(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
    // Events end with a blank line; "\r\n" from some gateways too.
    buffer = buffer.replace(/\r\n/g, '\n')
    let end = buffer.indexOf('\n\n')
    while (end >= 0) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data && data !== '[DONE]') {
        try {
          yield JSON.parse(data) as unknown
        } catch {
          // A keep-alive or a line we do not read.
        }
      }
      end = buffer.indexOf('\n\n')
    }
    if (done) break
  }
}

/**
 * Reads a streamed answer to the end, passing text on as it arrives, and
 * returns it in the provider's non-streaming shape.
 */
export async function readStreamedPayload(
  body: ReadableStream<Uint8Array>,
  format: Format,
  onText: (text: string) => void,
): Promise<unknown> {
  if (format === 'anthropic') {
    const blocks: Array<Record<string, unknown>> = []
    const inputs: string[] = []
    let stopReason: unknown
    for await (const event of events(body)) {
      if (!isRecord(event)) continue
      const index = typeof event.index === 'number' ? event.index : 0
      if (
        event.type === 'content_block_start' &&
        isRecord(event.content_block)
      ) {
        blocks[index] = { ...event.content_block }
        inputs[index] = ''
      } else if (
        event.type === 'content_block_delta' &&
        isRecord(event.delta)
      ) {
        const block = (blocks[index] ??= { type: 'text', text: '' })
        if (
          event.delta.type === 'text_delta' &&
          typeof event.delta.text === 'string'
        ) {
          block.text = `${typeof block.text === 'string' ? block.text : ''}${event.delta.text}`
          onText(event.delta.text)
        } else if (
          event.delta.type === 'input_json_delta' &&
          typeof event.delta.partial_json === 'string'
        )
          inputs[index] = `${inputs[index] ?? ''}${event.delta.partial_json}`
        // Thinking blocks go back to the API unchanged on the next tool
        // turn, so their text and signature must be kept whole.
        else if (
          event.delta.type === 'thinking_delta' &&
          typeof event.delta.thinking === 'string'
        )
          block.thinking = `${typeof block.thinking === 'string' ? block.thinking : ''}${event.delta.thinking}`
        else if (
          event.delta.type === 'signature_delta' &&
          typeof event.delta.signature === 'string'
        )
          block.signature = `${typeof block.signature === 'string' ? block.signature : ''}${event.delta.signature}`
      } else if (event.type === 'message_delta' && isRecord(event.delta))
        stopReason = event.delta.stop_reason
    }
    blocks.forEach((block, index) => {
      if (block.type !== 'tool_use') return
      try {
        block.input = inputs[index]
          ? (JSON.parse(inputs[index]) as unknown)
          : {}
      } catch {
        block.input = {}
      }
    })
    return { content: blocks.filter(Boolean), stop_reason: stopReason }
  }

  if (format === 'gemini') {
    const parts: Array<Record<string, unknown>> = []
    let finishReason: unknown
    for await (const event of events(body)) {
      const candidate =
        isRecord(event) && Array.isArray(event.candidates)
          ? (event.candidates[0] as unknown)
          : undefined
      if (!isRecord(candidate)) continue
      if (candidate.finishReason) finishReason = candidate.finishReason
      const content = candidate.content
      if (!isRecord(content) || !Array.isArray(content.parts)) continue
      for (const part of content.parts) {
        if (!isRecord(part)) continue
        const last = parts.at(-1)
        if (typeof part.text === 'string' && !part.thought) {
          onText(part.text)
          // Text pieces join one text part, as the full answer has it.
          if (last && typeof last.text === 'string' && !last.thought)
            last.text = `${last.text}${part.text}`
          else parts.push({ ...part })
        } else parts.push({ ...part })
      }
    }
    return {
      candidates: [{ content: { role: 'model', parts }, finishReason }],
    }
  }

  // OpenAI and compatible gateways.
  let content = ''
  let finishReason: unknown
  const calls: Array<{ id?: string; name: string; args: string }> = []
  for await (const event of events(body)) {
    const choice =
      isRecord(event) && Array.isArray(event.choices)
        ? (event.choices[0] as unknown)
        : undefined
    if (!isRecord(choice)) continue
    if (choice.finish_reason) finishReason = choice.finish_reason
    const delta = choice.delta
    if (!isRecord(delta)) continue
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content
      onText(delta.content)
    }
    if (Array.isArray(delta.tool_calls))
      for (const piece of delta.tool_calls) {
        if (!isRecord(piece)) continue
        const index =
          typeof piece.index === 'number' ? piece.index : calls.length
        const call = (calls[index] ??= { name: '', args: '' })
        if (typeof piece.id === 'string') call.id = piece.id
        const fn = piece.function
        if (isRecord(fn)) {
          if (typeof fn.name === 'string') call.name += fn.name
          if (typeof fn.arguments === 'string') call.args += fn.arguments
        }
      }
  }
  return {
    choices: [
      {
        finish_reason: finishReason,
        message: {
          role: 'assistant',
          content: content || null,
          ...(calls.length
            ? {
                tool_calls: calls.filter(Boolean).map((call, index) => ({
                  id: call.id ?? `call-${index}`,
                  type: 'function',
                  function: { name: call.name, arguments: call.args || '{}' },
                })),
              }
            : {}),
        },
      },
    ],
  }
}
