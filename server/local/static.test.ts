// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { proxyRequest } from '../hosted/test-request'
import { staticFiles } from './static'

let server: Server, url: string, dir: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'steerloom-local-static-'))
  mkdirSync(join(dir, 'app', 'assets'), { recursive: true })
  writeFileSync(join(dir, 'app', 'index.html'), '<html>Steerloom</html>')
  writeFileSync(join(dir, 'app', 'assets', 'app-1.js'), '/* app */')
  writeFileSync(join(dir, 'secret.txt'), 'not for the browser')
  const files = staticFiles(join(dir, 'app'))
  server = createServer((req, res) => void files(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error()
  url = `http://127.0.0.1:${address.port}`
})
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
})

it('serves the app and its hashed assets', async () => {
  const index = await proxyRequest(`${url}/`)
  expect(index.status).toBe(200)
  expect(await index.text()).toContain('Steerloom')
  const asset = await proxyRequest(`${url}/assets/app-1.js`)
  expect(asset.headers.get('cache-control')).toContain('immutable')
})

it('serves nothing outside the app folder or the allowed paths', async () => {
  for (const path of [
    '/assets/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/src/main.tsx',
    '/package.json',
    '/.flowlens/workspace.json',
  ])
    expect((await proxyRequest(`${url}${path}`)).status).toBe(404)
  expect(
    (await proxyRequest(`${url}/`, { method: 'POST', body: '{}' })).status,
  ).toBe(405)
})
