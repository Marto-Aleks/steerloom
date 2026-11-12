import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { appendCookie, readSecretCookie } from './cookies'

interface Entry<T> {
  data: T
  browser: string
  expires: number
}

export interface PendingAuthorizationOptions {
  /** Lax cookie binding the OAuth attempt to the initiating browser. */
  cookie: string
  path: string
  ttlMs?: number
  max?: number
  busyMessage?: string
}

/**
 * Single-use OAuth attempts keyed by `state` and bound to the browser that
 * started them. Callbacks only succeed in that browser, before expiry, once.
 */
export function pendingAuthorizations<T>({
  cookie,
  path,
  ttlMs = 10 * 60_000,
  max = 200,
  busyMessage = 'Too many pending connections. Try again shortly.',
}: PendingAuthorizationOptions) {
  const pending = new Map<string, Entry<T>>()
  const browserOf = (request: IncomingMessage) =>
    readSecretCookie(request, cookie)
  const bound = (request: IncomingMessage, state: string) => {
    const entry = pending.get(state)
    return entry && entry.browser === browserOf(request) ? entry : undefined
  }
  const setBinding = (
    response: ServerResponse,
    value: string,
    secure: boolean,
  ) =>
    appendCookie(response, cookie, value, {
      path,
      sameSite: 'Lax',
      maxAge: value ? Math.floor(ttlMs / 1000) : 0,
      secure,
    })
  return {
    /**
     * Stores a new attempt and sets its browser cookie. Expired attempts, the
     * browser's previous attempt and any `supersedes` match are discarded.
     */
    begin(
      request: IncomingMessage,
      response: ServerResponse,
      data: T,
      options: {
        secure: boolean
        state?: string
        supersedes?: (existing: T) => boolean
      },
    ): string {
      const now = Date.now()
      const previous = browserOf(request)
      for (const [key, entry] of pending)
        if (
          entry.expires <= now ||
          entry.browser === previous ||
          options.supersedes?.(entry.data)
        )
          pending.delete(key)
      if (pending.size >= max) throw new Error(busyMessage)
      const state = options.state ?? randomBytes(32).toString('hex')
      const browser = randomBytes(32).toString('hex')
      pending.set(state, { data, browser, expires: now + ttlMs })
      setBinding(response, browser, options.secure)
      return state
    },
    /** Returns a live attempt for this browser without consuming it. */
    peek(request: IncomingMessage, state: string): T | undefined {
      const entry = bound(request, state)
      return entry && entry.expires > Date.now() ? entry.data : undefined
    },
    /**
     * Consumes the attempt before any provider call so a state can never be
     * replayed, and clears the browser cookie. Returns undefined unless the
     * attempt belongs to this browser and has not expired.
     */
    consume(
      request: IncomingMessage,
      response: ServerResponse,
      state: string,
      secure: boolean,
    ): T | undefined {
      const entry = bound(request, state)
      if (entry) pending.delete(state)
      setBinding(response, '', secure)
      return entry && entry.expires > Date.now() ? entry.data : undefined
    },
  }
}
