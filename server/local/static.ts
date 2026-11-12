import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

/*
 * The built app for the packaged local server: index.html for "/", hashed
 * assets with long caching, and the few public folders the app uses. Every
 * other path is a 404; nothing outside the app folder can be read.
 */

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

const ALLOWED =
  /^\/(?:index\.html|privacy\.html|terms\.html|manifest\.webmanifest|assets\/[\w.-]+|brands\/[\w.-]+|icons\/[\w.-]+)$/

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
}

export function staticFiles(dist: string) {
  const root = resolve(dist)
  return async (request: IncomingMessage, response: ServerResponse) => {
    const fail = (status: number) => {
      response.statusCode = status
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.end(status === 404 ? 'Not found.' : 'Request unavailable.')
    }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) return fail(405)
    let relative: string
    try {
      relative = decodeURIComponent(
        new URL(request.url ?? '/', 'http://local').pathname,
      )
    } catch {
      return fail(400)
    }
    if (relative === '/') relative = '/index.html'
    const type = types[extname(relative)]
    if (!ALLOWED.test(relative) || !type) return fail(404)
    try {
      const realRoot = await realpath(root)
      const file = await realpath(resolve(root, `.${relative}`))
      if (!file.startsWith(`${realRoot}${sep}`)) return fail(404)
      const contents = await readFile(file)
      response.setHeader('Content-Type', type)
      response.setHeader(
        'Cache-Control',
        relative.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      )
      response.end(request.method === 'HEAD' ? undefined : contents)
    } catch {
      fail(404)
    }
  }
}
