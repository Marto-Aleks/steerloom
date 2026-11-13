import { randomUUID } from 'node:crypto'
import { fetch } from 'undici'
import {
  type AiProvider,
  readDashboard,
  type WorkspaceConnection,
  type WorkspaceSession,
} from '../../src/lib/workspace/model'
import type { ConnectionSecret } from '../workspace/store'
import { aiKeySummary, type AiKeySecret } from '../ai/workspace-key'
import { credentialVault } from './credentials'
import { HostedSupabase } from './supabase'

// Fixed credential scope for the workspace AI key (never a connection id).
const AI_SCOPE = '00000000-0000-4000-8000-00000000a1a1'
const AI_MIGRATION =
  'Apply the workspace AI migration (202610210004) in Supabase before adding an AI key.'

/** Dashboards one workspace may hold. */
const MAX_DASHBOARDS = 50

export class HostedWorkspaceStore {
  private readonly vault: ReturnType<typeof credentialVault>
  constructor(
    private readonly database: HostedSupabase,
    private readonly url: string,
    private readonly secretKey: string,
    key: Buffer,
    private readonly transport: typeof fetch = fetch,
  ) {
    if (!secretKey.startsWith('sb_secret_'))
      throw new Error(
        'Configure STEERLOOM_SUPABASE_SECRET_KEY with a server-only Supabase secret key.',
      )
    this.vault = credentialVault(key)
  }
  private async rpc(name: string, input: unknown): Promise<unknown> {
    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await this.transport(`${this.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { apikey: this.secretKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    } catch {
      throw new Error('Could not reach workspace storage. Try again.')
    }
    if (!response.ok) {
      const missing = response.status === 404
      await response.body?.cancel()
      throw new Error(
        missing
          ? 'Apply the workspace connection migration in Supabase before connecting boards.'
          : 'Workspace storage denied the request. Check your membership and server configuration.',
      )
    }
    if (response.status === 204) return null
    return response.json()
  }
  async session(token: string, workspaceId: string): Promise<WorkspaceSession> {
    const identity = await this.database.identity(token)
    const role = await this.database.role(token, workspaceId)
    const workspaces = await this.database.workspaces(token)
    const workspace = workspaces.find((item) => item.id === workspaceId)
    if (!workspace) throw new Error('Workspace access is not permitted.')
    const rows = await this.database.request(
      `/rest/v1/workspace_connections?select=id,name,provider,project_key,jira_edition&workspace_id=eq.${workspaceId}`,
      token,
    )
    if (!Array.isArray(rows)) throw new Error('Could not load connections.')
    const connections: WorkspaceConnection[] = rows.map((row) => {
      if (
        !record(row) ||
        !uuid(row.id) ||
        typeof row.name !== 'string' ||
        (row.provider !== 'jira' &&
          row.provider !== 'trello' &&
          row.provider !== 'azure-devops')
      )
        throw new Error('Invalid connection metadata.')
      return {
        id: row.id,
        name: row.name,
        provider: row.provider,
        ...(typeof row.project_key === 'string'
          ? { projectKey: row.project_key }
          : {}),
        ...(row.jira_edition === 'cloud' || row.jira_edition === 'data-center'
          ? { jiraEdition: row.jira_edition }
          : {}),
      }
    })
    const dashboards = await this.database.request(
      `/rest/v1/workspace_dashboards?select=settings&workspace_id=eq.${workspaceId}`,
      token,
    )
    if (!Array.isArray(dashboards))
      throw new Error('Could not load dashboards.')
    // Older databases without the AI migration still load the workspace.
    const ai = await this.storedAi(identity.id, workspaceId).catch(() => null)
    return {
      user: { id: identity.id, username: identity.email },
      workspaceId,
      workspaceRole: role,
      workspaceName: workspace.name,
      connections,
      dashboards: dashboards.map((row) =>
        readDashboard(record(row) ? row.settings : undefined),
      ),
      ...(ai
        ? {
            ai: {
              provider: ai.provider,
              model: ai.model,
              ...(ai.endpointHost ? { endpointHost: ai.endpointHost } : {}),
            },
          }
        : {}),
    }
  }
  private async storedAi(actor: string, workspaceId: string) {
    const result = await this.rpc('steerloom_server_ai', {
      actor,
      target: workspaceId,
    })
    if (result === null) return null
    if (
      !record(result) ||
      (result.provider !== 'anthropic' &&
        result.provider !== 'openai' &&
        result.provider !== 'custom') ||
      typeof result.model !== 'string' ||
      typeof result.encrypted !== 'string' ||
      result.keyVersion !== 1
    )
      throw new Error('Invalid stored AI settings.')
    return {
      provider: result.provider as AiProvider,
      model: result.model,
      endpointHost:
        typeof result.endpointHost === 'string' ? result.endpointHost : '',
      encrypted: result.encrypted,
    }
  }
  async aiKey(
    token: string,
    workspaceId: string,
  ): Promise<AiKeySecret | undefined> {
    if (!uuid(workspaceId)) throw new Error('Choose a workspace.')
    const identity = await this.database.identity(token)
    await this.database.role(token, workspaceId)
    const stored = await this.storedAi(identity.id, workspaceId).catch(
      (caught: unknown) => {
        if (caught instanceof Error && caught.message.startsWith('Apply'))
          return null
        throw caught
      },
    )
    if (!stored) return undefined
    const value: unknown = JSON.parse(
      this.vault.decrypt(stored.encrypted, workspaceId, AI_SCOPE),
    )
    if (
      !record(value) ||
      value.provider !== stored.provider ||
      typeof value.apiKey !== 'string' ||
      typeof value.model !== 'string'
    )
      throw new Error('Invalid stored AI settings.')
    return value as unknown as AiKeySecret
  }
  async saveAiKey(token: string, workspaceId: string, secret: AiKeySecret) {
    const identity = await this.database.identity(token)
    if ((await this.database.role(token, workspaceId)) === 'member')
      throw new Error('Only owners and admins can manage the AI key.')
    const summary = aiKeySummary(secret)
    await this.rpc('steerloom_server_save_ai', {
      actor: identity.id,
      target: workspaceId,
      provider_id: summary.provider,
      model_name: summary.model,
      host: summary.endpointHost ?? null,
      ciphertext: this.vault.encrypt(
        JSON.stringify(secret),
        workspaceId,
        AI_SCOPE,
      ),
    }).catch((caught: unknown) => {
      if (caught instanceof Error && caught.message.startsWith('Apply'))
        throw new Error(AI_MIGRATION)
      throw caught
    })
  }
  async removeAiKey(token: string, workspaceId: string) {
    const identity = await this.database.identity(token)
    if ((await this.database.role(token, workspaceId)) === 'member')
      throw new Error('Only owners and admins can manage the AI key.')
    await this.rpc('steerloom_server_remove_ai', {
      actor: identity.id,
      target: workspaceId,
    })
  }
  async connection(token: string, workspaceId: string, connectionId: string) {
    if (!uuid(workspaceId) || !uuid(connectionId))
      throw new Error('Choose a workspace connection.')
    const identity = await this.database.identity(token)
    await this.database.role(token, workspaceId)
    const result = await this.rpc('steerloom_server_connection', {
      actor: identity.id,
      target: workspaceId,
      connection: connectionId,
    })
    if (
      !record(result) ||
      typeof result.encrypted !== 'string' ||
      result.keyVersion !== 1
    )
      throw new Error('Invalid stored connection.')
    const value: unknown = JSON.parse(
      this.vault.decrypt(result.encrypted, workspaceId, connectionId),
    )
    if (
      !record(value) ||
      (value.provider !== 'jira' &&
        value.provider !== 'trello' &&
        value.provider !== 'azure-devops') ||
      typeof value.name !== 'string'
    )
      throw new Error('Invalid stored connection.')
    return {
      secret: value as unknown as ConnectionSecret,
      encrypted: result.encrypted,
    }
  }
  async saveConnection(
    token: string,
    workspaceId: string,
    secret: ConnectionSecret,
    connectionId: string = randomUUID(),
  ): Promise<string> {
    const identity = await this.database.identity(token)
    const role = await this.database.role(token, workspaceId)
    if (role === 'member')
      throw new Error('Only owners and admins can manage connections.')
    await this.rpc('steerloom_server_save_connection', {
      actor: identity.id,
      target: workspaceId,
      connection: connectionId,
      connection_name: secret.name,
      provider_id: secret.provider,
      project: secret.projectKey ?? null,
      jira_kind: secret.jiraEdition ?? null,
      ciphertext: this.vault.encrypt(
        JSON.stringify(secret),
        workspaceId,
        connectionId,
      ),
    })
    return connectionId
  }
  async refreshConnection(
    token: string,
    workspaceId: string,
    connectionId: string,
    secret: ConnectionSecret,
    previous: string,
  ): Promise<boolean> {
    const identity = await this.database.identity(token)
    await this.database.role(token, workspaceId)
    return (
      (await this.rpc('steerloom_server_refresh_connection', {
        actor: identity.id,
        target: workspaceId,
        connection: connectionId,
        previous,
        ciphertext: this.vault.encrypt(
          JSON.stringify(secret),
          workspaceId,
          connectionId,
        ),
      })) === true
    )
  }
  async removeConnection(
    token: string,
    workspaceId: string,
    connectionId: string,
  ) {
    const identity = await this.database.identity(token)
    if ((await this.database.role(token, workspaceId)) === 'member')
      throw new Error('Only owners and admins can manage connections.')
    await this.rpc('steerloom_server_remove_connection', {
      actor: identity.id,
      target: workspaceId,
      connection: connectionId,
    })
  }
  async saveDashboard(token: string, workspaceId: string, value: unknown) {
    if ((await this.database.role(token, workspaceId)) === 'member')
      throw new Error('Only owners and admins can edit dashboards.')
    const dashboard = readDashboard(value)
    const session = await this.session(token, workspaceId)
    // Every request to a workspace loads its dashboards, so their number
    // has a ceiling well above what a team uses.
    if (
      session.dashboards.length >= MAX_DASHBOARDS &&
      !session.dashboards.some((item) => item.id === dashboard.id)
    )
      throw new Error(
        `A workspace holds up to ${MAX_DASHBOARDS} dashboards. Remove one first.`,
      )
    if (dashboard.provider !== 'demo') {
      const connection = session.connections.find(
        (item) => item.id === dashboard.connectionId,
      )
      if (
        !connection ||
        connection.provider !== dashboard.provider ||
        (connection.provider === 'jira' &&
          connection.projectKey !== dashboard.projectKey)
      )
        throw new Error('Dashboard does not match this workspace connection.')
    }
    await this.database.request(
      '/rest/v1/workspace_dashboards?on_conflict=workspace_id,dashboard_key',
      token,
      {
        workspace_id: workspaceId,
        dashboard_key: dashboard.id,
        connection_id:
          dashboard.provider === 'demo' ? null : dashboard.connectionId,
        settings: dashboard,
      },
      'POST',
      'resolution=merge-duplicates,return=minimal',
    )
  }
  async removeDashboard(token: string, workspaceId: string, id: string) {
    if ((await this.database.role(token, workspaceId)) === 'member')
      throw new Error('Only owners and admins can edit dashboards.')
    const query = new URLSearchParams({
      workspace_id: `eq.${workspaceId}`,
      dashboard_key: `eq.${id}`,
    })
    await this.database.request(
      `/rest/v1/workspace_dashboards?${query.toString()}`,
      token,
      undefined,
      'DELETE',
    )
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function uuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
}
