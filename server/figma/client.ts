import { fetch, ProxyAgent, type Dispatcher } from 'undici'
import { fetchWithRetry } from '../http/fetch-retry'
import { bypassesProxy } from '../http/no-proxy'

const API = 'https://api.figma.com'

export type FigmaFailureReason =
  | 'figma-token-rejected'
  | 'figma-file-not-visible'

export class FigmaError extends Error {
  constructor(
    message: string,
    readonly reason?: FigmaFailureReason,
  ) {
    super(message)
  }
}

export interface FigmaConfig {
  token: string
  proxyUrl?: string
  dispatcher?: Dispatcher
}

/**
 * Read-only Figma access. Only GET requests are ever sent, and only to the
 * endpoints below; the token's scopes are read-only as well.
 */
export class FigmaClient {
  private readonly dispatcher: Dispatcher | undefined

  constructor(private readonly config: FigmaConfig) {
    this.dispatcher =
      config.dispatcher ??
      (config.proxyUrl && !bypassesProxy(API)
        ? new ProxyAgent(config.proxyUrl)
        : undefined)
  }

  /** Proves the token works. Nothing from the answer is kept. */
  async verify(signal?: AbortSignal): Promise<void> {
    await this.get('/v1/me', signal)
  }

  /** The file's name, if this token can open it. */
  async fileName(key: string, signal?: AbortSignal): Promise<string> {
    const body = await this.get<{ file?: { name?: string }; name?: string }>(
      `/v1/files/${encodeURIComponent(key)}/meta`,
      signal,
      key,
    )
    const name = body.file?.name ?? body.name
    if (!name) throw notVisible(key)
    return name
  }

  private async get<T = unknown>(
    path: string,
    signal?: AbortSignal,
    fileKey?: string,
  ): Promise<T> {
    const response = await fetchWithRetry(
      () =>
        fetch(`${API}${path}`, {
          headers: {
            Accept: 'application/json',
            'X-Figma-Token': this.config.token,
          },
          dispatcher: this.dispatcher,
          signal,
        }),
      { signal },
    )
    // Figma answers 403 for a wrong or expired token, 404 for a file it hides.
    if (response.status === 403 && !fileKey)
      throw new FigmaError(
        'Figma did not accept this token. Create a new one with the read scopes listed here and connect again.',
        'figma-token-rejected',
      )
    if (fileKey && (response.status === 403 || response.status === 404))
      throw notVisible(fileKey)
    if (!response.ok)
      throw new FigmaError(`Figma answered ${response.status}. Try again.`)
    try {
      return (await response.json()) as T
    } catch {
      throw new FigmaError(
        'Figma answered with a web page instead of data. Check the network or proxy.',
      )
    }
  }
}

function notVisible(key: string): FigmaError {
  return new FigmaError(
    `This token cannot open the Figma file ${key}. Check the link, or ask the file’s owner for access.`,
    'figma-file-not-visible',
  )
}
