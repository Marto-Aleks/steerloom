// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createWorkspaceServices } from './vite-plugin'

const SECRET = 'a'.repeat(64)
let directory: string
let server: Server
let origin: string

async function start(secret = SECRET) {
  directory = mkdtempSync(join(tmpdir(), 'steerloom-start-'))
  const services = createWorkspaceServices(directory, '', null, null, {
    secret: () => secret,
    owner: { username: 'Fictional.Person', workspaceName: 'My workspace' },
  })
  server = createServer((request, response) => {
    void services.handle(request, response, () => {
      response.statusCode = 404
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server')
  origin = `http://127.0.0.1:${address.port}`
}
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(directory, { recursive: true, force: true })
})
const open = (token: string) =>
  fetch(`${origin}/api/auth/start?token=${token}`, { redirect: 'manual' })
const session = (cookie: string) =>
  fetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } }).then(
    (response) =>
      response.json() as Promise<{
        session: { workspaceName: string; user: { username: string } } | null
      }>,
  )
const cookieOf = (response: Response) =>
  response.headers.get('set-cookie')?.split(';')[0] ?? ''

it('opens straight into a new workspace on the first start, with no password', async () => {
  await start()
  const first = await open(SECRET)
  expect(first.status).toBe(302)
  expect(first.headers.get('location')).toBe('/')
  const cookie = cookieOf(first)
  expect(cookie).toBeTruthy()
  const signedIn = await session(cookie)
  expect(signedIn.session?.workspaceName).toBe('My workspace')
  expect(signedIn.session?.user.username).toBe('fictional.person')
  // The next start signs the same person in, without creating another workspace.
  const again = await session(cookieOf(await open(SECRET)))
  expect(again.session?.user.username).toBe('fictional.person')
})

it('signs an existing single account in, and nobody without the secret', async () => {
  await start()
  const registered = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      username: 'sample.lead',
      password: 'fictional-long-password',
      workspaceName: 'Fictional team',
    }),
  })
  expect(registered.status).toBe(200)
  const signedIn = await session(cookieOf(await open(SECRET)))
  expect(signedIn.session?.user.username).toBe('sample.lead')
  for (const wrong of ['', 'b'.repeat(64), SECRET.slice(1)]) {
    const refused = await open(wrong)
    expect(refused.status).toBe(302)
    expect(refused.headers.get('set-cookie')).toBeNull()
  }
})

it('leaves computers with several accounts on the sign-in page', async () => {
  await start()
  for (const username of ['first.lead', 'second.lead'])
    await fetch(`${origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({
        username,
        password: 'fictional-long-password',
        workspaceName: 'Fictional team',
      }),
    })
  const response = await open(SECRET)
  expect(response.headers.get('set-cookie')).toBeNull()
})

it('does nothing on the development server, which has no start secret', async () => {
  await start('')
  const response = await open('')
  expect(response.headers.get('set-cookie')).toBeNull()
})
