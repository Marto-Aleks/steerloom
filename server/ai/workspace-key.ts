import { isIP } from 'node:net'
import type { Dispatcher } from 'undici'
import type {
  AiProvider,
  WorkspaceAiSettings,
} from '../../src/lib/workspace/model'
import { publicAddress } from '../hosted/public-network'
import { normaliseEndpoint, type AiFormat, type AiServerConfig } from './config'
import { AiClient, AiUpstreamError, type AiModelOption } from './client'
import { detectGateway } from './gateway-detect'

/** Stored encrypted; only the server ever reads apiKey. */
export interface AiKeySecret {
  provider: AiProvider
  apiKey: string
  model: string
  endpoint?: string
  /** Company endpoints: where the key goes, as found when the key was saved. */
  keyHeader?: KeyHeader
  /** Company endpoints: OpenAI-style chat, Anthropic-style messages or Gemini. */
  format?: AiFormat
}

export const AI_FORMATS: readonly AiFormat[] = ['openai', 'anthropic', 'gemini']

/** The places company AI gateways expect a key, as header names. */
export const KEY_HEADERS = {
  authorization: 'Authorization',
  'api-key': 'api-key',
  'x-api-key': 'x-api-key',
  'ocp-apim-subscription-key': 'Ocp-Apim-Subscription-Key',
  'x-goog-api-key': 'x-goog-api-key',
} as const
export type KeyHeader = keyof typeof KEY_HEADERS

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5'

/**
 * Stored when a company gateway answers without a model name and does not say
 * which model replied. Requests then name no model, so the gateway uses its
 * default. The brackets keep it apart from any real model name.
 */
export const GATEWAY_DEFAULT_MODEL = '(gateway default)'

const providerEndpoints: Record<Exclude<AiProvider, 'custom'>, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
}

/**
 * Validates an owner's AI key form. A blank key keeps the stored key when the
 * provider is unchanged, so owners can switch models without re-pasting it.
 */
export function readAiKeyInput(
  input: Record<string, unknown>,
  existing?: AiKeySecret,
  {
    requirePublic = false,
    requireModel = true,
  }: { requirePublic?: boolean; requireModel?: boolean } = {},
): AiKeySecret {
  const provider = input.provider
  if (
    provider !== 'anthropic' &&
    provider !== 'openai' &&
    provider !== 'custom'
  )
    throw new Error('Choose an AI provider.')
  const typedKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
  // The saved key is reused only for the service it was saved for. A new
  // endpoint address needs the key typed again: otherwise anyone who may
  // change the settings could have the saved key sent to a server of their
  // own and read it there.
  const movesEndpoint =
    provider === 'custom' &&
    typeof input.endpoint === 'string' &&
    input.endpoint.trim() !== '' &&
    !sameOrigin(input.endpoint.trim(), existing?.endpoint)
  const apiKey =
    typedKey ||
    (existing?.provider === provider && !movesEndpoint ? existing.apiKey : '')
  if (!apiKey)
    throw new Error(
      movesEndpoint && existing?.provider === provider
        ? 'Paste the API key again: the endpoint address changed.'
        : 'Paste an API key.',
    )
  if (apiKey.length > 400 || /\s/.test(apiKey))
    throw new Error('Paste the API key exactly as the provider shows it.')
  const typedModel = typeof input.model === 'string' ? input.model.trim() : ''
  if (typedModel === GATEWAY_DEFAULT_MODEL)
    throw new Error('Enter a model name, or leave the field empty.')
  const model =
    typedModel || (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : '')
  if (!model && requireModel) throw new Error('Enter the model name to use.')
  if (model && !/^[\w.:/@-]{1,100}$/.test(model))
    throw new Error('Enter a model name without spaces.')
  if (provider !== 'custom') return { provider, apiKey, model }
  // From a pasted example request: the exact format and key header, so no
  // guessing is needed. Only known values are accepted.
  const format = AI_FORMATS.find((value) => value === input.format)
  const keyHeader = (Object.keys(KEY_HEADERS) as KeyHeader[]).find(
    (value) =>
      typeof input.keyHeader === 'string' &&
      value === input.keyHeader.toLowerCase(),
  )
  const typedEndpoint =
    typeof input.endpoint === 'string' ? input.endpoint.trim() : ''
  const endpoint = typedEndpoint
    ? normaliseEndpoint(typedEndpoint.slice(0, 300), format)
    : existing?.provider === 'custom'
      ? (existing.endpoint ?? '')
      : ''
  if (!endpoint)
    throw new Error('Enter the endpoint address, starting with https://.')
  if (requirePublic) assertPublicEndpoint(endpoint)
  if (format === 'gemini' && !model && requireModel)
    throw new Error('Enter the Gemini model name, such as gemini-2.5-pro.')
  return {
    provider,
    apiKey,
    model,
    endpoint,
    ...(format ? { format } : {}),
    ...(keyHeader ? { keyHeader } : {}),
  }
}

export function aiKeySummary(secret: AiKeySecret): WorkspaceAiSettings {
  return {
    provider: secret.provider,
    model: secret.model,
    ...(secret.endpoint ? { endpointHost: new URL(secret.endpoint).host } : {}),
  }
}

/** Used when an Azure-style address names no api-version; recent enough for reasoning models. */
export const AZURE_API_VERSION = '2025-04-01-preview'

/**
 * Azure OpenAI and gateways in front of it expect the key in an `api-key`
 * header. Recognised by a deployment address (…/openai/deployments/<name>)
 * or a Microsoft Azure AI hostname, which also covers Azure's newer
 * …/openai/v1 addresses. Deployment addresses also need an api-version;
 * without one Azure answers "Resource not found".
 */
export function azureAddress(endpoint: string): string | null {
  try {
    const url = new URL(endpoint)
    const deployment = /\/openai\/deployments\/[^/]+/i.test(url.pathname)
    const azureHost =
      /\.(?:openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/i.test(
        url.hostname,
      )
    if (!deployment && !azureHost) return null
    if (deployment && !url.searchParams.has('api-version'))
      url.searchParams.set('api-version', AZURE_API_VERSION)
    return url.toString()
  } catch {
    return null
  }
}

export function aiConfigFromKey(
  secret: AiKeySecret,
  network: { proxyUrl?: string; dispatcher?: Dispatcher } = {},
): AiServerConfig {
  const custom = secret.provider === 'custom'
  const azure = custom ? azureAddress(secret.endpoint ?? '') : null
  const format: AiFormat = custom
    ? (secret.format ??
      (/\/messages(?:\?|$)/.test(secret.endpoint ?? '')
        ? 'anthropic'
        : 'openai'))
    : secret.provider === 'anthropic'
      ? 'anthropic'
      : 'openai'
  // A header found when the key was saved wins; otherwise the usual guess.
  const header = secret.keyHeader
    ? KEY_HEADERS[secret.keyHeader]
    : azure
      ? 'api-key'
      : format === 'anthropic'
        ? 'x-api-key'
        : format === 'gemini'
          ? 'x-goog-api-key'
          : 'Authorization'
  return {
    source: secret.provider,
    format,
    endpoint:
      secret.provider === 'custom'
        ? (azure ?? secret.endpoint ?? '')
        : providerEndpoints[secret.provider],
    model: secret.model === GATEWAY_DEFAULT_MODEL ? '' : secret.model,
    apiKey: secret.apiKey,
    apiKeyHeader: header,
    apiKeyPrefix: header === 'Authorization' ? 'Bearer' : '',
    caCertificate: '',
    proxyUrl: network.proxyUrl ?? '',
    ...(network.dispatcher ? { dispatcher: network.dispatcher } : {}),
    missing: [],
    invalid: [],
  }
}

// Hosted installations only call public HTTPS endpoints; the dispatcher also
// rejects private addresses at connect time.
function assertPublicEndpoint(endpoint: string) {
  const url = new URL(endpoint)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.search ||
    (isIP(host) && !publicAddress(host)) ||
    /^localhost$/i.test(host)
  )
    throw new Error(
      'Hosted workspaces can only use a public HTTPS AI endpoint. Use the local version for company-internal endpoints.',
    )
}

/** Thrown when the endpoint needs a model name Steerloom could not find. */
export class AiModelRequiredError extends Error {
  readonly reason = 'ai-model-required'
  /** The status of the answer that led here; 404 may also mean a wrong address. */
  constructor(readonly status = 400) {
    super(
      'This endpoint needs a model or deployment name. You’ll find it where you got the key: in the Azure portal under Deployments, or from the team that runs your company’s AI gateway. It often looks like gpt-4o or claude-sonnet.',
    )
  }
}

/** The deployment name inside an Azure OpenAI address, if it is one. */
export function azureDeployment(endpoint: string | undefined): string {
  const match = /\/openai\/deployments\/([\w.-]{1,100})\//i.exec(endpoint ?? '')
  return match ? decodeURIComponent(match[1]!) : ''
}

/** A sensible default from a key's model list: a capable chat model, not a mini or legacy one. */
export function preferredModel(models: AiModelOption[]): string {
  const ids = models.map((item) => item.id)
  const ranked = [
    /claude-sonnet/i,
    /sonnet/i,
    /^gpt-5(?:\.\d+)?$/i,
    /^gpt-4\.1$/i,
    /^gpt-4o$/i,
    /^gemini-[\d.]+-pro$/i,
    /^gemini-[\d.]+-flash$/i,
    /claude/i,
    /gpt-(?:5|4\.1|4o)(?!.*(?:mini|nano))/i,
    /gemini(?!.*(?:embedding|image|tts|audio|live))/i,
  ]
  for (const pattern of ranked) {
    const found = ids.find((id) => pattern.test(id))
    if (found) return found
  }
  return ids[0] ?? ''
}

/**
 * Checks an AI key and settles which model it uses, so people rarely have to
 * know the model's name: the one they typed; else the deployment in an Azure
 * address; else a sensible pick from the key's model list; else whatever the
 * gateway answers with by default. Only when all of that fails is a name
 * asked for (AiModelRequiredError). The check is one tiny question.
 */
export async function connectAiKey(
  secret: AiKeySecret,
  network: Parameters<typeof aiConfigFromKey>[1] = {},
  signal?: AbortSignal,
): Promise<AiKeySecret> {
  // Company endpoints differ in address, key header and API style: find the
  // combination this one accepts (see gateway-detect.ts).
  if (secret.provider === 'custom')
    return detectGateway(secret, (candidate) =>
      resolveModel(candidate, network, signal),
    )
  return resolveModel(secret, network, signal)
}

async function resolveModel(
  secret: AiKeySecret,
  network: Parameters<typeof aiConfigFromKey>[1],
  signal?: AbortSignal,
): Promise<AiKeySecret> {
  const check = async (model: string) =>
    new AiClient(aiConfigFromKey({ ...secret, model }, network)).verify(signal)
  if (secret.model) {
    await check(secret.model)
    return secret
  }
  const fromAddress = azureDeployment(secret.endpoint)
  if (fromAddress) {
    await check(fromAddress)
    return { ...secret, model: fromAddress }
  }
  let listed: AiModelOption[] = []
  try {
    listed = await new AiClient(aiConfigFromKey(secret, network)).listModels(
      signal,
    )
  } catch (caught) {
    // A refused key is the person's problem to fix; a hidden list is not.
    // Company gateways often block the list itself (403) while chat works,
    // so for them the chat check below decides whether the key is good.
    if (
      caught instanceof AiUpstreamError &&
      (caught.status === 401 || caught.status === 403) &&
      secret.provider !== 'custom'
    )
      throw caught
  }
  const picked = preferredModel(listed)
  if (picked) {
    await check(picked)
    return { ...secret, model: picked }
  }
  // Gemini names the model in the address: there is no "default model" call.
  if (secret.provider !== 'custom' || secret.format === 'gemini')
    throw new AiModelRequiredError()
  try {
    const answered = await check('')
    return { ...secret, model: answered.model ?? GATEWAY_DEFAULT_MODEL }
  } catch (caught) {
    if (
      caught instanceof AiUpstreamError &&
      (caught.status === 401 || caught.status === 403 || caught.status >= 429)
    )
      throw caught
    throw new AiModelRequiredError(
      caught instanceof AiUpstreamError ? caught.status : 400,
    )
  }
}

/** Whether two addresses are the same server (scheme, host and port). */
function sameOrigin(typed: string, saved: string | undefined): boolean {
  if (!saved) return false
  try {
    const withScheme = (value: string) =>
      /^https?:\/\//i.test(value) ? value : `https://${value}`
    return new URL(withScheme(typed)).origin === new URL(saved).origin
  } catch {
    return false
  }
}
