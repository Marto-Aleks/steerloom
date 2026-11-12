// @vitest-environment node
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalSessions, SESSION_LIFETIME } from './sessions'
let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'steerloom-sessions-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(directory, { recursive: true, force: true })
})
const token = 'a'.repeat(64),
  other = 'b'.repeat(64)
describe('remembered local sign-in', () => {
  it('survives restart without persisting bearer cookies or extending expiry', () => {
    const store = new LocalSessions(directory)
    const entry = {
      userId: 'fictional-user',
      expires: Date.now() + SESSION_LIFETIME,
    }
    store.set(token, entry)
    const restored = new LocalSessions(directory)
    expect(restored.get(token)).toEqual(entry)
    const disk = readFileSync(join(directory, 'sessions.json'), 'utf8')
    expect(disk).not.toContain(token)
    expect(statSync(join(directory, 'sessions.json')).mode & 0o777).toBe(0o600)
    vi.spyOn(Date, 'now').mockReturnValue(entry.expires)
    expect(restored.get(token)).toBeUndefined()
  })
  it('shares revocation across instances and preserves other users', () => {
    const first = new LocalSessions(directory),
      second = new LocalSessions(directory)
    first.set(token, { userId: 'fictional-one', expires: Date.now() + 10000 })
    second.set(other, { userId: 'fictional-two', expires: Date.now() + 10000 })
    expect(first.get(other)?.userId).toBe('fictional-two')
    second.delete(token)
    expect(first.get(token)).toBeUndefined()
    expect(first.get(other)?.userId).toBe('fictional-two')
  })
  it('fails closed on corrupt files and rejects invalid lifetimes', () => {
    const store = new LocalSessions(directory)
    writeFileSync(join(directory, 'sessions.json'), 'not-json')
    expect(store.get(token)).toBeUndefined()
    expect(() =>
      store.set(token, { userId: 'fictional', expires: Infinity }),
    ).toThrow()
    expect(() =>
      store.set(token, {
        userId: 'fictional',
        expires: Date.now() + SESSION_LIFETIME + 10000,
      }),
    ).toThrow()
    expect(store.get('invalid-cookie')).toBeUndefined()
  })
})
