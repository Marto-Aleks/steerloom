/*
 * Reads the example request a company AI team hands out (usually a curl
 * line) so the key form can be filled from it: the address, which header
 * carries the key, the API style and the model. The key's value is never
 * taken from the example, since examples carry placeholders or someone
 * else's key.
 */
export type AiExampleFormat = 'openai' | 'anthropic' | 'gemini'
export type AiExampleKeyHeader =
  | 'authorization'
  | 'api-key'
  | 'x-api-key'
  | 'ocp-apim-subscription-key'
  | 'x-goog-api-key'

export interface AiExample {
  endpoint?: string
  model?: string
  format?: AiExampleFormat
  keyHeader?: AiExampleKeyHeader
  /** A format Steerloom does not speak, named so the person can ask for another. */
  unsupported?: string
}

const KEY_HEADERS: AiExampleKeyHeader[] = [
  'authorization',
  'api-key',
  'x-api-key',
  'ocp-apim-subscription-key',
  'x-goog-api-key',
]

export function parseAiExample(text: string): AiExample {
  const source = text.replace(/\\\r?\n/g, ' ').slice(0, 20_000)
  const result: AiExample = {}
  const urlMatch = /https?:\/\/[^\s'"`<>\\]+/i.exec(source)
  const url = urlMatch?.[0].replace(/[),.;]+$/, '')
  const headers = new Map<string, string>()
  for (const match of source.matchAll(
    /(?:-H|--header)\s+(?:'([^']*)'|"([^"]*)"|(\S+))/gi,
  )) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    const colon = raw.indexOf(':')
    if (colon > 0)
      headers.set(
        raw.slice(0, colon).trim().toLowerCase(),
        raw.slice(colon + 1).trim(),
      )
  }
  const body = readBody(source)

  result.keyHeader = KEY_HEADERS.find((name) => headers.has(name))

  if (url) {
    if (/\/responses(?:\?|$)/i.test(url))
      result.unsupported = 'the OpenAI Responses API'
    else if (/bedrock|\/converse(?:\?|$)|\/invoke(?:\?|$)/i.test(url))
      result.unsupported = 'AWS Bedrock'
    else if (/aiplatform\.googleapis\.com|:rawPredict/i.test(url))
      result.unsupported = 'Google Vertex AI'
  }
  if (!result.unsupported) {
    if (
      /:generateContent/i.test(url ?? '') ||
      (body && Array.isArray(body.contents))
    )
      result.format = 'gemini'
    else if (
      /\/messages(?:\?|$)/i.test(url ?? '') ||
      headers.has('anthropic-version')
    )
      result.format = 'anthropic'
    else if (
      /\/chat\/completions(?:\?|$)/i.test(url ?? '') ||
      (body && Array.isArray(body.messages))
    )
      result.format = 'openai'
  }

  const bodyModel = body && typeof body.model === 'string' ? body.model : ''
  const pathModel =
    /\/models\/([^/:?]+):generateContent/i.exec(url ?? '')?.[1] ??
    /\/deployments\/([^/?]+)/i.exec(url ?? '')?.[1] ??
    ''
  const model = (bodyModel || pathModel).trim()
  if (/^[\w.:/@-]{1,100}$/.test(model)) result.model = model

  if (url) {
    result.endpoint =
      result.format === 'gemini'
        ? url.replace(/\/models\/[^/:?]+:generateContent.*$/i, '')
        : url
  }
  return result
}

function readBody(source: string): Record<string, unknown> | null {
  const flag =
    /(?:-d|--data|--data-raw|--data-binary|--json)\s+(?:\$?'([\s\S]*?)'(?=\s|$)|"([\s\S]*?)"(?=\s|$))/i.exec(
      source,
    )
  const candidates = [flag?.[1], flag?.[2], source.slice(source.indexOf('{'))]
  for (const candidate of candidates) {
    if (!candidate) continue
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) continue
    try {
      const value: unknown = JSON.parse(candidate.slice(start, end + 1))
      if (value && typeof value === 'object' && !Array.isArray(value))
        return value as Record<string, unknown>
    } catch {
      /* try the next shape */
    }
  }
  return null
}
