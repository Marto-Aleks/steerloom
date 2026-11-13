import { MockAgent } from 'undici'
import { describe, expect, it } from 'vitest'
import { AiClient, extractAssistantContent } from './client'
import { normaliseEndpoint } from './config'
import {
  aiConfigFromKey,
  aiKeySummary,
  AiModelRequiredError,
  AZURE_API_VERSION,
  azureAddress,
  azureDeployment,
  connectAiKey,
  DEFAULT_ANTHROPIC_MODEL,
  GATEWAY_DEFAULT_MODEL,
  preferredModel,
  readAiKeyInput,
} from './workspace-key'

describe('workspace AI keys', () => {
  it('defaults the Anthropic model and keeps a saved key for the same provider', () => {
    const first = readAiKeyInput({
      provider: 'anthropic',
      apiKey: 'fictional-key-123',
    })
    expect(first).toEqual({
      provider: 'anthropic',
      apiKey: 'fictional-key-123',
      model: DEFAULT_ANTHROPIC_MODEL,
    })
    expect(
      readAiKeyInput({ provider: 'anthropic', model: 'other-model' }, first)
        .apiKey,
    ).toBe('fictional-key-123')
    expect(() => readAiKeyInput({ provider: 'openai' }, first)).toThrow(
      'Paste an API key.',
    )
  })

  it('requires a model for OpenAI and an endpoint for company endpoints', () => {
    expect(() =>
      readAiKeyInput({ provider: 'openai', apiKey: 'fictional-key-123' }),
    ).toThrow('Enter the model name to use.')
    expect(() =>
      readAiKeyInput(
        {
          provider: 'openai',
          apiKey: 'fictional-key-123',
          model: GATEWAY_DEFAULT_MODEL,
        },
        undefined,
        { requireModel: false },
      ),
    ).toThrow('leave the field empty')
    expect(() =>
      readAiKeyInput({
        provider: 'custom',
        apiKey: 'fictional-key-123',
        model: 'fictional-model',
      }),
    ).toThrow('Enter the endpoint address')
    const custom = readAiKeyInput({
      provider: 'custom',
      apiKey: 'fictional-key-123',
      model: 'fictional-model',
      endpoint: 'https://ai.example.com/v1',
    })
    expect(custom.endpoint).toBe('https://ai.example.com/v1/chat/completions')
    expect(aiKeySummary(custom)).toEqual({
      provider: 'custom',
      model: 'fictional-model',
      endpointHost: 'ai.example.com',
    })
    expect(JSON.stringify(aiKeySummary(custom))).not.toContain('fictional-key')
  })

  it('only allows public HTTPS endpoints on hosted workspaces', () => {
    for (const endpoint of [
      'http://ai.example.com/v1',
      'https://10.0.0.5/v1',
      'https://localhost/v1',
    ])
      expect(() =>
        readAiKeyInput(
          {
            provider: 'custom',
            apiKey: 'fictional-key-123',
            model: 'fictional-model',
            endpoint,
          },
          undefined,
          { requirePublic: true },
        ),
      ).toThrow('public HTTPS AI endpoint')
  })

  it('never sends a saved key to a different server: a new endpoint needs the key again', () => {
    const saved = readAiKeyInput({
      provider: 'custom',
      apiKey: 'fictional-key-123',
      endpoint: 'https://models.example.invalid/v1',
      model: 'team-model',
    })
    // Same server, another model or path: the saved key is kept.
    expect(
      readAiKeyInput(
        {
          provider: 'custom',
          endpoint: 'https://models.example.invalid/v2',
          model: 'other-model',
        },
        saved,
      ).apiKey,
    ).toBe('fictional-key-123')
    expect(
      readAiKeyInput({ provider: 'custom', model: 'other-model' }, saved)
        .apiKey,
    ).toBe('fictional-key-123')
    // Another host, port or scheme: the key must be typed again.
    for (const endpoint of [
      'https://attacker.example.invalid/v1',
      'https://models.example.invalid:8443/v1',
      'http://models.example.invalid/v1',
      'https://models.example.invalid.attacker.example.invalid/v1',
    ])
      expect(() =>
        readAiKeyInput({ provider: 'custom', endpoint, model: 'm' }, saved),
      ).toThrow('Paste the API key again: the endpoint address changed.')
    // Typed together with the new address, it is accepted.
    expect(
      readAiKeyInput(
        {
          provider: 'custom',
          endpoint: 'https://other.example.invalid/v1',
          apiKey: 'fictional-key-456',
          model: 'm',
        },
        saved,
      ).apiKey,
    ).toBe('fictional-key-456')
  })

  it('rejects keys with spaces', () => {
    expect(() =>
      readAiKeyInput({ provider: 'anthropic', apiKey: 'two words' }),
    ).toThrow('exactly as the provider shows it')
  })
})

describe('Anthropic requests', () => {
  it('reads text blocks from Anthropic message responses', () => {
    expect(
      extractAssistantContent({
        content: [
          { type: 'thinking', thinking: 'hidden' },
          { type: 'text', text: 'Visible answer.' },
        ],
      }),
    ).toBe('Visible answer.')
  })

  it('sends the key header, version and a user-first conversation', async () => {
    const agent = new MockAgent()
    agent.disableNetConnect()
    let seen: { headers: Record<string, string>; body: string } | undefined
    agent
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply((options) => {
        seen = {
          headers: options.headers as Record<string, string>,
          body: typeof options.body === 'string' ? options.body : '',
        }
        return {
          statusCode: 200,
          data: { content: [{ type: 'text', text: 'OK' }] },
        }
      })
    const config = aiConfigFromKey(
      readAiKeyInput({ provider: 'anthropic', apiKey: 'fictional-key-123' }),
      { dispatcher: agent },
    )
    await new AiClient(config).verify()
    expect(seen?.headers['x-api-key']).toBe('fictional-key-123')
    expect(seen?.headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(seen!.body) as {
      system: string
      messages: Array<{ role: string }>
    }
    expect(body.system).toBeTruthy()
    expect(body.messages[0]?.role).toBe('user')
  })

  it('finds the model so people rarely have to name it', () => {
    expect(
      azureDeployment(
        'https://team.openai.azure.com/openai/deployments/gpt-4o-prod/chat/completions?api-version=2024-10-21',
      ),
    ).toBe('gpt-4o-prod')
    expect(azureDeployment('https://ai.example.com/v1/chat/completions')).toBe(
      '',
    )
    const list = (ids: string[]) => ids.map((id) => ({ id, label: id }))
    expect(preferredModel(list(['gpt-4o-mini', 'gpt-4o', 'o3']))).toBe('gpt-4o')
    expect(
      preferredModel(list(['claude-haiku-5-5', 'claude-sonnet-5-5'])),
    ).toBe('claude-sonnet-5-5')
    expect(preferredModel(list(['company-llm-large']))).toBe(
      'company-llm-large',
    )
    expect(preferredModel([])).toBe('')
  })
})

describe('connecting a company AI endpoint without a model name', () => {
  const custom = (endpoint = 'https://ai.example.com/v1') =>
    readAiKeyInput(
      { provider: 'custom', apiKey: 'fictional-key-123', endpoint },
      undefined,
      { requireModel: false },
    )
  const gateway = () => {
    const agent = new MockAgent()
    agent.disableNetConnect()
    return { agent, pool: agent.get('https://ai.example.com') }
  }
  const sentModels: Array<string | undefined> = []
  const answer = (model?: string) => (options: { body?: unknown }) => {
    const body = JSON.parse(String(options.body)) as { model?: string }
    sentModels.push(body.model)
    return {
      statusCode: 200,
      data: {
        ...(model ? { model } : {}),
        choices: [{ message: { content: 'OK' } }],
      },
    }
  }

  it('uses a sensible model from the key’s list', async () => {
    const { agent, pool } = gateway()
    pool.intercept({ path: '/v1/models', method: 'GET' }).reply(200, {
      data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }],
    })
    pool
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(answer('gpt-4o'))
    const saved = await connectAiKey(custom(), { dispatcher: agent })
    expect(saved.model).toBe('gpt-4o')
  })

  it('lets a gateway answer with its default and records which model replied', async () => {
    const { agent, pool } = gateway()
    pool.intercept({ path: '/v1/models', method: 'GET' }).reply(404, {})
    pool
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(answer('company-llm-2'))
    sentModels.length = 0
    const saved = await connectAiKey(custom(), { dispatcher: agent })
    expect(sentModels).toEqual([undefined])
    expect(saved.model).toBe('company-llm-2')
  })

  it('marks a silent gateway default and names no model afterwards', async () => {
    const { agent, pool } = gateway()
    pool.intercept({ path: '/v1/models', method: 'GET' }).reply(404, {})
    pool
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(answer())
    const saved = await connectAiKey(custom(), { dispatcher: agent })
    expect(saved.model).toBe(GATEWAY_DEFAULT_MODEL)
    expect(aiConfigFromKey(saved).model).toBe('')
  })

  it('asks for a name, saying where to find it, only when nothing works', async () => {
    const { agent, pool } = gateway()
    pool.intercept({ path: '/v1/models', method: 'GET' }).reply(404, {})
    pool
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(400, { error: { message: 'model is required' } })
    const failure = connectAiKey(custom(), { dispatcher: agent })
    await expect(failure).rejects.toBeInstanceOf(AiModelRequiredError)
    await expect(failure).rejects.toThrow('Azure portal under Deployments')
  })

  it('reports a refused key as a key problem, not a missing model', async () => {
    const { agent, pool } = gateway()
    pool
      .intercept({ path: '/v1/models', method: 'GET' })
      .reply(401, { error: { message: 'invalid key' } })
      .persist()
    // A refused key is refused by the chat check too, which decides it.
    pool
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(401, { error: { message: 'invalid key' } })
      .persist()
    const failure = connectAiKey(custom(), { dispatcher: agent })
    await expect(failure).rejects.not.toBeInstanceOf(AiModelRequiredError)
    await expect(failure).rejects.toThrow('any of the usual places')
  })

  it('takes the deployment from an Azure address without asking', async () => {
    const agent = new MockAgent()
    agent.disableNetConnect()
    agent
      .get('https://team.openai.azure.com')
      .intercept({
        path: (path) => path.startsWith('/openai/deployments/gpt-4o-prod/'),
        method: 'POST',
      })
      .reply(answer('gpt-4o'))
    const saved = await connectAiKey(
      custom(
        'https://team.openai.azure.com/openai/deployments/gpt-4o-prod/chat/completions',
      ),
      { dispatcher: agent },
    )
    expect(saved.model).toBe('gpt-4o-prod')
  })

  it('sends Azure-style addresses the api-key header and an api-version', async () => {
    const agent = new MockAgent()
    agent.disableNetConnect()
    const pool = agent.get('https://gateway.example.com')
    pool
      .intercept({
        path: `/api/openai/deployments/gpt-prod/chat/completions?api-version=${AZURE_API_VERSION}`,
        method: 'POST',
        headers: (headers: Record<string, string>) =>
          headers['api-key'] === 'fictional-key-123' && !headers.authorization,
      })
      .reply(answer('gpt-prod'))
    const saved = await connectAiKey(
      custom('https://gateway.example.com/api/openai/deployments/gpt-prod'),
      { dispatcher: agent },
    )
    expect(saved.model).toBe('gpt-prod')
    // An api-version the person typed is kept.
    expect(
      azureAddress(
        'https://team.openai.azure.com/openai/deployments/x/chat/completions?api-version=2024-10-21',
      ),
    ).toContain('api-version=2024-10-21')
    expect(
      azureAddress('https://ai.example.com/v1/chat/completions'),
    ).toBeNull()
  })

  it('treats Azure hostnames as Azure, without adding a version to v1 addresses', () => {
    const endpoint = normaliseEndpoint(
      'https://team.openai.azure.com/openai/v1/',
    )
    expect(endpoint).toBe(
      'https://team.openai.azure.com/openai/v1/chat/completions',
    )
    expect(azureAddress(endpoint)).toBe(endpoint)
    const config = aiConfigFromKey(custom(endpoint))
    expect(config.apiKeyHeader).toBe('api-key')
    expect(config.apiKeyPrefix).toBe('')
    expect(config.endpoint).toBe(endpoint)
    expect(
      azureAddress('https://hub.services.ai.azure.com/models/chat/completions'),
    ).not.toBeNull()
    expect(
      azureAddress('https://evil.example.com/openai.azure.com/v1'),
    ).toBeNull()
    // Everyone else keeps the usual Bearer key.
    expect(aiConfigFromKey(custom()).apiKeyHeader).toBe('Authorization')
  })
})

describe('company endpoint addresses', () => {
  it.each([
    ['https://ai.example.com', 'https://ai.example.com/v1/chat/completions'],
    [
      'https://ai.example.com/v1/',
      'https://ai.example.com/v1/chat/completions',
    ],
    [
      'https://gateway.example.com/api/google/v1',
      'https://gateway.example.com/api/google/v1/chat/completions',
    ],
    [
      'https://gateway.example.com/v1beta/openai',
      'https://gateway.example.com/v1beta/openai/chat/completions',
    ],
    [
      'https://res.example.com/openai/deployments/gpt-4o?api-version=2024-10-21',
      'https://res.example.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21',
    ],
    [
      'https://gateway.example.com/llm',
      'https://gateway.example.com/llm/v1/chat/completions',
    ],
    [
      'https://gateway.example.com/api/v2/chat/completions',
      'https://gateway.example.com/api/v2/chat/completions',
    ],
  ])('turns %s into the chat address', (typed, expected) => {
    expect(normaliseEndpoint(typed)).toBe(expected)
  })
})
