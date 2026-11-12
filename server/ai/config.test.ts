import { describe, expect, it } from 'vitest'
import { loadAiServerConfig, parseAllowedAiEnvironment } from './config'

describe('on-prem AI server configuration', () => {
  it('reads only allowlisted AI variables', () => {
    expect(
      parseAllowedAiEnvironment(`
        FLOWLENS_AI_ENDPOINT=https://models.example.invalid/v1/chat/completions
        FLOWLENS_AI_MODEL=fictional-model
        FLOWLENS_AI_API_KEY="fictional-key"
        JIRA_TOKEN=must-not-be-loaded
      `),
    ).toEqual({
      FLOWLENS_AI_ENDPOINT:
        'https://models.example.invalid/v1/chat/completions',
      FLOWLENS_AI_MODEL: 'fictional-model',
      FLOWLENS_AI_API_KEY: 'fictional-key',
    })
  })

  it('loads a valid OpenAI-compatible endpoint without exposing defaults', () => {
    const config = loadAiServerConfig('/path/that/does/not/exist', {
      FLOWLENS_AI_ENDPOINT:
        'https://models.example.invalid/v1/chat/completions',
      FLOWLENS_AI_MODEL: 'fictional-model',
      FLOWLENS_AI_API_KEY: 'fictional-key',
    })

    expect(config).toMatchObject({
      endpoint: 'https://models.example.invalid/v1/chat/completions',
      model: 'fictional-model',
      apiKey: 'fictional-key',
      apiKeyHeader: 'Authorization',
      apiKeyPrefix: 'Bearer',
      missing: [],
      invalid: [],
    })
  })

  it('supports API-key headers that do not use a prefix', () => {
    const config = loadAiServerConfig('/path/that/does/not/exist', {
      FLOWLENS_AI_ENDPOINT:
        'https://models.example.invalid/v1/chat/completions',
      FLOWLENS_AI_MODEL: 'fictional-model',
      FLOWLENS_AI_API_KEY: 'fictional-key',
      FLOWLENS_AI_API_KEY_HEADER: 'api-key',
      FLOWLENS_AI_API_KEY_PREFIX: 'none',
    })

    expect(config.apiKeyHeader).toBe('api-key')
    expect(config.apiKeyPrefix).toBe('')
  })

  it('expands a bare OpenAI-compatible base URL', () => {
    const config = loadAiServerConfig('/path/that/does/not/exist', {
      FLOWLENS_AI_ENDPOINT: 'https://models.example.invalid',
      FLOWLENS_AI_MODEL: 'fictional-model',
      FLOWLENS_AI_API_KEY: 'fictional-key',
    })

    expect(config.endpoint).toBe(
      'https://models.example.invalid/v1/chat/completions',
    )
  })

  it('expands an application-scoped gateway base URL', () => {
    const config = loadAiServerConfig('/path/that/does/not/exist', {
      FLOWLENS_AI_ENDPOINT:
        'https://models.example.invalid/approved/application',
      FLOWLENS_AI_MODEL: 'fictional-model',
      FLOWLENS_AI_API_KEY: 'fictional-key',
    })

    expect(config.endpoint).toBe(
      'https://models.example.invalid/approved/application/v1/chat/completions',
    )
  })

  it('rejects unsafe endpoints and invalid header names', () => {
    const config = loadAiServerConfig('/path/that/does/not/exist', {
      FLOWLENS_AI_ENDPOINT:
        'https://person:secret@models.example.invalid/chat#fragment',
      FLOWLENS_AI_MODEL: 'fictional-model',
      FLOWLENS_AI_API_KEY: 'fictional-key',
      FLOWLENS_AI_API_KEY_HEADER: 'Bad Header',
    })

    expect(config.endpoint).toBe('')
    expect(config.invalid).toEqual([
      'FLOWLENS_AI_ENDPOINT',
      'FLOWLENS_AI_API_KEY_HEADER',
    ])
  })

  it('rejects an unreadable custom CA file', () => {
    const config = loadAiServerConfig('/path/that/does/not/exist', {
      FLOWLENS_AI_ENDPOINT: 'https://models.example.invalid',
      FLOWLENS_AI_MODEL: 'fictional-model',
      FLOWLENS_AI_API_KEY: 'fictional-key',
      FLOWLENS_AI_CA_FILE: 'company-root.pem',
    })

    expect(config.invalid).toContain('FLOWLENS_AI_CA_FILE')
    expect(config.caCertificate).toBe('')
  })
})
