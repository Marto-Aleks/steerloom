import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Dispatcher } from 'undici'
import type { AiProvider } from '../../src/lib/workspace/model'

const aiEnvironmentKeys = [
  'FLOWLENS_AI_ENDPOINT',
  'FLOWLENS_AI_MODEL',
  'FLOWLENS_AI_API_KEY',
  'FLOWLENS_AI_API_KEY_HEADER',
  'FLOWLENS_AI_API_KEY_PREFIX',
  'FLOWLENS_AI_CA_FILE',
  'FLOWLENS_AI_PROXY',
] as const

type AiEnvironmentKey = (typeof aiEnvironmentKeys)[number]
type AiEnvironment = Partial<Record<AiEnvironmentKey, string>>

export type AiFormat = 'openai' | 'anthropic' | 'gemini'

export interface AiServerConfig {
  /** Where the settings came from: a workspace key or the local environment. */
  source: AiProvider | 'environment'
  /** Request format: OpenAI chat completions, Anthropic messages or Gemini generateContent. */
  format: AiFormat
  endpoint: string
  model: string
  apiKey: string
  apiKeyHeader: string
  apiKeyPrefix: string
  caCertificate: string
  proxyUrl: string
  /** Overrides proxyUrl, e.g. the hosted public-address-only dispatcher. */
  dispatcher?: Dispatcher
  missing: string[]
  invalid: string[]
}

export function parseAllowedAiEnvironment(contents: string): AiEnvironment {
  const allowed = new Set<string>(aiEnvironmentKeys)
  const values: AiEnvironment = {}

  contents.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(trimmed)
    if (!match) return
    const key = match[1]
    if (!key || !allowed.has(key)) return
    values[key as AiEnvironmentKey] = unquote(match[2] ?? '')
  })

  return values
}

export function loadAiServerConfig(
  cwd = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): AiServerConfig {
  const fileValues = readLocalEnvironment(resolve(cwd, '.env.local'))
  const value = (key: AiEnvironmentKey): string =>
    environment[key]?.trim() || fileValues[key]?.trim() || ''
  const endpointValue = value('FLOWLENS_AI_ENDPOINT')
  const model = value('FLOWLENS_AI_MODEL')
  const apiKey = value('FLOWLENS_AI_API_KEY')
  const apiKeyHeader = value('FLOWLENS_AI_API_KEY_HEADER') || 'Authorization'
  const apiKeyPrefixValue = value('FLOWLENS_AI_API_KEY_PREFIX')
  const apiKeyPrefix =
    apiKeyPrefixValue.toLowerCase() === 'none'
      ? ''
      : apiKeyPrefixValue || 'Bearer'
  const endpoint = normaliseEndpoint(endpointValue)
  const caFile = value('FLOWLENS_AI_CA_FILE')
  const caCertificate = caFile ? readTextFile(resolve(cwd, caFile)) : ''
  const invalid = [
    ...(endpointValue && !endpoint ? ['FLOWLENS_AI_ENDPOINT'] : []),
    ...(/^[A-Za-z0-9-]+$/.test(apiKeyHeader)
      ? []
      : ['FLOWLENS_AI_API_KEY_HEADER']),
    ...(caFile && !caCertificate ? ['FLOWLENS_AI_CA_FILE'] : []),
  ]

  return {
    source: 'environment',
    format: 'openai',
    endpoint,
    model,
    apiKey,
    apiKeyHeader,
    apiKeyPrefix,
    caCertificate,
    proxyUrl: value('FLOWLENS_AI_PROXY'),
    missing: [
      ...(endpointValue ? [] : ['FLOWLENS_AI_ENDPOINT']),
      ...(model ? [] : ['FLOWLENS_AI_MODEL']),
      ...(apiKey ? [] : ['FLOWLENS_AI_API_KEY']),
    ],
    invalid,
  }
}

function readLocalEnvironment(path: string): AiEnvironment {
  if (!existsSync(path)) return {}
  return parseAllowedAiEnvironment(readFileSync(path, 'utf8'))
}

function readTextFile(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return ''
  }
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function normaliseEndpoint(
  value: string,
  format: AiFormat = 'openai',
): string {
  if (!value) return ''
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    if (url.username || url.password || url.hash) return ''
    if (format === 'gemini') {
      url.pathname = geminiBase(url.pathname)
      return url.toString()
    }
    const path = url.pathname.replace(/\/+$/, '')
    // A base address as providers and gateways print it gets the chat path:
    // https://host → /v1/chat/completions; …/v1, …/api/google/v1,
    // …/v1beta/openai or an Azure …/deployments/<name> → + /chat/completions.
    // A full …/chat/completions or Anthropic-style …/messages address stays.
    if (!path) url.pathname = '/v1/chat/completions'
    else if (/\/(?:chat\/completions|messages)$/.test(path)) url.pathname = path
    else if (/\/(?:v\d+\w*|openai|deployments\/[^/]+)$/i.test(path))
      url.pathname = `${path}/chat/completions`
    else url.pathname = `${path}/v1/chat/completions`
    return url.toString()
  } catch {
    return ''
  }
}

/**
 * Gemini's generateContent lives under a versioned base
 * (https://generativelanguage.googleapis.com/v1beta, or a gateway's
 * …/api/google/v1): the model is part of the path, so the stored address is
 * the base and the client adds /models/<model>:generateContent.
 */
export function geminiBase(pathname: string): string {
  const path = pathname
    .replace(/\/+$/, '')
    .replace(/\/models\/[^/]+:generateContent$/i, '')
    .replace(/\/(?:chat\/completions|messages)$/, '')
    .replace(/\/openai$/, '')
  if (!path) return '/v1beta'
  return /\/v\d+\w*$/i.test(path) ? path : `${path}/v1beta`
}
