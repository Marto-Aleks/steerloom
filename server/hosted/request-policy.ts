import type { IncomingMessage } from 'node:http'

// Render terminates TLS; authorize against operator configuration, not supplied
// X-Forwarded-Host/Proto headers. Mutations must carry the exact browser Origin.
export function hostedRequestUrl(
  request: Pick<IncomingMessage, 'headers' | 'method' | 'url'>,
  origin: string,
): URL {
  const configured = new URL(origin)
  const path = request.url ?? ''
  const read = request.method === 'GET' || request.method === 'HEAD'
  if (
    configured.protocol !== 'https:' ||
    request.headers.host !== configured.host ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    /[\r\n]/.test(path) ||
    (request.headers.origin !== undefined &&
      request.headers.origin !== configured.origin) ||
    (!read && request.headers.origin !== configured.origin) ||
    request.headers['sec-fetch-site'] === 'cross-site'
  )
    throw new Error('Use the configured Steerloom site for this request.')
  return new URL(path, configured.origin)
}
