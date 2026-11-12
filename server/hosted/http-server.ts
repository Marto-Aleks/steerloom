import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream'
import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { hostedRequestUrl } from './request-policy'

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => Promise<void>
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
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.vtt': 'text/vtt; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}
export function hostedHttpServer(
  origin: string,
  dist: string,
  handle: Handler,
) {
  const root = resolve(dist)
  return createServer(
    { requestTimeout: 60000, headersTimeout: 15000, maxHeaderSize: 16384 },
    (request, response) => {
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.setHeader('Referrer-Policy', 'no-referrer')
      response.setHeader('Strict-Transport-Security', 'max-age=31536000')
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      )
      const fail = (status: number) => {
        response.statusCode = status
        response.end(status === 404 ? 'Not found.' : 'Request unavailable.')
      }
      const run = async () => {
        if (request.url === '/healthz' && request.method === 'GET') {
          response.setHeader('Content-Type', 'application/json')
          response.end('{"ok":true}')
          return
        }
        // Auth middleware performs callback-specific cross-site validation.
        if (request.url?.startsWith('/api/hosted/')) {
          await handle(request, response, () => fail(404))
          return
        }
        let url: URL
        try {
          // Top-level navigations may arrive from other sites. Only GET/HEAD static
          // documents bypass the fetch-site check; host/origin/path still validated.
          url = hostedRequestUrl(
            {
              ...request,
              method: request.method,
              url: request.url,
              headers: {
                ...request.headers,
                ...(request.method === 'GET' || request.method === 'HEAD'
                  ? { 'sec-fetch-site': undefined }
                  : {}),
              },
            },
            origin,
          )
        } catch {
          fail(403)
          return
        }
        if (!['GET', 'HEAD'].includes(request.method ?? '')) {
          fail(405)
          return
        }
        if (url.pathname === '/' && url.searchParams.get('hosted') !== '1') {
          url.searchParams.set('hosted', '1')
          response.statusCode = 302
          response.setHeader('Location', `/${url.search}`)
          response.end()
          return
        }
        let relative: string
        try {
          relative = decodeURIComponent(url.pathname)
        } catch {
          fail(400)
          return
        }
        if (relative === '/') relative = '/index.html'
        if (
          !/^\/(?:index\.html|about\.html|privacy\.html|terms\.html|robots\.txt|sitemap\.xml|llms\.txt|manifest\.webmanifest|assets\/[\w.-]+|brands\/[\w.-]+|icons\/[\w.-]+|social\/[\w.-]+|video\/[\w.-]+)$/.test(
            relative,
          )
        ) {
          fail(404)
          return
        }
        const type = types[extname(relative)]
        if (!type) {
          fail(404)
          return
        }
        try {
          const file = await realpath(resolve(root, `.${relative}`))
          if (!file.startsWith(`${await realpath(root)}${sep}`)) {
            fail(404)
            return
          }
          if (relative.startsWith('/video/')) {
            // The film: streamed, with byte ranges so players can seek
            // (and Safari will play at all), cached for a day.
            await streamRange(request, response, file, type)
            return
          }
          let contents = await readFile(file)
          if (relative === '/index.html')
            contents = Buffer.from(
              contents
                .toString('utf8')
                .replace(
                  '<head>',
                  '<head><meta name="steerloom-mode" content="hosted">',
                ),
            )
          response.setHeader('Content-Type', type)
          if (relative.startsWith('/assets/'))
            response.setHeader(
              'Cache-Control',
              'public, max-age=31536000, immutable',
            )
          else if (
            relative.startsWith('/icons/') ||
            relative === '/manifest.webmanifest'
          )
            response.setHeader('Cache-Control', 'public, max-age=86400')
          response.end(request.method === 'HEAD' ? undefined : contents)
        } catch {
          fail(404)
        }
      }
      void run().catch(() => {
        if (!response.headersSent) fail(500)
        else response.destroy()
      })
    },
  )
}

async function streamRange(
  request: IncomingMessage,
  response: ServerResponse,
  file: string,
  type: string,
) {
  const { size } = await stat(file)
  response.setHeader('Content-Type', type)
  response.setHeader('Accept-Ranges', 'bytes')
  response.setHeader('Cache-Control', 'public, max-age=86400')
  let start = 0
  let end = size - 1
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '')
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1])
      if (range[2]) end = Math.min(end, Number(range[2]))
    } else {
      start = Math.max(0, size - Number(range[2]))
    }
    if (start > end || start >= size) {
      response.statusCode = 416
      response.setHeader('Content-Range', `bytes */${size}`)
      response.end()
      return
    }
    response.statusCode = 206
    response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
  }
  response.setHeader('Content-Length', end - start + 1)
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  // pipeline closes the file when the player seeks or disconnects, and a
  // read error ends the response instead of crashing the process.
  pipeline(createReadStream(file, { start, end }), response, () => {})
}
