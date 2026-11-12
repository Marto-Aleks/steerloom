// @vitest-environment node
import { MockAgent } from 'undici'
import { expect, it } from 'vitest'
import { connectAiKey, readAiKeyInput } from './workspace-key'

/** A gateway that rejects the parameters its model does not take, as Azure does. */
function reasoningGateway() {
  const agent = new MockAgent()
  agent.disableNetConnect()
  const bodies: Array<Record<string, unknown>> = []
  agent
    .get('https://gateway.example.com')
    .intercept({ path: () => true, method: 'POST' })
    .reply((options): { statusCode: number; data: object } => {
      const body = JSON.parse(options.body as string) as Record<string, unknown>
      bodies.push(body)
      if ('max_tokens' in body)
        return {
          statusCode: 400,
          data: {
            error: {
              message:
                "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
            },
          },
        }
      if ('temperature' in body)
        return {
          statusCode: 400,
          data: {
            error: {
              message:
                "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.",
            },
          },
        }
      return {
        statusCode: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'OK' } }] },
      }
    })
    .persist()
  return { agent, bodies }
}

const save = (endpoint: string, agent: MockAgent, model = '') =>
  connectAiKey(
    readAiKeyInput(
      { provider: 'custom', apiKey: 'fictional-key', endpoint, model },
      undefined,
      { requireModel: false },
    ),
    { dispatcher: agent },
  )

it('speaks to a GPT-5 deployment the way it expects from the first request', async () => {
  const { agent, bodies } = reasoningGateway()
  const saved = await save(
    'https://gateway.example.com/api/openai/deployments/gpt-5-nano-2025-08-07',
    agent,
  )
  expect(saved.model).toBe('gpt-5-nano-2025-08-07')
  expect(bodies).toHaveLength(1)
  expect(bodies[0]).toMatchObject({ max_completion_tokens: 256 })
  expect(bodies[0]).not.toHaveProperty('temperature')
})

it('corrects itself when a gateway names a parameter its model does not take', async () => {
  const { agent, bodies } = reasoningGateway()
  const saved = await save(
    'https://gateway.example.com/v1',
    agent,
    'company-reasoner',
  )
  expect(saved.model).toBe('company-reasoner')
  expect(bodies.map((body) => Object.keys(body).sort().join())).toEqual([
    'max_tokens,messages,model,reasoning_effort,stream,temperature',
    'max_completion_tokens,messages,model,reasoning_effort,stream,temperature',
    'max_completion_tokens,messages,model,reasoning_effort,stream',
  ])
})

it('remembers the correction for the next question', async () => {
  const { agent, bodies } = reasoningGateway()
  await save('https://gateway.example.com/v2', agent, 'company-reasoner')
  bodies.length = 0
  await save('https://gateway.example.com/v2', agent, 'company-reasoner')
  expect(bodies).toHaveLength(1)
})
