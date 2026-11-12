import type { IncomingMessage, ServerResponse } from 'node:http'

export interface CookieOptions {
  path: string
  sameSite: 'Strict' | 'Lax'
  /** Seconds; 0 clears the cookie. */
  maxAge: number
  secure?: boolean
}

const secretValue = /^[a-f0-9]{64}$/

/** Reads a cookie that must hold a 32-byte hex secret; anything else is ignored. */
export function readSecretCookie(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const value = request.headers.cookie
    ?.split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1)
  return value && secretValue.test(value) ? value : undefined
}

/** Adds an HttpOnly cookie without dropping cookies already set on the response. */
export function appendCookie(
  response: ServerResponse,
  name: string,
  value: string,
  { path, sameSite, maxAge, secure }: CookieOptions,
) {
  const previous = response.getHeader('Set-Cookie')
  response.setHeader('Set-Cookie', [
    ...(Array.isArray(previous)
      ? previous.map(String)
      : previous
        ? [String(previous)]
        : []),
    `${name}=${value}; HttpOnly; SameSite=${sameSite}; Path=${path}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`,
  ])
}
