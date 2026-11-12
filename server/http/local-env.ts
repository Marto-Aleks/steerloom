import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'

/**
 * Settings for the local app: the same files Vite's development loader reads
 * (.env, .env.local, .env.development, .env.development.local, later files
 * winning), with the process environment winning over all of them. Kept free
 * of Vite so the packaged local server runs on plain Node.
 */
export function localEnvironment(
  cwd: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const name of [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
  ]) {
    const path = resolve(cwd, name)
    if (!existsSync(path)) continue
    try {
      Object.assign(merged, parseEnv(readFileSync(path, 'utf8')))
    } catch {
      /* An unreadable file is treated as absent. */
    }
  }
  for (const [key, value] of Object.entries(environment))
    if (value !== undefined) merged[key] = value
  return merged
}
