import { createHash, randomBytes } from 'node:crypto'
import { fetch } from 'undici'
import { HostedSupabase } from './supabase'

export interface SupabaseAuthConfig {
  origin: string
  supabaseUrl: string
  publishableKey: string
}
export interface SupabaseTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}
export interface SupabaseAuthProvider {
  database: HostedSupabase
  authorize(verifier: string): string
  exchange(code: string, verifier: string): Promise<SupabaseTokens>
  login(email: string, password: string): Promise<SupabaseTokens>
  register(email: string, password: string, verifier: string): Promise<void>
  /** Sends a new sign-up confirmation link; silent for unknown or confirmed emails. */
  resendConfirmation(email: string, verifier: string): Promise<void>
  /** Sends a password reset link; silent for unknown emails. */
  recover(email: string, verifier: string): Promise<void>
  /** Sets a new password for the signed-in person. */
  updatePassword(accessToken: string, password: string): Promise<void>
  refresh(refreshToken: string): Promise<SupabaseTokens>
  logout(accessToken: string): Promise<void>
}
export function loadSupabaseAuthConfig(
  env: Record<string, string>,
): SupabaseAuthConfig | null {
  const rawUrl = env.STEERLOOM_SUPABASE_URL?.trim()
  const publishableKey = env.STEERLOOM_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!rawUrl && !publishableKey) return null
  let url: URL, origin: URL
  try {
    url = new URL(rawUrl ?? '')
    origin = new URL(env.STEERLOOM_AUTH_ORIGIN || 'http://127.0.0.1:5173')
  } catch {
    throw new Error(
      'Check the Supabase URL and account-test origin in .env.local.',
    )
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !publishableKey?.startsWith('sb_publishable_')
  )
    throw new Error(
      'Set the Supabase HTTPS project URL and publishable key in .env.local.',
    )
  // This integration is for loopback testing. Public deployment is a separate server.
  if (
    origin.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('Account testing requires an HTTP loopback origin.')
  return { origin: origin.origin, supabaseUrl: url.origin, publishableKey }
}
export const createVerifier = () => randomBytes(32).toString('base64url')
const challenge = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url')
export function supabaseAuthProvider(
  config: SupabaseAuthConfig,
  transport: typeof fetch = fetch,
): SupabaseAuthProvider {
  const callback = `${config.origin}/api/hosted/auth/callback`
  const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value)
  const parseTokens = (value: unknown): SupabaseTokens => {
    if (
      !record(value) ||
      typeof value.access_token !== 'string' ||
      !value.access_token ||
      typeof value.refresh_token !== 'string' ||
      !value.refresh_token ||
      typeof value.expires_in !== 'number' ||
      value.expires_in <= 0 ||
      !Number.isFinite(value.expires_in)
    )
      throw new Error('Sign-in could not be completed. Try again.')
    return {
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
      expiresAt: Date.now() + Math.min(value.expires_in, 86400) * 1000,
    }
  }
  async function request(
    path: string,
    body?: unknown,
    accessToken?: string,
    method: 'POST' | 'PUT' = 'POST',
  ): Promise<unknown> {
    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await transport(`${config.supabaseUrl}/auth/v1${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          apikey: config.publishableKey,
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new Error(
        'Could not reach the account service. Check your connection and try again.',
      )
    }
    if (!response.ok) {
      const status = response.status
      // Consume only a documented machine code, never expose a raw provider body.
      let code: unknown
      try {
        const value: unknown = await response.json()
        if (record(value)) code = value.error_code ?? value.code
      } catch {
        /* No body. */
      }
      if (code === 'email_not_confirmed')
        throw new Error(
          'Confirm your email before signing in. Check your inbox.',
        )
      if (code === 'over_email_send_rate_limit' || status === 429)
        throw new Error(
          'Too many attempts. Wait a few minutes before trying again.',
        )
      if (
        status >= 500 &&
        (path.startsWith('/signup') || code === 'unexpected_failure')
      )
        throw new Error(
          'The confirmation email could not be sent. Try again in a few minutes; if it keeps failing, the email service needs attention.',
        )
      if (code === 'weak_password')
        throw new Error(
          'Choose a stronger password: at least 12 characters, not a common one.',
        )
      if (code === 'same_password')
        throw new Error('Choose a password different from your current one.')
      if (code === 'hook_error' || code === 'hook_timeout')
        throw new Error(
          'The account service could not complete signup. Try again later.',
        )
      throw new Error(
        'Sign-in was not completed. Check your email and password and try again.',
      )
    }
    if (response.status === 204) return null
    try {
      return await response.json()
    } catch {
      throw new Error('The account service returned an invalid response.')
    }
  }
  return {
    database: new HostedSupabase(config, transport),
    authorize(verifier) {
      const url = new URL(`${config.supabaseUrl}/auth/v1/authorize`)
      url.search = new URLSearchParams({
        provider: 'google',
        redirect_to: callback,
        code_challenge: challenge(verifier),
        code_challenge_method: 's256',
      }).toString()
      return url.href
    },
    async exchange(code, verifier) {
      return parseTokens(
        await request('/token?grant_type=pkce', {
          auth_code: code,
          code_verifier: verifier,
        }),
      )
    },
    async login(email, password) {
      return parseTokens(
        await request('/token?grant_type=password', { email, password }),
      )
    },
    async register(email, password, verifier) {
      await request(`/signup?redirect_to=${encodeURIComponent(callback)}`, {
        email,
        password,
        code_challenge: challenge(verifier),
        code_challenge_method: 's256',
      })
    },
    async resendConfirmation(email, verifier) {
      await request(`/resend?redirect_to=${encodeURIComponent(callback)}`, {
        type: 'signup',
        email,
        code_challenge: challenge(verifier),
        code_challenge_method: 's256',
      })
    },
    async recover(email, verifier) {
      await request(`/recover?redirect_to=${encodeURIComponent(callback)}`, {
        email,
        code_challenge: challenge(verifier),
        code_challenge_method: 's256',
      })
    },
    async updatePassword(accessToken, password) {
      await request('/user', { password }, accessToken, 'PUT')
    },
    async refresh(refreshToken) {
      return parseTokens(
        await request('/token?grant_type=refresh_token', {
          refresh_token: refreshToken,
        }),
      )
    },
    async logout(accessToken) {
      await request('/logout?scope=local', undefined, accessToken)
    },
  }
}
