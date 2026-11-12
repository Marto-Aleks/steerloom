import { AiUpstreamError } from './client'
import { geminiBase, type AiFormat } from './config'
import {
  AiModelRequiredError,
  AZURE_API_VERSION,
  azureAddress,
  KEY_HEADERS,
  type AiKeySecret,
  type KeyHeader,
} from './workspace-key'

/*
 * Company AI gateways differ in three ways: the address (OpenAI-style
 * …/chat/completions or Anthropic-style …/messages, sometimes with an
 * api-version), and where the key goes (Authorization, api-key, x-api-key or
 * Ocp-Apim-Subscription-Key). When a company key is saved, Steerloom tries the
 * likely combinations against the address the person typed — never another
 * host — and keeps the first one that answers. Each try is the usual tiny
 * check question, and the tries are capped.
 *
 * The gateway's replies steer the search: 401/403 means the key is in the
 * wrong place, so the next header is tried; a "not found" or a mention of
 * api-version means the address needs a version or the other API style.
 * Anything else (busy, unreachable, a model question) is not about the format
 * and is reported as it is.
 */

const MAX_TRIES = 12

interface Try {
  status: number
  reason: string
}

const statusOf = (caught: unknown) =>
  caught instanceof AiUpstreamError || caught instanceof AiModelRequiredError
    ? caught.status
    : 0
const reasonOf = (caught: unknown) =>
  caught instanceof AiUpstreamError ? caught.reason : ''

/** The same address in another API style. */
function addressFor(endpoint: string, format: AiFormat): string {
  if (format === 'gemini') {
    const url = new URL(endpoint)
    url.pathname = geminiBase(url.pathname)
    return url.toString()
  }
  const chat = endpoint
    .replace(/\/messages(?=\?|$)/, '/chat/completions')
    .replace(/\/models\/[^/]+:generateContent(?=\?|$)/i, '/chat/completions')
  return format === 'anthropic'
    ? chat.replace(/\/chat\/completions(?=\?|$)/, '/messages')
    : chat
}

/**
 * An Azure-style base (…/openai, often behind a company prefix such as
 * …/api/providers/gcp/azure/openai) with a model: Azure wants the model as
 * a deployment in the path, and an api-version.
 */
export function azureDeploymentAddress(
  endpoint: string,
  model: string,
): string | null {
  if (!model || !/^[\w.:@-]{1,100}$/.test(model)) return null
  const url = new URL(endpoint)
  const base = url.pathname.replace(/\/chat\/completions$/, '')
  if (!/\/openai$/i.test(base) || /\/deployments\//i.test(base)) return null
  url.pathname = `${base}/deployments/${encodeURIComponent(model)}/chat/completions`
  if (!url.searchParams.has('api-version'))
    url.searchParams.set('api-version', AZURE_API_VERSION)
  return url.toString()
}

/** Gemini's own OpenAI-compatible path lives beside its base: …/v1beta/openai. */
function geminiOpenAiAddress(endpoint: string): string {
  const url = new URL(endpoint)
  const base = geminiBase(url.pathname)
  url.pathname = `${base}/openai/chat/completions`
  return url.toString()
}

function withApiVersion(endpoint: string): string | null {
  const url = new URL(endpoint)
  if (url.searchParams.has('api-version')) return null
  url.searchParams.set('api-version', AZURE_API_VERSION)
  return url.toString()
}

const wantsVersion = (tried: Try) =>
  tried.status === 404 ||
  (tried.status === 400 && /api[- ]?version/i.test(tried.reason))

export async function detectGateway(
  secret: AiKeySecret,
  attempt: (candidate: AiKeySecret) => Promise<AiKeySecret>,
): Promise<AiKeySecret> {
  const typed = secret.endpoint ?? ''
  // From a pasted example request, the format and header are known: ask once.
  if (secret.format && secret.keyHeader) return attempt(secret)
  const googleish =
    /google|gemini|generativelanguage/i.test(typed) ||
    /:generateContent/i.test(typed)
  const anthropicFirst =
    /\/messages(?:\?|$)/.test(typed) || /anthropic|claude/i.test(typed)
  // Each candidate: an API style at the address shaped for it. The order
  // follows the hints in the address; the last ones only run when every
  // earlier try found nothing at its address.
  const deployment = azureDeploymentAddress(typed, secret.model)
  // "azure" in the route: the deployment address first; otherwise right
  // after the plain OpenAI-style try.
  const azureFirst = !!deployment && /\/azure\//i.test(typed)
  const withDeployment = (
    list: Array<{ format: AiFormat; endpoint: string }>,
  ) =>
    deployment
      ? azureFirst
        ? [{ format: 'openai' as const, endpoint: deployment }, ...list]
        : [
            list[0]!,
            { format: 'openai' as const, endpoint: deployment },
            ...list.slice(1),
          ]
      : list
  const candidates: Array<{ format: AiFormat; endpoint: string }> =
    withDeployment(
      googleish
        ? [
            { format: 'gemini', endpoint: addressFor(typed, 'gemini') },
            { format: 'openai', endpoint: geminiOpenAiAddress(typed) },
            { format: 'openai', endpoint: addressFor(typed, 'openai') },
            { format: 'anthropic', endpoint: addressFor(typed, 'anthropic') },
          ]
        : anthropicFirst
          ? [
              { format: 'anthropic', endpoint: addressFor(typed, 'anthropic') },
              { format: 'openai', endpoint: addressFor(typed, 'openai') },
              { format: 'gemini', endpoint: addressFor(typed, 'gemini') },
            ]
          : [
              { format: 'openai', endpoint: addressFor(typed, 'openai') },
              { format: 'anthropic', endpoint: addressFor(typed, 'anthropic') },
              { format: 'gemini', endpoint: addressFor(typed, 'gemini') },
            ],
    )
  const tries: Try[] = []
  const run = async (candidate: AiKeySecret) => {
    try {
      return { saved: await attempt(candidate) }
    } catch (caught) {
      // "Not found" without a model name may just as well be a wrong address,
      // so keep looking; any other missing model is a real model question.
      if (caught instanceof AiModelRequiredError && caught.status !== 404)
        throw caught
      const tried = { status: statusOf(caught), reason: reasonOf(caught) }
      // A busy or unreachable gateway is not a format problem.
      if (![400, 401, 403, 404, 405].includes(tried.status)) throw caught
      // The gateway names the model or deployment: the format is right.
      if (
        /model|deployment/i.test(tried.reason) &&
        !/api[- ]?version/i.test(tried.reason)
      )
        throw caught
      tries.push(tried)
      return { tried, caught }
    }
  }

  let last: unknown
  const seen = new Set<string>()
  for (const [index, candidate] of candidates.entries()) {
    const { format, endpoint } = candidate
    if (seen.has(`${format} ${endpoint}`)) continue
    seen.add(`${format} ${endpoint}`)
    // Another API style only helps when this one found nothing.
    if (index > 0 && !tries.every((tried) => tried.status === 404)) break
    const guess: KeyHeader = azureAddress(endpoint)
      ? 'api-key'
      : format === 'anthropic'
        ? 'x-api-key'
        : format === 'gemini'
          ? 'x-goog-api-key'
          : 'authorization'
    const headers = [
      guess,
      ...(Object.keys(KEY_HEADERS) as KeyHeader[]).filter((h) => h !== guess),
    ]
    for (const keyHeader of headers) {
      if (tries.length >= MAX_TRIES) break
      const candidateSecret = { ...secret, endpoint, format, keyHeader }
      const first = await run(candidateSecret)
      if (first.saved) return first.saved
      last = first.caught
      // The key is in the wrong place: try the next one.
      if (first.tried.status === 401 || first.tried.status === 403) continue
      // The key got through; the address may need an api-version.
      const versioned =
        format === 'openai' &&
        wantsVersion(first.tried) &&
        withApiVersion(endpoint)
      if (versioned && tries.length < MAX_TRIES) {
        const second = await run({ ...candidateSecret, endpoint: versioned })
        if (second.saved) return second.saved
        last = second.caught
      }
      // Other headers would get the same answer.
      break
    }
  }
  throw explain(tries, last)
}

/** What went wrong, in words someone can act on or pass to their AI team. */
function explain(tries: Try[], last: unknown): Error {
  const said = tries.find((tried) => tried.reason)?.reason
  const gateway = said ? ` The gateway said: ${said}` : ''
  if (tries.length && tries.every((t) => t.status === 401 || t.status === 403))
    return new AiUpstreamError(
      401,
      `The AI gateway did not accept this key in any of the usual places (Authorization, api-key, x-api-key, Ocp-Apim-Subscription-Key, x-goog-api-key). Check that the key is complete and still active, or paste the example request your AI team gave you.${gateway}`,
      said ?? '',
    )
  if (tries.some((t) => t.status === 404))
    return new AiUpstreamError(
      404,
      `The AI gateway answered, but found nothing at this address in OpenAI, Anthropic or Gemini style, also with an api-version. Check the address with your AI team, or paste the example request they gave you. If the address is right, enter the model name.${gateway}`,
      said ?? '',
    )
  return last instanceof Error
    ? last
    : new AiUpstreamError(502, 'Steerloom could not reach the AI provider.')
}
