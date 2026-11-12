import {
  readRepositoryList,
  REPOSITORY_LIMIT,
  type GithubRepositoryCheck,
  type WorkspaceGithubSettings,
} from '../../src/lib/workspace/model'
import {
  GithubClient,
  GithubError,
  graphqlEndpoint,
  type GithubTokenAccess,
} from './client'

/** Stored encrypted; only the server ever reads the token. */
export interface GithubSecret {
  baseUrl: string
  token: string
  /** A classic token: GitHub cannot make it read-only, so it is checked harder. */
  classic?: boolean
  expiresAt?: string
  /** The repositories every dashboard reads, as GitHub spells them. */
  repositories: string[]
  checkedAt?: string
  checks?: GithubRepositoryCheck[]
}

const DAY = 86_400_000

/*
 * A classic token can only read private repositories with `repo`, which also
 * allows writing. These are the scopes `repo` brings with it; anything else
 * (workflow, admin, delete, org or user scopes) is refused.
 */
const CLASSIC_SCOPES = new Set([
  'repo',
  'repo:status',
  'repo_deployment',
  'public_repo',
  'repo:invite',
  'security_events',
])

/**
 * Governance for the token GitHub described. Fine-grained tokens are limited
 * by their own permissions. Classic tokens must have no scope beyond `repo`
 * and an expiry date.
 */
export function checkTokenAccess(
  token: string,
  access: GithubTokenAccess,
): Pick<GithubSecret, 'classic' | 'expiresAt'> {
  const classic = token.startsWith('ghp_') || Boolean(access.scopes?.length)
  if (classic) {
    const extra = (access.scopes ?? []).filter(
      (scope) => !CLASSIC_SCOPES.has(scope),
    )
    if (extra.length)
      throw new GithubError(
        `This token can do more than read pull requests (${extra.join(', ')}). Create a new classic token with only “repo” ticked.`,
        'github-token-too-broad',
      )
    if (!access.expiresAt)
      throw new GithubError(
        'This classic token never expires. Create one with an expiry date (7 days is enough for a test).',
        'github-token-no-expiry',
      )
  }
  return {
    ...(classic ? { classic: true } : {}),
    ...(access.expiresAt ? { expiresAt: access.expiresAt } : {}),
  }
}

/**
 * Validates an owner's GitHub form. A blank token keeps the stored one when
 * the address is unchanged, as for the AI key.
 */
export function readGithubInput(
  input: Record<string, unknown>,
  existing?: GithubSecret,
): GithubSecret {
  const typed =
    typeof input.baseUrl === 'string' && input.baseUrl.trim()
      ? input.baseUrl.trim()
      : 'https://github.com'
  if (typed.length > 300) throw new Error('Use a shorter GitHub address.')
  let baseUrl: string
  try {
    graphqlEndpoint(typed)
    baseUrl = new URL(typed).origin
  } catch {
    throw new Error('Use the https:// address of GitHub.')
  }
  const typedToken = typeof input.token === 'string' ? input.token.trim() : ''
  if (typedToken.length > 400) throw new Error('This token is too long.')
  const token =
    typedToken || (existing?.baseUrl === baseUrl ? existing.token : '')
  if (!token) throw new Error('Paste a GitHub token.')
  const text =
    typeof input.repositories === 'string'
      ? input.repositories
      : Array.isArray(input.repositories)
        ? input.repositories.filter((x) => typeof x === 'string').join(',')
        : ''
  if (text.length > 4000) throw new Error('Name fewer repositories.')
  const { repositories, invalid } = readRepositoryList(text)
  if (invalid.length)
    throw new Error(
      `Write each repository as owner/name, for example acme/${invalid[0]!.split('/')[0]}. Not understood: ${invalid.join(', ')}.`,
    )
  if (!repositories.length)
    throw new Error('Name at least one repository, as owner/name.')
  if (repositories.length > REPOSITORY_LIMIT)
    throw new Error(`Name up to ${REPOSITORY_LIMIT} repositories.`)
  return { baseUrl, token, repositories }
}

export function githubSummary(secret: GithubSecret): WorkspaceGithubSettings {
  return {
    host: new URL(secret.baseUrl).host,
    repositories: [...(secret.repositories ?? [])],
    ...(secret.classic ? { classic: true } : {}),
    ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {}),
    ...(secret.checkedAt ? { checkedAt: secret.checkedAt } : {}),
    ...(secret.checks ? { checks: secret.checks.map((c) => ({ ...c })) } : {}),
  }
}

/**
 * Checks the token and every repository before saving: the token's access,
 * that it can see each repository, and how many of the last year's pull
 * requests name an item key. A wrong name or naming habit shows at once.
 */
export async function connectGithub(
  secret: GithubSecret,
  network: { proxyUrl?: string },
  signal?: AbortSignal,
  now = new Date(),
): Promise<GithubSecret> {
  const client = new GithubClient({ ...secret, ...network })
  const access = checkTokenAccess(secret.token, await client.verify(signal))
  const since = new Date(now.getTime() - 365 * DAY)
  const checks = await Promise.all(
    secret.repositories.map(async (typed) => {
      const name = await client.repository(typed, signal)
      const tally = { read: 0 }
      const linked = await client.pullRequests(name, since, signal, tally)
      return { name, read: tally.read, linked: linked.length }
    }),
  )
  return {
    baseUrl: secret.baseUrl,
    token: secret.token,
    ...access,
    repositories: checks.map((check) => check.name),
    checkedAt: now.toISOString(),
    checks,
  }
}
