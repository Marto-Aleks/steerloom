import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A Trello-only override keeps corporate Jira routing independent. Unset keeps
// the existing installation proxy; "direct" explicitly bypasses that proxy.
export function loadTrelloProxy(
  fallback?: string,
  cwd = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const path = resolve(cwd, '.env.local')
  let local: string | undefined
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^(?:export\s+)?FLOWLENS_TRELLO_PROXY\s*=\s*(.*)$/.exec(
        line.trim(),
      )
      if (match) local = match[1]?.trim().replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  const value = environment.FLOWLENS_TRELLO_PROXY?.trim() || local || fallback
  return value?.toLowerCase() === 'direct' ? undefined : value || undefined
}
