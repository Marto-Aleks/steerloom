// @vitest-environment node
import { expect, it } from 'vitest'
import { compareVersions, readRelease } from '../http/release'
import { updateChecker } from './update-check'

it('orders date versions, including several releases a day', () => {
  expect(compareVersions('2026.10.28', '2026.10.27')).toBeGreaterThan(0)
  expect(compareVersions('2026.10.27.2', '2026.10.27')).toBeGreaterThan(0)
  expect(compareVersions('2026.9.30', '2026.10.1')).toBeLessThan(0)
  expect(compareVersions('2026.10.27', '2026.10.27')).toBe(0)
})

it('only accepts a well-formed answer, with short notes', () => {
  expect(readRelease({ version: 'latest' })).toBeNull()
  expect(readRelease(null)).toBeNull()
  expect(
    readRelease({ version: '2026.11.1', notes: ['x'.repeat(500), 7, 'ok'] }),
  ).toEqual({ version: '2026.11.1', notes: ['x'.repeat(200), 'ok'] })
})

function fakeSite(answer: () => unknown) {
  const asked: string[] = []
  const request = (url: string) => {
    asked.push(url)
    const value = answer()
    if (value instanceof Error) return Promise.reject(value)
    return Promise.resolve({ ok: true, json: () => Promise.resolve(value) })
  }
  return { asked, request }
}

it('offers an update only when the site has a newer version, asking with nothing attached', async () => {
  const site = fakeSite(() => ({ version: '2026.11.2', notes: ['New'] }))
  const updates = updateChecker({
    current: '2026.10.27',
    origin: 'https://steerloom.example',
    request: site.request,
  })
  await updates.check()
  expect(site.asked).toEqual(['https://steerloom.example/api/hosted/version'])
  expect(await updates.state()).toEqual({
    current: '2026.10.27',
    available: true,
    latest: '2026.11.2',
    notes: ['New'],
    updateUrl: 'https://steerloom.example/?hosted=1&page=local',
  })
  const same = updateChecker({
    current: '2026.11.2',
    request: fakeSite(() => ({ version: '2026.11.2' })).request,
  })
  await same.check()
  expect((await same.state()).available).toBe(false)
})

it('stays quiet offline and checks again when the connection is back, at most once a minute', async () => {
  let online = false
  let clock = 0
  const site = fakeSite(() =>
    online ? { version: '2026.12.1' } : new Error('offline'),
  )
  const updates = updateChecker({
    current: '2026.10.27',
    request: site.request,
    now: () => clock,
  })
  await updates.check()
  expect((await updates.state()).available).toBe(false)
  online = true
  clock = 30_000
  expect((await updates.state(true)).available).toBe(false)
  expect(site.asked).toHaveLength(1)
  clock = 61_000
  expect((await updates.state(true)).available).toBe(true)
  expect(site.asked).toHaveLength(2)
})

it('fetches the update command from the site and refuses odd answers', async () => {
  const answers: unknown[] = [
    {
      command: 'curl -fsSL "https://x/install.sh?t=1&u=1" | sh',
      windowsCommand: 'irm x | iex',
    },
    { command: 'x'.repeat(500), windowsCommand: 'y' },
    new Error('offline'),
  ]
  const site = fakeSite(() => answers.shift())
  const updates = updateChecker({
    current: '2026.10.27',
    request: site.request,
  })
  expect(await updates.command()).toEqual({
    command: 'curl -fsSL "https://x/install.sh?t=1&u=1" | sh',
    windowsCommand: 'irm x | iex',
  })
  expect(await updates.command()).toBeNull()
  expect(await updates.command()).toBeNull()
  expect(
    site.asked.every((url) => url.endsWith('/api/hosted/update-command')),
  ).toBe(true)
})
