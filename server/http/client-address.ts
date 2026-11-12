import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'

export type ClientAddress = (request: IncomingMessage) => string

// Only headers that a fronting proxy overwrites with a single client address.
const supportedHeaders = new Set(['cf-connecting-ip'])
/** Set by the Cloudflare rule to STEERLOOM_EDGE_SECRET on every request. */
export const EDGE_SECRET_HEADER = 'x-steerloom-edge'

const digest = (value: string) => createHash('sha256').update(value).digest()

/**
 * Resolves the client address used for rate limiting. Behind a proxy the
 * socket address is the proxy, which would make limits global across users.
 * A header is trusted only when the operator names it explicitly
 * (STEERLOOM_CLIENT_IP_HEADER) and only if it holds a valid IP address.
 *
 * With an edge secret (STEERLOOM_EDGE_SECRET), the header is trusted only on
 * requests that carry the secret, which only Cloudflare adds. Someone who
 * reaches the server another way and sets the header themselves is counted
 * by the socket address instead, so they cannot dodge the limits.
 */
export function clientAddress(
  header?: string,
  edgeSecret?: string,
): ClientAddress {
  const name = header?.trim().toLowerCase()
  if (name && !supportedHeaders.has(name))
    throw new Error(
      `STEERLOOM_CLIENT_IP_HEADER supports only: ${[...supportedHeaders].join(', ')}.`,
    )
  const secret = edgeSecret?.trim() ? digest(edgeSecret.trim()) : undefined
  const fromEdge = (request: IncomingMessage) => {
    if (!secret) return true
    const sent = request.headers[EDGE_SECRET_HEADER]
    return typeof sent === 'string' && timingSafeEqual(digest(sent), secret)
  }
  return (request) => {
    const value = name && fromEdge(request) ? request.headers[name] : undefined
    if (typeof value === 'string' && isIP(value.trim())) return value.trim()
    return request.socket.remoteAddress ?? 'unknown'
  }
}
