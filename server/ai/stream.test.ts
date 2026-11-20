// @vitest-environment node
import { MockAgent } from 'undici'
import { afterEach, expect, it } from 'vitest'
import { readProgressResponse } from '../../src/lib/progress'
import {
  AiClient,
  learnedStyles,
  nonStreamingEndpoints,
  readAgentStep,
  readUsage,
} from './client'
import { readStreamedPayload, streamingBody } from './stream'
import { aiConfigFromKey } from './workspace-key'

/*
 * Streaming: each provider's pieces come back together as the answer it
 * would have sent in one go, the text is passed on as it arrives, and a
 * provider that refuses to stream gets the same request without it.
 */

afterEach(() => {
  nonStreamingEndpoints.clear()
  learnedStyles.clear()
})

const sse = (events: unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') +
      'data: [DONE]\n\n',
  ).body!

it('puts an OpenAI stream back together: text and a tool call', async () => {
  const pieces: string[] = []
  const payload = await readStreamedPayload(
    sse([
      { choices: [{ delta: { content: 'Let me ' } }] },
      { choices: [{ delta: { content: 'check.' } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'get_items', arguments: '{"keys":' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '["FICT-1"]}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    ]),
    'openai',
    (text) => pieces.push(text),
  )
  expect(pieces).toEqual(['Let me ', 'check.'])
  expect(readAgentStep(payload, 'openai')).toMatchObject({
    text: 'Let me check.',
    toolCalls: [
      { id: 'call_1', name: 'get_items', args: { keys: ['FICT-1'] } },
    ],
  })
})

it('puts an Anthropic stream back together, with the stop reason', async () => {
  const pieces: string[] = []
  const payload = await readStreamedPayload(
    sse([
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '{"verdict":' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '"Late."}' },
      },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'get_code' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"keys":["FICT-2"]}',
        },
      },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
    ]),
    'anthropic',
    (text) => pieces.push(text),
  )
  expect(pieces.join('')).toBe('{"verdict":"Late."}')
  expect(payload).toMatchObject({ stop_reason: 'max_tokens' })
  expect(readAgentStep(payload, 'anthropic')).toMatchObject({
    text: '{"verdict":"Late."}',
    toolCalls: [{ id: 'tu_1', name: 'get_code', args: { keys: ['FICT-2'] } }],
  })
})

it('keeps Anthropic thinking blocks whole, so the next tool turn can replay them', async () => {
  const payload = await readStreamedPayload(
    sse([
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig-part-1' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: '-part-2' },
      },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'get_items' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    ]),
    'anthropic',
    () => {},
  )
  const step = readAgentStep(payload, 'anthropic')
  expect(step.raw).toEqual([
    { type: 'thinking', thinking: '', signature: 'sig-part-1-part-2' },
    { type: 'tool_use', id: 'tu_1', name: 'get_items', input: {} },
  ])
})

it('puts a Gemini stream back together, leaving thoughts out', async () => {
  const pieces: string[] = []
  const payload = await readStreamedPayload(
    sse([
      {
        candidates: [
          { content: { parts: [{ text: 'thinking', thought: true }] } },
        ],
      },
      { candidates: [{ content: { parts: [{ text: 'FICT-3 waits ' }] } }] },
      {
        candidates: [
          {
            content: { parts: [{ text: 'on design.' }] },
            finishReason: 'STOP',
          },
        ],
      },
    ]),
    'gemini',
    (text) => pieces.push(text),
  )
  expect(pieces).toEqual(['FICT-3 waits ', 'on design.'])
  expect(readAgentStep(payload, 'gemini').text).toBe('FICT-3 waits on design.')
})

function openAi(
  reply: (body: Record<string, unknown>) => {
    statusCode: number
    data: string
    responseOptions?: { headers: Record<string, string> }
  },
) {
  const agent = new MockAgent()
  agent.disableNetConnect()
  const bodies: Array<Record<string, unknown>> = []
  agent
    .get('https://api.openai.com')
    .intercept({ path: '/v1/chat/completions', method: 'POST' })
    .reply((options) => {
      const body = JSON.parse(options.body as string) as Record<string, unknown>
      bodies.push(body)
      return reply(body)
    })
    .persist()
  const client = new AiClient(
    aiConfigFromKey(
      {
        provider: 'openai',
        apiKey: 'fictional-key-123',
        model: 'fictional-model',
      },
      { dispatcher: agent },
    ),
  )
  return { client, bodies }
}

const answer = JSON.stringify({
  choices: [
    {
      message: { role: 'assistant', content: 'FICT-4 is blocked.' },
      finish_reason: 'stop',
    },
  ],
})

it('streams when the provider allows it', async () => {
  const { client, bodies } = openAi(() => ({
    statusCode: 200,
    data:
      'data: {"choices":[{"delta":{"content":"FICT-4 is "}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"blocked."},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n',
    responseOptions: { headers: { 'content-type': 'text/event-stream' } },
  }))
  const pieces: string[] = []
  const step = await client.agentStep(
    'system',
    [{ role: 'user', content: 'Why?' }],
    [],
    undefined,
    false,
    (text) => pieces.push(text),
  )
  expect(bodies[0]?.stream).toBe(true)
  expect(pieces).toEqual(['FICT-4 is ', 'blocked.'])
  expect(step.text).toBe('FICT-4 is blocked.')
})

it('asks again without streaming when it is refused, and remembers', async () => {
  const { client, bodies } = openAi((body) =>
    body.stream
      ? {
          statusCode: 400,
          data: JSON.stringify({
            error: {
              message:
                'Your organization must be verified to stream this model.',
            },
          }),
        }
      : {
          statusCode: 200,
          data: answer,
          responseOptions: { headers: { 'content-type': 'application/json' } },
        },
  )
  const pieces: string[] = []
  const step = await client.agentStep(
    'system',
    [{ role: 'user', content: 'Why?' }],
    [],
    undefined,
    false,
    (text) => pieces.push(text),
  )
  expect(step.text).toBe('FICT-4 is blocked.')
  expect(bodies.map((body) => Boolean(body.stream))).toEqual([true, false])
  // The next question goes straight to the answer in one piece.
  await client.agentStep(
    'system',
    [{ role: 'user', content: 'Why?' }],
    [],
    undefined,
    false,
    (text) => pieces.push(text),
  )
  expect(bodies.map((body) => Boolean(body.stream))).toEqual([
    true,
    false,
    false,
  ])
  expect(pieces).toEqual([])
})

it('reads text pieces from the progress stream as they arrive', async () => {
  const lines = [
    { type: 'progress', step: 'plan', label: 'Thinking' },
    { type: 'text', text: '{"verdict":"Late' },
    { type: 'text', text: '."}' },
    { type: 'result', value: { message: 'done' } },
  ]
  const response = new Response(
    lines.map((line) => JSON.stringify(line)).join('\n'),
    {
      headers: { 'content-type': 'application/x-ndjson' },
    },
  )
  const pieces: string[] = []
  const read = await readProgressResponse(response, undefined, (text) =>
    pieces.push(text),
  )
  expect(pieces.join('')).toBe('{"verdict":"Late."}')
  expect(read).toEqual({ ok: true, status: 200, value: { message: 'done' } })
})

it('keeps the token counts a stream reports, for each provider', async () => {
  const anthropic = await readStreamedPayload(
    sse([
      {
        type: 'message_start',
        message: {
          usage: { input_tokens: 120, cache_read_input_tokens: 6_000 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Done.' },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 90 },
      },
    ]),
    'anthropic',
    () => undefined,
  )
  expect(readUsage(anthropic)).toEqual({
    inputTokens: 6_120,
    cachedTokens: 6_000,
    cacheWriteTokens: 0,
    outputTokens: 90,
  })

  // OpenAI ends with a piece that has the counts and no answer.
  const openai = await readStreamedPayload(
    sse([
      { choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 7_000, completion_tokens: 300 } },
    ]),
    'openai',
    () => undefined,
  )
  expect(readUsage(openai)).toMatchObject({
    inputTokens: 7_000,
    outputTokens: 300,
  })
  expect(readAgentStep(openai, 'openai').text).toBe('Done.')

  const gemini = await readStreamedPayload(
    sse([
      {
        candidates: [{ content: { parts: [{ text: 'Done.' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
      },
      {
        candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 5_000, candidatesTokenCount: 200 },
      },
    ]),
    'gemini',
    () => undefined,
  )
  expect(readUsage(gemini)).toMatchObject({
    inputTokens: 5_000,
    outputTokens: 200,
  })
})

it('asks only OpenAI itself to add token counts to a stream', () => {
  const body = JSON.stringify({ model: 'fictional-model', messages: [] })
  expect(JSON.parse(streamingBody(body, 'openai', true))).toMatchObject({
    stream: true,
    stream_options: { include_usage: true },
  })
  // A company gateway may not know the option.
  expect(JSON.parse(streamingBody(body, 'openai'))).not.toHaveProperty(
    'stream_options',
  )
  expect(JSON.parse(streamingBody(body, 'anthropic', true))).not.toHaveProperty(
    'stream_options',
  )
})

it('corrects a refused parameter without giving up streaming', async () => {
  const { client, bodies } = openAi((body) =>
    'tool_choice' in body
      ? {
          statusCode: 400,
          data: JSON.stringify({
            error: { message: 'Unsupported parameter: tool_choice.' },
          }),
        }
      : {
          statusCode: 200,
          data:
            'data: {"choices":[{"delta":{"content":"FICT-4 is blocked."},"finish_reason":"stop"}]}\n\n' +
            'data: [DONE]\n\n',
          responseOptions: { headers: { 'content-type': 'text/event-stream' } },
        },
  )
  const pieces: string[] = []
  const step = await client.agentStep(
    'system',
    [{ role: 'user', content: 'Why?' }],
    [],
    undefined,
    false,
    (text) => pieces.push(text),
  )
  expect(step.text).toBe('FICT-4 is blocked.')
  // Both requests streamed: the parameter was the problem, not streaming.
  expect(bodies.map((body) => Boolean(body.stream))).toEqual([true, true])
  expect(pieces).toEqual(['FICT-4 is blocked.'])
  expect(nonStreamingEndpoints.size).toBe(0)
})
