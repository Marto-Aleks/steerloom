// @vitest-environment node
import { MockAgent } from 'undici'
import { describe, expect, it } from 'vitest'
import {
  AZURE_API_VERSION,
  connectAiKey,
  readAiKeyInput,
} from './workspace-key'

/*
 * Stand-ins for the company gateways Steerloom meets: each accepts the key in
 * one place and one address shape, and answers like the real thing otherwise.
 */
type Headers = Record<string, string | undefined>
interface Gateway {
  key: string
  header:
    | 'authorization'
    | 'api-key'
    | 'x-api-key'
    | 'ocp-apim-subscription-key'
  path: RegExp
  needsVersion?: boolean
  anthropic?: boolean
}

function standIn(gateway: Gateway) {
  const agent = new MockAgent()
  agent.disableNetConnect()
  const calls: string[] = []
  agent
    .get('https://gateway.example.com')
    .intercept({ path: () => true, method: () => true })
    .reply((options): { statusCode: number; data: object } => {
      // Header names arrive as sent; servers compare them case-insensitively.
      const headers: Headers = Object.fromEntries(
        Object.entries(options.headers as Headers).map(([name, value]) => [
          name.toLowerCase(),
          value,
        ]),
      )
      const path = String(options.path)
      calls.push(`${options.method} ${path}`)
      const sent =
        gateway.header === 'authorization'
          ? headers.authorization === `Bearer ${gateway.key}`
          : headers[gateway.header] === gateway.key
      if (!sent)
        return {
          statusCode: 401,
          data: { error: { message: 'Access denied due to missing key.' } },
        }
      if (options.method === 'GET')
        return { statusCode: 404, data: { error: { message: 'Not found' } } }
      if (!gateway.path.test(path.split('?')[0]!))
        return {
          statusCode: 404,
          data: { error: { message: 'Resource not found' } },
        }
      if (gateway.needsVersion && !path.includes('api-version='))
        return {
          statusCode: 404,
          data: { error: { message: 'Resource not found' } },
        }
      return {
        statusCode: 200,
        data: gateway.anthropic
          ? { model: 'claude-sonnet', content: [{ type: 'text', text: 'OK' }] }
          : {
              model: 'gpt-company',
              choices: [{ message: { role: 'assistant', content: 'OK' } }],
            },
      }
    })
    .persist()
  return { agent, calls }
}

const key = 'fictional-company-key'
const save = (endpoint: string, agent: MockAgent) =>
  connectAiKey(
    readAiKeyInput({ provider: 'custom', apiKey: key, endpoint }, undefined, {
      requireModel: false,
    }),
    { dispatcher: agent },
  )

describe('finding how a company AI gateway wants to be called', () => {
  it('uses a plain OpenAI-compatible gateway on the first try', async () => {
    const { agent, calls } = standIn({
      key,
      header: 'authorization',
      path: /^\/v1\/chat\/completions$/,
    })
    const saved = await save('https://gateway.example.com/v1', agent)
    expect(saved).toMatchObject({
      keyHeader: 'authorization',
      format: 'openai',
      model: 'gpt-company',
    })
    expect(calls.filter((call) => call.startsWith('POST'))).toHaveLength(1)
  })

  it('finds an API Management subscription key header', async () => {
    const { agent } = standIn({
      key,
      header: 'ocp-apim-subscription-key',
      path: /^\/ai\/v1\/chat\/completions$/,
    })
    const saved = await save('https://gateway.example.com/ai/v1', agent)
    expect(saved.keyHeader).toBe('ocp-apim-subscription-key')
  })

  it('adds an api-version when the gateway answers "Resource not found"', async () => {
    const { agent } = standIn({
      key,
      header: 'api-key',
      path: /^\/llm\/v1\/chat\/completions$/,
      needsVersion: true,
    })
    const saved = await save('https://gateway.example.com/llm/v1', agent)
    expect(saved.keyHeader).toBe('api-key')
    expect(saved.endpoint).toContain(`api-version=${AZURE_API_VERSION}`)
  })

  it('speaks Anthropic style to a Claude gateway', async () => {
    const { agent } = standIn({
      key,
      header: 'x-api-key',
      path: /^\/anthropic\/v1\/messages$/,
      anthropic: true,
    })
    const saved = await save('https://gateway.example.com/anthropic/v1', agent)
    expect(saved).toMatchObject({
      format: 'anthropic',
      keyHeader: 'x-api-key',
      endpoint: 'https://gateway.example.com/anthropic/v1/messages',
    })
  })

  it('says plainly when the key is not accepted anywhere, within the cap', async () => {
    const { agent, calls } = standIn({
      key: 'another-key',
      header: 'authorization',
      path: /./,
    })
    await expect(save('https://gateway.example.com/v1', agent)).rejects.toThrow(
      /did not accept this key in any of the usual places/,
    )
    expect(calls.length).toBeLessThanOrEqual(20)
  })

  it('says plainly when nothing lives at the address', async () => {
    const { agent } = standIn({
      key,
      header: 'authorization',
      path: /^\/somewhere-else$/,
    })
    await expect(save('https://gateway.example.com/v1', agent)).rejects.toThrow(
      /found nothing at this address/,
    )
  })
})
