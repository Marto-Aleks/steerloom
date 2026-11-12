import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  SavedDashboard,
  WorkspaceAiSettings,
  WorkspaceGithubSettings,
  WorkspaceFigmaSettings,
  WorkspaceConnection,
  WorkspaceSession,
} from '../../src/lib/workspace/model'
import { aiKeySummary, type AiKeySecret } from '../ai/workspace-key'
import { githubSummary, type GithubSecret } from '../github/workspace-github'
import { figmaSummary, type FigmaSecret } from '../figma/workspace-figma'

const deriveKey = promisify(scrypt)
interface StoredUser {
  id: string
  username: string
  salt?: string
  passwordHash?: string
  google?: { subject: string; email: string }
  needsWorkspaceName?: boolean
  /** Created by the start link on this computer: no password, signed in by the app icon. */
  localOwner?: boolean
  workspaceName: string
  connections: StoredConnection[]
  dashboards: SavedDashboard[]
  ai?: WorkspaceAiSettings & { encrypted: string }
  github?: WorkspaceGithubSettings & { encrypted: string }
  figma?: WorkspaceFigmaSettings & { encrypted: string }
}
export interface ConnectionSecret {
  provider: 'jira' | 'trello' | 'azure-devops'
  name: string
  baseUrl?: string
  token?: string
  apiKey?: string
  projectKey?: string
  /** Legacy machine-configuration marker; such connections must be reconnected. */
  localId?: string
  cloudId?: string
  /** Jira Cloud API-token connections: the Atlassian account email. */
  email?: string
  jiraEdition?: 'cloud' | 'data-center'
  /** Azure Boards: the project name (baseUrl is the organisation or collection URL). */
  project?: string
  refreshToken?: string
  expiresAt?: number
}
interface StoredConnection extends WorkspaceConnection {
  encrypted: string
}
interface StoredData {
  users: StoredUser[]
}

export class WorkspaceStore {
  private readonly key: Buffer
  private readonly file: string
  private data: StoredData
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.file = join(directory, 'workspace.json')
    const keyFile = join(directory, 'credentials.key')
    if (!existsSync(keyFile))
      writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' })
    this.key = readFileSync(keyFile)
    if (this.key.length !== 32) throw new Error('Invalid local credential key.')
    this.data = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, 'utf8')) as StoredData)
      : { users: [] }
  }
  async register(
    username: string,
    password: string,
    workspaceName: string,
  ): Promise<string> {
    username = username.trim().toLowerCase()
    if (!/^[a-z0-9._-]{3,40}$/.test(username))
      throw new Error(
        'Use 3–40 letters, numbers, dots, hyphens, or underscores for your username.',
      )
    if (password.length < 12 || password.length > 128)
      throw new Error('Use a password of 12–128 characters.')
    if (!workspaceName.trim() || workspaceName.length > 100)
      throw new Error('Enter a workspace name of up to 100 characters.')
    if (this.data.users.some((user) => user.username === username))
      throw new Error('That username is already in use.')
    const salt = randomBytes(16).toString('hex')
    const hash = (await deriveKey(password, salt, 64)) as Buffer
    // Check again after the async password derivation to prevent duplicate accounts.
    if (this.data.users.some((user) => user.username === username))
      throw new Error('That username is already in use.')
    const id = randomUUID()
    this.data.users.push({
      id,
      username,
      salt,
      passwordHash: hash.toString('hex'),
      workspaceName: workspaceName.trim(),
      connections: [],
      dashboards: [],
    })
    this.save()
    return id
  }
  /**
   * The person the app icon's start link signs in: this computer's owner
   * workspace (created on the first start, no password), else the only
   * account. With several accounts and no owner, nobody: they sign in.
   */
  startUser(owner: {
    username: string
    workspaceName: string
  }): string | undefined {
    const existing = this.data.users.find((user) => user.localOwner)
    if (existing) return existing.id
    if (this.data.users.length === 1) return this.data.users[0]!.id
    if (this.data.users.length > 1) return undefined
    const wanted = owner.username.trim().toLowerCase()
    const username = /^[a-z0-9._-]{3,40}$/.test(wanted) ? wanted : 'owner'
    const id = randomUUID()
    this.data.users.push({
      id,
      username,
      localOwner: true,
      workspaceName: owner.workspaceName,
      connections: [],
      dashboards: [],
    })
    this.save()
    return id
  }
  async login(username: string, password: string): Promise<string> {
    const user = this.data.users.find(
      (candidate) => candidate.username === username.trim().toLowerCase(),
    )
    const hash = (await deriveKey(
      password,
      user?.salt ?? 'flowlens-unknown-user',
      64,
    )) as Buffer
    if (
      !user?.passwordHash ||
      !timingSafeEqual(hash, Buffer.from(user.passwordHash, 'hex'))
    )
      throw new Error('Incorrect username or password.')
    return user.id
  }
  googleUser(subject: string): string | undefined {
    return this.data.users.find((user) => user.google?.subject === subject)?.id
  }
  signInGoogle(subject: string, email: string): string {
    const existing = this.googleUser(subject)
    if (existing) return existing
    const id = randomUUID()
    this.data.users.push({
      id,
      username: `google-${id.slice(0, 12)}`,
      google: { subject, email },
      workspaceName: 'My workspace',
      needsWorkspaceName: true,
      connections: [],
      dashboards: [],
    })
    this.save()
    return id
  }
  linkGoogle(id: string, subject: string, email: string) {
    const owner = this.googleUser(subject)
    const user = this.user(id)
    if (
      (owner && owner !== id) ||
      (user.google && user.google.subject !== subject)
    )
      throw new Error('Google identity is already linked.')
    user.google = { subject, email }
    this.save()
  }
  nameWorkspace(id: string, name: string) {
    if (!name.trim() || name.length > 100)
      throw new Error('Enter a workspace name of up to 100 characters.')
    const user = this.user(id)
    user.workspaceName = name.trim()
    delete user.needsWorkspaceName
    this.save()
  }
  session(id: string): WorkspaceSession {
    const user = this.user(id)
    return structuredClone({
      user: {
        id: user.id,
        username: user.username,
        ...(user.google
          ? { googleLinked: true, googleEmail: user.google.email }
          : {}),
      },
      ...(user.needsWorkspaceName ? { needsWorkspaceName: true } : {}),
      workspaceName: user.workspaceName,
      connections: user.connections.map(
        ({ id, name, provider, projectKey, jiraEdition }) => ({
          id,
          name,
          provider,
          projectKey,
          ...(jiraEdition ? { jiraEdition } : {}),
        }),
      ),
      dashboards: user.dashboards,
      ...(user.ai
        ? {
            ai: {
              provider: user.ai.provider,
              model: user.ai.model,
              ...(user.ai.endpointHost
                ? { endpointHost: user.ai.endpointHost }
                : {}),
            },
          }
        : {}),
      ...(user.github ? { github: storedGithub(user.github) } : {}),
      ...(user.figma ? { figma: figmaSummary() } : {}),
    })
  }
  /** Users with a saved AI key: for local tools that run without a session. */
  aiUserIds(): string[] {
    return this.data.users.filter((user) => user.ai).map((user) => user.id)
  }
  aiKey(userId: string): AiKeySecret | undefined {
    const stored = this.user(userId).ai
    if (!stored) return undefined
    return JSON.parse(
      this.decrypt(stored.encrypted, `${userId}:ai`),
    ) as AiKeySecret
  }
  saveAiKey(userId: string, secret: AiKeySecret) {
    this.user(userId).ai = {
      ...aiKeySummary(secret),
      encrypted: this.encrypt(JSON.stringify(secret), `${userId}:ai`),
    }
    this.save()
  }
  removeAiKey(userId: string) {
    delete this.user(userId).ai
    this.save()
  }
  githubKey(userId: string): GithubSecret | undefined {
    const stored = this.user(userId).github
    if (!stored) return undefined
    return JSON.parse(
      this.decrypt(stored.encrypted, `${userId}:github`),
    ) as GithubSecret
  }
  saveGithubKey(userId: string, secret: GithubSecret) {
    this.user(userId).github = {
      ...githubSummary(secret),
      encrypted: this.encrypt(JSON.stringify(secret), `${userId}:github`),
    }
    this.save()
  }
  removeGithubKey(userId: string) {
    delete this.user(userId).github
    this.save()
  }
  figmaKey(userId: string): FigmaSecret | undefined {
    const stored = this.user(userId).figma
    if (!stored) return undefined
    return JSON.parse(
      this.decrypt(stored.encrypted, `${userId}:figma`),
    ) as FigmaSecret
  }
  saveFigmaKey(userId: string, secret: FigmaSecret) {
    this.user(userId).figma = {
      ...figmaSummary(),
      encrypted: this.encrypt(JSON.stringify(secret), `${userId}:figma`),
    }
    this.save()
  }
  removeFigmaKey(userId: string) {
    delete this.user(userId).figma
    this.save()
  }
  addConnection(userId: string, secret: ConnectionSecret): WorkspaceConnection {
    const id = randomUUID()
    const connection = {
      id,
      name: secret.name,
      provider: secret.provider,
      projectKey: secret.projectKey,
      ...(secret.jiraEdition ? { jiraEdition: secret.jiraEdition } : {}),
      encrypted: this.encrypt(JSON.stringify(secret), `${userId}:${id}`),
    }
    this.user(userId).connections.push(connection)
    this.save()
    return {
      id,
      name: connection.name,
      provider: connection.provider,
      projectKey: connection.projectKey,
      ...(connection.jiraEdition
        ? { jiraEdition: connection.jiraEdition }
        : {}),
    }
  }
  connection(userId: string, id: string): ConnectionSecret {
    const connection = this.user(userId).connections.find(
      (candidate) => candidate.id === id,
    )
    if (!connection) throw new Error('Connection not found in this workspace.')
    return JSON.parse(
      this.decrypt(connection.encrypted, `${userId}:${id}`),
    ) as ConnectionSecret
  }
  updateConnectionSecret(userId: string, id: string, secret: ConnectionSecret) {
    const connection = this.user(userId).connections.find(
      (item) => item.id === id,
    )
    if (!connection) throw new Error('Connection not found in this workspace.')
    connection.encrypted = this.encrypt(
      JSON.stringify(secret),
      `${userId}:${id}`,
    )
    this.save()
  }
  removeConnection(userId: string, id: string) {
    const user = this.user(userId)
    this.connection(userId, id)
    user.connections = user.connections.filter(
      (connection) => connection.id !== id,
    )
    user.dashboards = user.dashboards.filter(
      (dashboard) => dashboard.connectionId !== id,
    )
    this.save()
  }
  saveDashboard(userId: string, dashboard: SavedDashboard) {
    if (dashboard.provider !== 'demo') {
      const connection = this.connection(userId, dashboard.connectionId)
      if (
        connection.provider !== dashboard.provider ||
        (connection.provider === 'jira' &&
          connection.projectKey !== dashboard.projectKey)
      )
        throw new Error('Dashboard does not match this connection.')
    }
    const user = this.user(userId)
    user.dashboards = [
      ...user.dashboards.filter((item) => item.id !== dashboard.id),
      dashboard,
    ]
    this.save()
  }
  removeDashboard(userId: string, id: string) {
    const user = this.user(userId)
    user.dashboards = user.dashboards.filter((dashboard) => dashboard.id !== id)
    this.save()
  }
  private user(id: string): StoredUser {
    const user = this.data.users.find((candidate) => candidate.id === id)
    if (!user) throw new Error('Account not found.')
    return user
  }
  private save() {
    const temporary = `${this.file}.tmp`
    writeFileSync(temporary, JSON.stringify(this.data), { mode: 0o600 })
    renameSync(temporary, this.file)
  }
  private encrypt(value: string, context: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(context))
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ])
    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString('base64'))
      .join('.')
  }
  private decrypt(value: string, context: string): string {
    const [iv, tag, encrypted] = value
      .split('.')
      .map((part) => Buffer.from(part, 'base64'))
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv!)
    decipher.setAAD(Buffer.from(context))
    decipher.setAuthTag(tag!)
    return Buffer.concat([
      decipher.update(encrypted!),
      decipher.final(),
    ]).toString('utf8')
  }
}

/** The public part of a stored GitHub connection; older ones had no repositories. */
function storedGithub(
  stored: WorkspaceGithubSettings & { encrypted: string },
): WorkspaceGithubSettings {
  return {
    host: stored.host,
    repositories: stored.repositories ?? [],
    ...(stored.classic ? { classic: true } : {}),
    ...(stored.expiresAt ? { expiresAt: stored.expiresAt } : {}),
    ...(stored.checkedAt ? { checkedAt: stored.checkedAt } : {}),
    ...(stored.checks ? { checks: stored.checks } : {}),
  }
}
