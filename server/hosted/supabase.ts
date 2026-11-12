import { createHash } from 'node:crypto'
import { fetch } from 'undici'
import type { HostedConfig } from './config'

type Transport = typeof fetch
export interface HostedIdentity {
  id: string
  email: string
}
export interface HostedWorkspace {
  id: string
  name: string
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)

/**
 * How long a checked identity is reused for the same access token. One page
 * load asks for the identity many times (workspaces, role, invitations…),
 * each costing two Supabase calls. A disabled account or unconfirmed email
 * still takes effect within this window.
 */
const IDENTITY_TTL_MS = 30_000
const IDENTITY_ENTRIES = 1000

// Only caller JWTs are used for database requests: RLS remains in effect.
// Never accept an identity or role supplied in request JSON as authentication.
export class HostedSupabase {
  constructor(
    private readonly config: Pick<
      HostedConfig,
      'supabaseUrl' | 'publishableKey'
    >,
    private readonly transport: Transport = fetch,
    private readonly now: () => number = Date.now,
  ) {}
  /** Keyed by a hash of the token, so no token is kept in memory twice. */
  private readonly identities = new Map<
    string,
    { at: number; identity: Promise<HostedIdentity> }
  >()
  async request(
    path: string,
    accessToken: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
    prefer?: string,
  ): Promise<unknown> {
    if (
      !accessToken ||
      accessToken.length > 16384 ||
      /[\r\n]/.test(accessToken)
    )
      throw new Error('Sign in to continue.')
    let response: Awaited<ReturnType<Transport>>
    try {
      response = await this.transport(`${this.config.supabaseUrl}${path}`, {
        method,
        headers: {
          ...(prefer ? { Prefer: prefer } : {}),
          apikey: this.config.publishableKey,
          Authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      })
    } catch {
      // Network errors may contain URLs or request details. Never forward them.
      // Do not retry writes: the server may already have committed a mutation.
      throw new Error(
        'Could not reach the workspace service. Check your connection or VPN, then try again.',
      )
    }
    if (!response.ok) {
      await response.body?.cancel()
      // Do not forward provider bodies, auth tokens, SQL errors or configuration.
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'Sign in or request workspace access.'
          : 'The account service is unavailable. Try again.',
      )
    }
    if (response.status === 204) return null
    // PostgREST can acknowledge a minimal insert/upsert with HTTP 201 (or 200)
    // and no JSON body. Success must not depend on parsing that empty body.
    if (
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) &&
      prefer?.split(',').some((value) => value.trim() === 'return=minimal')
    ) {
      await response.body?.cancel()
      return null
    }
    try {
      return await response.json()
    } catch {
      throw new Error(
        'The workspace service response could not be loaded. Try again.',
      )
    }
  }
  identity(accessToken: string): Promise<HostedIdentity> {
    const key = createHash('sha256').update(accessToken).digest('base64url')
    const cached = this.identities.get(key)
    if (cached && this.now() - cached.at < IDENTITY_TTL_MS)
      return cached.identity
    this.identities.delete(key)
    if (this.identities.size >= IDENTITY_ENTRIES) {
      const oldest = this.identities.keys().next().value
      if (oldest !== undefined) this.identities.delete(oldest)
    }
    // Shared while in flight, so parallel requests ask Supabase once; a
    // failure is never reused.
    const identity = this.checkIdentity(accessToken)
    this.identities.set(key, { at: this.now(), identity })
    identity.catch(() => {
      if (this.identities.get(key)?.identity === identity)
        this.identities.delete(key)
    })
    return identity
  }
  private async checkIdentity(accessToken: string): Promise<HostedIdentity> {
    const user = await this.request('/auth/v1/user', accessToken)
    if (
      !record(user) ||
      !uuid(user.id) ||
      typeof user.email !== 'string' ||
      !user.email_confirmed_at ||
      user.is_anonymous === true
    )
      throw new Error('Verify your email before continuing.')
    const active = await this.request(
      '/rest/v1/rpc/steerloom_active_user',
      accessToken,
      {},
    )
    if (active !== true) throw new Error('This account does not have access.')
    return { id: user.id, email: user.email }
  }
  async workspaces(accessToken: string): Promise<HostedWorkspace[]> {
    await this.identity(accessToken)
    const rows = await this.request(
      '/rest/v1/workspaces?select=id,name&order=created_at.asc',
      accessToken,
    )
    const invalid = new Error('Could not load your workspaces.')
    if (!Array.isArray(rows)) throw invalid
    return (rows as unknown[]).map((row) => {
      if (!record(row) || !uuid(row.id) || typeof row.name !== 'string')
        throw invalid
      return { id: row.id, name: row.name }
    })
  }
  async createWorkspace(accessToken: string, name: string): Promise<string> {
    await this.identity(accessToken)
    if (!name.trim() || name.length > 100)
      throw new Error('Enter a workspace name of up to 100 characters.')
    const id = await this.request(
      '/rest/v1/rpc/steerloom_create_workspace',
      accessToken,
      { workspace_name: name.trim() },
    )
    if (!uuid(id)) throw new Error('Could not create your workspace.')
    return id
  }
  async invitations(
    accessToken: string,
  ): Promise<Array<{ id: string; workspaceId: string; role: string }>> {
    const identity = await this.identity(accessToken)
    const query = new URLSearchParams({
      select: 'id,workspace_id,role',
      email: `eq.${identity.email.toLowerCase()}`,
      accepted_at: 'is.null',
      revoked_at: 'is.null',
      expires_at: `gt.${new Date().toISOString()}`,
    })
    const rows = await this.request(
      `/rest/v1/workspace_invitations?${query.toString()}`,
      accessToken,
    )
    const invalid = new Error('Could not load invitations.')
    if (!Array.isArray(rows)) throw invalid
    return (rows as unknown[]).map((row) => {
      if (
        !record(row) ||
        !uuid(row.id) ||
        !uuid(row.workspace_id) ||
        (row.role !== 'admin' && row.role !== 'member')
      )
        throw invalid
      return { id: row.id, workspaceId: row.workspace_id, role: row.role }
    })
  }
  async acceptInvitation(
    accessToken: string,
    invitationId: string,
  ): Promise<string> {
    await this.identity(accessToken)
    if (!uuid(invitationId)) throw new Error('Choose an invitation.')
    const id = await this.request(
      '/rest/v1/rpc/steerloom_accept_invitation',
      accessToken,
      { invitation: invitationId },
    )
    if (!uuid(id)) throw new Error('Could not join the workspace.')
    return id
  }
  async role(
    accessToken: string,
    workspaceId: string,
  ): Promise<'owner' | 'admin' | 'member'> {
    await this.identity(accessToken)
    if (!uuid(workspaceId)) throw new Error('Choose a workspace.')
    const role = await this.request(
      '/rest/v1/rpc/steerloom_role',
      accessToken,
      { target: workspaceId },
    )
    if (role !== 'owner' && role !== 'admin' && role !== 'member')
      throw new Error('Workspace access is not permitted.')
    return role
  }
}
