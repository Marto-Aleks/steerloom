import type { Dispatcher } from 'undici'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface JiraServerConfig {
  dispatcher?: Dispatcher
  cloud?: boolean
  /** Running on the hosted site: company-internal Jira cannot be reached from it. */
  hosted?: boolean
  siteUrl?: string
  accessToken?: (signal?: AbortSignal) => Promise<string>
  /** Jira Cloud with an API token: Basic auth as `email:pat`. */
  email?: string
  baseUrl?: string
  instance: string
  pat: string
  apiKey: string
  proxyUrl: string
  defaultProjectKey: string
  missing: string[]
}

export interface JiraServerConnection extends JiraServerConfig {
  id: string
  projectKeys: string[]
}

const proxyKeys = ['HTTPS_PROXY', 'HTTP_PROXY'] as const
type ProxyKey = (typeof proxyKeys)[number]

// Reads only proxy variables; connector credentials are always saved per
// user connection, never discovered from the machine.
export function parseProxyEnvironment(
  contents: string,
): Partial<Record<ProxyKey, string>> {
  const values: Partial<Record<ProxyKey, string>> = {}
  contents.split(/\r?\n/).forEach((line) => {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line)
    const key = match?.[1] as ProxyKey | undefined
    if (!key || !proxyKeys.includes(key)) return
    values[key] = unquote(match![2] ?? '')
  })
  return values
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function loadInstallationProxy(
  cwd = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const path = resolve(cwd, '.env.local')
  const file = existsSync(path)
    ? parseProxyEnvironment(readFileSync(path, 'utf8'))
    : {}
  return (
    environment.HTTPS_PROXY?.trim() ||
    file.HTTPS_PROXY?.trim() ||
    environment.HTTP_PROXY?.trim() ||
    file.HTTP_PROXY?.trim() ||
    ''
  )
}
