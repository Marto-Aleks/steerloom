// @vitest-environment node
import { MockAgent } from 'undici'
import { describe, expect, it } from 'vitest'
import { AiClient, extractAssistantContent, readModelList } from './client'
import { aiConfigFromKey, connectAiKey, readAiKeyInput } from './workspace-key'

/** A gateway whose "google" route speaks Gemini's own API. */
function geminiGateway() {
  const agent = new MockAgent()
  agent.disableNetConnect()
  const calls: Array<{
    path: string
    method: string
    body?: unknown
    key?: string
  }> = []
  agent
    .get('https://gateway.example.com')
    .intercept({ path: () => true, method: () => true })
    .reply((options): { statusCode: number; data: object } => {
      const headers = Object.fromEntries(
        Object.entries(options.headers as Record<string, string>).map(
          ([name, value]) => [name.toLowerCase(), value],
        ),
      )
      const path = String(options.path)
      const body: unknown = options.body
        ? JSON.parse(options.body as string)
        : undefined
      calls.push({
        path,
        method: options.method,
        body,
        key: headers['x-goog-api-key'],
      })
      if (headers['x-goog-api-key'] !== 'fictional-google-key')
        return {
          statusCode: 401,
          data: { error: { message: 'API key not valid.' } },
        }
      if (options.method === 'GET' && path.startsWith('/api/google/v1/models'))
        return {
          statusCode: 200,
          data: {
            models: [
              {
                name: 'models/gemini-2.5-pro',
                displayName: 'Gemini 2.5 Pro',
                supportedGenerationMethods: ['generateContent'],
              },
              {
                name: 'models/gemini-embedding-001',
                displayName: 'Embedding',
                supportedGenerationMethods: ['embedContent'],
              },
            ],
          },
        }
      if (
        options.method === 'POST' &&
        /^\/api\/google\/v1\/models\/[^/]+:generateContent$/.test(path)
      )
        return {
          statusCode: 200,
          data: {
            modelVersion: 'gemini-2.5-pro',
            candidates: [
              {
                content: { role: 'model', parts: [{ text: 'OK' }] },
                finishReason: 'STOP',
              },
            ],
          },
        }
      return { statusCode: 404, data: { error: { message: 'Not found' } } }
    })
    .persist()
  return { agent, calls }
}

describe('a company gateway speaking Gemini', () => {
  it('is found from a "google" route, with the key in x-goog-api-key and a model from the list', async () => {
    const { agent, calls } = geminiGateway()
    const saved = await connectAiKey(
      readAiKeyInput(
        {
          provider: 'custom',
          apiKey: 'fictional-google-key',
          endpoint: 'https://gateway.example.com/api/google/v1',
        },
        undefined,
        { requireModel: false },
      ),
      { dispatcher: agent },
    )
    expect(saved).toMatchObject({
      format: 'gemini',
      keyHeader: 'x-goog-api-key',
      model: 'gemini-2.5-pro',
      endpoint: 'https://gateway.example.com/api/google/v1',
    })
    const check = calls.find((call) => call.path.endsWith(':generateContent'))!
    expect(check.body).toMatchObject({
      system_instruction: { parts: [{ text: 'Reply with OK.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Connection check.' }] }],
      generationConfig: { maxOutputTokens: 256 },
    })
    // Never the OpenAI route's key header on a Gemini request.
    expect(check.key).toBe('fictional-google-key')
  })

  it('reads Gemini answers and model lists', () => {
    expect(
      extractAssistantContent({
        candidates: [
          { content: { parts: [{ text: 'Hello' }, { text: 'there' }] } },
        ],
      }),
    ).toBe('Hello\nthere')
    expect(
      readModelList({
        models: [
          {
            name: 'models/gemini-2.5-flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/gemini-embedding-001',
            supportedGenerationMethods: ['embedContent'],
          },
        ],
      }),
    ).toEqual([{ id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' }])
  })

  it('sends a saved Gemini key to the model in the path', () => {
    const config = aiConfigFromKey({
      provider: 'custom',
      apiKey: 'k',
      model: 'gemini-2.5-pro',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta',
      format: 'gemini',
      keyHeader: 'x-goog-api-key',
    })
    expect(config).toMatchObject({
      format: 'gemini',
      apiKeyHeader: 'x-goog-api-key',
      apiKeyPrefix: '',
    })
    expect(new AiClient(config)).toBeTruthy()
  })
})

describe('hints from a pasted example request', () => {
  it('are accepted when known, and make the save ask the gateway once', async () => {
    const { agent, calls } = geminiGateway()
    const secret = readAiKeyInput(
      {
        provider: 'custom',
        apiKey: 'fictional-google-key',
        endpoint:
          'https://gateway.example.com/api/google/v1/models/gemini-2.5-pro:generateContent',
        model: 'gemini-2.5-pro',
        format: 'gemini',
        keyHeader: 'X-Goog-Api-Key',
      },
      undefined,
      { requireModel: false },
    )
    expect(secret).toMatchObject({
      format: 'gemini',
      keyHeader: 'x-goog-api-key',
      endpoint: 'https://gateway.example.com/api/google/v1',
    })
    await connectAiKey(secret, { dispatcher: agent })
    expect(calls).toHaveLength(1)
  })

  it('ignore unknown values', () => {
    const secret = readAiKeyInput(
      {
        provider: 'custom',
        apiKey: 'k-123456',
        endpoint: 'https://ai.example.com/v1',
        format: 'bedrock',
        keyHeader: 'x-secret',
      },
      undefined,
      { requireModel: false },
    )
    expect(secret.format).toBeUndefined()
    expect(secret.keyHeader).toBeUndefined()
    expect(secret.endpoint).toBe('https://ai.example.com/v1/chat/completions')
  })
})
