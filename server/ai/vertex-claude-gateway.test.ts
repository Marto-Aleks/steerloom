// @vitest-environment node
import { MockAgent } from 'undici'
import { describe, expect, it } from 'vitest'
import { AiClient } from './client'
import { normaliseEndpoint } from './config'
import { vertexClaudeAddress } from './gateway-detect'
import { streamingUrl } from './stream'
import { aiConfigFromKey, connectAiKey, readAiKeyInput } from './workspace-key'

const KEY = 'fictional-google-key'
const VERTEX =
  /^\/api\/google\/v1\/publishers\/anthropic\/models\/([^/:]+):(rawPredict|streamRawPredict)$/

const STREAM = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","model":"claude-sonnet-5-5","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Two items are stuck."}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n')

/**
 * A company gateway whose "google" route passes requests on to Vertex AI:
 * Claude answers at …/publishers/anthropic/models/<model>:rawPredict, with
 * the version in the body and no model there, as Vertex requires. A Claude
 * model asked for in Gemini's style is "not found", as on a real gateway.
 */
function vertexGateway() {
  const agent = new MockAgent()
  agent.disableNetConnect()
  const calls: Array<{
    path: string
    body: Record<string, unknown>
    headers: Record<string, string>
  }> = []
  agent
    .get('https://gateway.example.com')
    .intercept({ path: () => true, method: () => true })
    .reply(
      (
        options,
      ): {
        statusCode: number
        data: object | string
        responseOptions?: { headers: Record<string, string> }
      } => {
        const headers = Object.fromEntries(
          Object.entries(options.headers as Record<string, string>).map(
            ([name, value]) => [name.toLowerCase(), value],
          ),
        )
        const path = String(options.path)
        const body = options.body
          ? (JSON.parse(options.body as string) as Record<string, unknown>)
          : {}
        calls.push({ path, body, headers })
        if (headers['x-goog-api-key'] !== KEY)
          return {
            statusCode: 401,
            data: { error: { message: 'API key not valid.' } },
          }
        const vertex = VERTEX.exec(path)
        if (!vertex)
          return { statusCode: 404, data: { error: { message: 'Not found' } } }
        if (
          body.anthropic_version !== 'vertex-2023-10-16' ||
          'model' in body ||
          'anthropic-version' in headers
        )
          return {
            statusCode: 400,
            data: { error: { message: 'Invalid request for Vertex.' } },
          }
        if (vertex[2] === 'streamRawPredict')
          return {
            statusCode: 200,
            data: STREAM,
            responseOptions: {
              headers: { 'content-type': 'text/event-stream' },
            },
          }
        return {
          statusCode: 200,
          data: {
            id: 'm1',
            type: 'message',
            role: 'assistant',
            model: decodeURIComponent(vertex[1]!),
            content: [{ type: 'text', text: 'OK' }],
            stop_reason: 'end_turn',
          },
        }
      },
    )
    .persist()
  return { agent, calls }
}

const save = (endpoint: string, model: string, agent: MockAgent) =>
  connectAiKey(
    readAiKeyInput(
      { provider: 'custom', apiKey: KEY, endpoint, model },
      undefined,
      { requireModel: false },
    ),
    { dispatcher: agent },
  )

describe('Claude on Vertex AI behind a company gateway', () => {
  it('is found from the "google" route and a Claude model', async () => {
    const { agent, calls } = vertexGateway()
    const saved = await save(
      'https://gateway.example.com/api/google/v1',
      'claude-sonnet-5-5',
      agent,
    )
    expect(saved).toMatchObject({
      format: 'anthropic',
      keyHeader: 'x-goog-api-key',
      model: 'claude-sonnet-5-5',
      endpoint:
        'https://gateway.example.com/api/google/v1/publishers/anthropic/models/claude-sonnet-5-5:rawPredict',
    })
    // The Vertex address is the first try, not the last.
    expect(calls).toHaveLength(1)
    expect(calls[0]!.body).toMatchObject({
      anthropic_version: 'vertex-2023-10-16',
      system: 'Reply with OK.',
      messages: [{ role: 'user', content: 'Connection check.' }],
    })
  })

  it('streams answers from :streamRawPredict', async () => {
    const { agent, calls } = vertexGateway()
    const client = new AiClient({
      ...aiConfigFromKey({
        provider: 'custom',
        apiKey: KEY,
        model: 'claude-sonnet-5-5',
        endpoint:
          'https://gateway.example.com/api/google/v1/publishers/anthropic/models/claude-sonnet-5-5:rawPredict',
        format: 'anthropic',
        keyHeader: 'x-goog-api-key',
      }),
      dispatcher: agent,
    })
    const pieces: string[] = []
    const step = await client.agentStep(
      'You are helpful.',
      [{ role: 'user', content: 'What is stuck?' }],
      [],
      undefined,
      false,
      (text) => pieces.push(text),
    )
    expect(step.text).toBe('Two items are stuck.')
    expect(pieces.join('')).toBe('Two items are stuck.')
    expect(calls[0]!.path).toMatch(/:streamRawPredict$/)
    expect(calls[0]!.body.stream).toBe(true)
  })

  it('asks the model in the model field, whatever the saved address says', async () => {
    const { agent, calls } = vertexGateway()
    const client = new AiClient({
      ...aiConfigFromKey({
        provider: 'custom',
        apiKey: KEY,
        model: 'claude-opus-5-5',
        endpoint:
          'https://gateway.example.com/api/google/v1/publishers/anthropic/models/claude-sonnet-5-5:rawPredict',
        format: 'anthropic',
        keyHeader: 'x-goog-api-key',
      }),
      dispatcher: agent,
    })
    await expect(client.verify()).resolves.toEqual({
      model: 'claude-opus-5-5',
    })
    expect(calls[0]!.path).toContain('/models/claude-opus-5-5:rawPredict')
    // Vertex has no list of Claude models to read.
    await expect(client.listModels()).resolves.toEqual([])
  })

  it('builds the address only for Claude models, and keeps a full one', () => {
    const base = 'https://gateway.example.com/api/google/v1'
    expect(vertexClaudeAddress(base, 'gemini-2.5-pro')).toBeNull()
    expect(vertexClaudeAddress(base, '')).toBeNull()
    expect(vertexClaudeAddress(`${base}/`, 'claude-sonnet-4-5@20250929')).toBe(
      `${base}/publishers/anthropic/models/claude-sonnet-4-5%4020250929:rawPredict`,
    )
    // A base without a version gets Vertex's v1.
    expect(
      vertexClaudeAddress(
        'https://gateway.example.com/api/google',
        'claude-sonnet-5-5',
      ),
    ).toBe(`${base}/publishers/anthropic/models/claude-sonnet-5-5:rawPredict`)
    const full = `${base}/projects/demo/locations/europe-west1/publishers/anthropic/models/claude-sonnet-5-5:rawPredict`
    expect(vertexClaudeAddress(full, 'claude-sonnet-5-5')).toBe(full)
    expect(
      normaliseEndpoint(full.replace(':raw', ':streamRaw'), 'anthropic'),
    ).toBe(full)
    expect(streamingUrl(full, 'anthropic')).toMatch(/:streamRawPredict$/)
  })
})
