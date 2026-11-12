import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendCookie, readSecretCookie } from './cookies'
import { pendingAuthorizations } from './pending-authorizations'
import { attemptLimiter } from './rate-limit'

const secret = 'a'.repeat(64)
const request = (cookie?: string) =>
  ({ headers: cookie ? { cookie } : {} }) as IncomingMessage
function response() {
  const headers = new Map<string, unknown>()
  return {
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    setHeader: (name: string, value: unknown) =>
      headers.set(name.toLowerCase(), value),
    cookies: () => (headers.get('set-cookie') as string[] | undefined) ?? [],
  } as unknown as ServerResponse & { cookies: () => string[] }
}
const browserCookie = (res: { cookies: () => string[] }, name: string) =>
  res
    .cookies()
    .find((value) => value.startsWith(`${name}=`))!
    .split(';')[0]!

afterEach(() => vi.useRealTimers())

describe('cookies', () => {
  it('reads only 32-byte hex secrets', () => {
    expect(readSecretCookie(request(`other=1; sid=${secret}`), 'sid')).toBe(
      secret,
    )
    expect(readSecretCookie(request('sid=short'), 'sid')).toBeUndefined()
    expect(readSecretCookie(request(`xsid=${secret}`), 'sid')).toBeUndefined()
    expect(readSecretCookie(request(), 'sid')).toBeUndefined()
  })

  it('appends cookies instead of replacing earlier ones', () => {
    const res = response()
    appendCookie(res, 'one', secret, {
      path: '/',
      sameSite: 'Strict',
      maxAge: 60,
    })
    appendCookie(res, 'two', '', {
      path: '/api',
      sameSite: 'Lax',
      maxAge: 0,
      secure: true,
    })
    expect(res.cookies()).toEqual([
      `one=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=60`,
      'two=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0; Secure',
    ])
  })
})

describe('pending authorizations', () => {
  const store = () =>
    pendingAuthorizations<{ user: string }>({ cookie: 'tx', path: '/cb' })

  it('binds attempts to the initiating browser and consumes them once', () => {
    const pending = store()
    const started = response()
    const state = pending.begin(
      request(),
      started,
      { user: 'a' },
      { secure: true },
    )
    const cookie = browserCookie(started, 'tx')
    expect(started.cookies()[0]).toContain('SameSite=Lax; Path=/cb')

    expect(pending.consume(request(), response(), state, true)).toBeUndefined()
    expect(pending.peek(request(cookie), state)).toEqual({ user: 'a' })
    const finished = response()
    expect(pending.consume(request(cookie), finished, state, true)).toEqual({
      user: 'a',
    })
    expect(finished.cookies()[0]).toMatch(/^tx=; .*Max-Age=0; Secure$/)
    expect(
      pending.consume(request(cookie), response(), state, true),
    ).toBeUndefined()
  })

  it('rejects expired attempts and replaces superseded ones', () => {
    vi.useFakeTimers()
    const pending = store()
    const first = response()
    const old = pending.begin(
      request(),
      first,
      { user: 'a' },
      { secure: false },
    )
    const next = pending.begin(
      request(),
      response(),
      { user: 'a' },
      { secure: false, supersedes: (data) => data.user === 'a' },
    )
    expect(pending.peek(request(browserCookie(first, 'tx')), old)).toBe(
      undefined,
    )
    const second = response()
    const late = pending.begin(
      request(),
      second,
      { user: 'b' },
      { secure: false, state: 'custom-state' },
    )
    expect(late).toBe('custom-state')
    vi.advanceTimersByTime(10 * 60_000)
    expect(
      pending.consume(
        request(browserCookie(second, 'tx')),
        response(),
        late,
        false,
      ),
    ).toBeUndefined()
    expect(next).not.toBe(old)
  })

  it('caps concurrent attempts', () => {
    const pending = pendingAuthorizations<object>({
      cookie: 'tx',
      path: '/',
      max: 1,
      busyMessage: 'Busy.',
    })
    pending.begin(request(), response(), {}, { secure: false })
    expect(() =>
      pending.begin(request(), response(), {}, { secure: false }),
    ).toThrow('Busy.')
  })
})

describe('attempt limiter', () => {
  it('blocks after the limit until the window expires or is reset', () => {
    vi.useFakeTimers()
    const limiter = attemptLimiter({ windowMs: 1000 })
    expect(limiter.hit('ip', 2)).toBe(true)
    expect(limiter.hit('ip', 2)).toBe(true)
    expect(limiter.hit('ip', 2)).toBe(false)
    expect(limiter.hit('other', 2)).toBe(true)
    limiter.reset('ip')
    expect(limiter.hit('ip', 2)).toBe(true)
    limiter.hit('ip', 2)
    limiter.hit('ip', 2)
    vi.advanceTimersByTime(1000)
    expect(limiter.hit('ip', 2)).toBe(true)
  })

  it('refuses new keys beyond capacity but keeps counting known keys', () => {
    const limiter = attemptLimiter({ capacity: 1 })
    expect(limiter.hit('a', 5)).toBe(true)
    expect(limiter.hit('b', 5)).toBe(false)
    expect(limiter.hit('a', 5)).toBe(true)
  })
})
