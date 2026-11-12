// @vitest-environment node
import { MockAgent } from 'undici'
import { describe, expect, it } from 'vitest'
import { connectAiKey, readAiKeyInput } from './workspace-key'

/*
 * A stand-in for a company model farm in front of Vertex AI and Azure AI
 * Foundry: custom route prefixes, the model list blocked, an Azure-style route that takes an api-key header and a
 * deployment in the path, and an OpenAI-style route that takes a Bearer
 * key and a provider-prefixed model name.
 */
const HOST = 'https://farm.example.com'
const AZURE = '/api/providers/gcp/azure/openai'
const OPENAI = '/api/providers/gcp/openai/v1'
const key = 'fictional-farm-key'

function farm() {
  const agent = new MockAgent()
  agent.disableNetConnect()
  const calls: string[] = []
  agent
    .get(HOST)
    .intercept({ path: () => true, method: () => true })
    .reply((options): { statusCode: number; data: object } => {
      const headers = Object.fromEntries(
        Object.entries(options.headers as Record<string, string>).map(
          ([name, value]) => [name.toLowerCase(), value],
        ),
      )
      const url = new URL(String(options.path), HOST)
      calls.push(`${options.method} ${url.pathname}${url.search}`)
      // Discovery is blocked on this gateway.
      if (options.method === 'GET')
        return { statusCode: 403, data: { error: { message: 'Forbidden' } } }
      const body = JSON.parse(options.body as string) as { model?: string }
      const ok = {
        statusCode: 200,
        data: {
          model: body.model ?? 'claude-sonnet-5-5',
          choices: [{ message: { role: 'assistant', content: 'OK' } }],
        },
      }
      const azure = new RegExp(
        `^${AZURE}/deployments/claude-sonnet-5-5/chat/completions$`,
      )
      if (azure.test(url.pathname)) {
        if (headers['api-key'] !== key)
          return {
            statusCode: 401,
            data: { error: { message: 'Unauthorized' } },
          }
        if (!url.searchParams.get('api-version'))
          return {
            statusCode: 404,
            data: { error: { message: 'Resource not found' } },
          }
        return ok
      }
      if (url.pathname === `${OPENAI}/chat/completions`) {
        if (headers.authorization !== `Bearer ${key}`)
          return {
            statusCode: 401,
            data: { error: { message: 'Unauthorized' } },
          }
        if (body.model !== 'anthropic/claude-sonnet-5-5')
          return {
            statusCode: 400,
            data: {
              error: { message: `Unknown model: ${body.model ?? '(none)'}` },
            },
          }
        return ok
      }
      return { statusCode: 404, data: { error: { message: 'Not found' } } }
    })
    .persist()
  return { agent, calls }
}

const save = (endpoint: string, model: string, agent: MockAgent) =>
  connectAiKey(
    readAiKeyInput(
      { provider: 'custom', apiKey: key, endpoint, model },
      undefined,
      { requireModel: false },
    ),
    { dispatcher: agent },
  )

describe('a model farm with custom route prefixes', () => {
  it('takes the full Azure-style deployment address', async () => {
    const { agent } = farm()
    const saved = await save(
      `${HOST}${AZURE}/deployments/claude-sonnet-5-5/chat/completions?api-version=2024-02-15-preview`,
      '',
      agent,
    )
    expect(saved).toMatchObject({
      model: 'claude-sonnet-5-5',
      keyHeader: 'api-key',
    })
    expect(saved.endpoint).toContain('api-version=2024-02-15-preview')
  })

  it('takes the OpenAI-style route with a provider-prefixed model', async () => {
    const { agent } = farm()
    const saved = await save(
      `${HOST}${OPENAI}/chat/completions`,
      'anthropic/claude-sonnet-5-5',
      agent,
    )
    expect(saved).toMatchObject({
      model: 'anthropic/claude-sonnet-5-5',
      keyHeader: 'authorization',
    })
  })

  it('takes the Azure-style base address plus a model name', async () => {
    const { agent } = farm()
    const saved = await save(`${HOST}${AZURE}`, 'claude-sonnet-5-5', agent)
    expect(saved.endpoint).toBe(
      `${HOST}${AZURE}/deployments/claude-sonnet-5-5/chat/completions?api-version=2025-04-01-preview`,
    )
    expect(saved.keyHeader).toBe('api-key')
  })

  it('does not mistake a blocked model list for a refused key', async () => {
    const { agent } = farm()
    await expect(save(`${HOST}${OPENAI}`, '', agent)).rejects.toThrow(/model/i)
    await expect(save(`${HOST}${OPENAI}`, '', agent)).rejects.not.toThrow(
      /did not accept this key/,
    )
  })
})
