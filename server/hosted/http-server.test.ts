// @vitest-environment node
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { proxyRequest } from './test-request'
import { hostedHttpServer } from './http-server'
import { publicAddress, publicJiraUrl } from './public-network'
let server: ReturnType<typeof hostedHttpServer>, url: string, dir: string
const handler = vi.fn(
  async (_req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (_req.url === '/api/hosted/config') res.end('{"configured":true}')
    else next()
  },
)
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'steerloom-http-test-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head></head><body>Steerloom</body></html>',
  )
  writeFileSync(join(dir, 'assets', 'app-test.js'), '/* app */')
  writeFileSync(join(dir, 'privacy.html'), '<h1>Privacy notice</h1>')
  writeFileSync(join(dir, 'terms.html'), '<h1>Terms of use</h1>')
  mkdirSync(join(dir, 'video'))
  writeFileSync(join(dir, 'video', 'film.mp4'), '0123456789')
  writeFileSync(join(dir, 'video', 'film.vtt'), 'WEBVTT')
  writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"Steerloom"}')
  mkdirSync(join(dir, 'icons'))
  writeFileSync(join(dir, 'icons', 'steerloom-192.png'), 'png')
  mkdirSync(join(dir, 'social'))
  writeFileSync(join(dir, 'social', 'steerloom-share.png'), 'png')
  writeFileSync(join(dir, '.env.local'), 'fictional-secret')
  server = hostedHttpServer('https://app.example.invalid', dir, handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error()
  url = `http://127.0.0.1:${address.port}`
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
  vi.clearAllMocks()
})
const get = (path: string, headers = {}) =>
  proxyRequest(`${url}${path}`, {
    headers: { Host: 'app.example.invalid', ...headers },
  })
it('serves the built hosted app with security headers and redirects the landing URL', async () => {
  const root = await get('/')
  expect(root.status).toBe(302)
  expect(root.headers.get('location')).toBe('/?hosted=1')
  const page = await get('/?hosted=1', { 'Sec-Fetch-Site': 'cross-site' })
  expect(await page.text()).toContain('name="steerloom-mode" content="hosted"')
  expect(page.headers.get('content-security-policy')).toContain(
    "frame-ancestors 'none'",
  )
  expect(
    (await get('/assets/app-test.js')).headers.get('cache-control'),
  ).toContain('immutable')
  const privacy = await get('/privacy.html', { 'Sec-Fetch-Site': 'cross-site' })
  expect(privacy.status).toBe(200)
  expect(await privacy.text()).toContain('Privacy notice')
  expect(privacy.headers.get('content-type')).toContain('text/html')
  // Link previews (LinkedIn) fetch the share image from another site.
  const share = await get('/social/steerloom-share.png', {
    'Sec-Fetch-Site': 'cross-site',
  })
  expect(share.status).toBe(200)
  expect(share.headers.get('content-type')).toBe('image/png')
  const terms = await get('/terms.html')
  expect(terms.status).toBe(200)
  expect(await terms.text()).toContain('Terms of use')
})
it('streams the film with byte ranges, its captions and poster types', async () => {
  const whole = await get('/video/film.mp4')
  expect(whole.status).toBe(200)
  expect(whole.headers.get('content-type')).toBe('video/mp4')
  expect(whole.headers.get('accept-ranges')).toBe('bytes')
  expect(whole.headers.get('content-length')).toBe('10')
  expect(await whole.text()).toBe('0123456789')
  const part = await get('/video/film.mp4', { Range: 'bytes=2-5' })
  expect(part.status).toBe(206)
  expect(part.headers.get('content-range')).toBe('bytes 2-5/10')
  expect(await part.text()).toBe('2345')
  const tail = await get('/video/film.mp4', { Range: 'bytes=7-' })
  expect(await tail.text()).toBe('789')
  const beyond = await get('/video/film.mp4', { Range: 'bytes=20-30' })
  expect(beyond.status).toBe(416)
  expect((await get('/video/film.vtt')).headers.get('content-type')).toContain(
    'text/vtt',
  )
  expect((await get('/video/sub/film.mp4')).status).toBe(404)
  expect((await get('/video/film.mov')).status).toBe(404)
})
it('serves the web app manifest and its icons so browsers can install it', async () => {
  const manifest = await get('/manifest.webmanifest')
  expect(manifest.status).toBe(200)
  expect(manifest.headers.get('content-type')).toContain(
    'application/manifest+json',
  )
  const icon = await get('/icons/steerloom-192.png')
  expect(icon.status).toBe(200)
  expect(icon.headers.get('content-type')).toBe('image/png')
  expect(icon.headers.get('cache-control')).toContain('max-age=86400')
})
it('never serves local account APIs, source files, secrets or unknown paths', async () => {
  for (const path of [
    '/api/auth/session',
    '/.env.local',
    '/server/hosted/main.ts',
    '/assets/%2e%2e%2f.env.local',
    '/unknown',
    '/downloads/another.tar.gz',
  ])
    expect((await get(path)).status).toBe(404)
  expect(handler).not.toHaveBeenCalled()
  expect((await get('/api/hosted/config')).status).toBe(200)
})
it('rejects forged hosts despite forwarded headers and exposes only a generic health check', async () => {
  expect(
    (
      await get('/?hosted=1', {
        Host: 'attacker.example.invalid',
        'X-Forwarded-Host': 'app.example.invalid',
      })
    ).status,
  ).toBe(403)
  expect(await (await get('/healthz')).json()).toEqual({ ok: true })
})
it('rejects private or non-HTTPS Jira targets in production', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.2',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2002:7f00:1::',
  ])
    expect(publicAddress(ip)).toBe(false)
  expect(publicAddress('8.8.8.8')).toBe(true)
  expect(publicAddress('2606:4700:4700::1111')).toBe(true)
  for (const target of [
    'http://jira.example.invalid',
    'https://127.0.0.1',
    'https://[::1]',
    'https://jira.example.invalid:8080',
  ])
    expect(() => publicJiraUrl(target)).toThrow(/public HTTPS/)
})
