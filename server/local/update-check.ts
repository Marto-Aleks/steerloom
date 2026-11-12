import { EnvHttpProxyAgent, fetch } from 'undici'
import { compareVersions, readRelease, type ReleaseInfo } from '../http/release'

/*
 * Asks steerloom.app whether a newer version exists. The request carries
 * nothing about the person, their boards or this computer: no account, no
 * identifier, no version number. The answer is compared here. Offline, or on
 * a network that blocks steerloom.app, nothing is shown and nothing fails.
 * The server asks every hour; the app also asks on each page load, which is
 * allowed through at most once a minute.
 */
export interface UpdateCommand {
  command: string
  windowsCommand: string
}

export interface UpdateState {
  current: string
  available: boolean
  latest?: string
  notes?: string[]
  /** Where the update command is, on steerloom.app. */
  updateUrl: string
}

const HOUR = 60 * 60 * 1000
const MIN_GAP = 60 * 1000

export function updateChecker({
  current,
  origin = 'https://steerloom.app',
  request = (url: string) =>
    fetch(url, {
      dispatcher: new EnvHttpProxyAgent(),
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' },
    }),
  now = Date.now,
}: {
  current: string
  origin?: string
  request?: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>
  now?: () => number
}) {
  let latest: ReleaseInfo | null = null
  let checkedAt = 0
  let running: Promise<void> | null = null
  const check = () =>
    (running ??= (async () => {
      checkedAt = now()
      try {
        const response = await request(`${origin}/api/hosted/version`)
        if (response.ok) latest = readRelease(await response.json()) ?? latest
      } catch {
        // Offline or blocked: try again later.
      } finally {
        running = null
      }
    })())
  return {
    check,
    /** Checks again when asked (the window came back online), at most once a minute. */
    async state(refresh = false): Promise<UpdateState> {
      if (refresh && now() - checkedAt >= MIN_GAP) await check()
      const available = !!latest && compareVersions(latest.version, current) > 0
      return {
        current,
        available,
        ...(available && latest
          ? { latest: latest.version, notes: latest.notes }
          : {}),
        updateUrl: `${origin}/?hosted=1&page=local`,
      }
    },
    /**
     * The command that updates this copy, fetched fresh from steerloom.app
     * (the link in it lasts 30 minutes). Nothing about this copy is sent.
     */
    async command(): Promise<UpdateCommand | null> {
      try {
        const response = await request(`${origin}/api/hosted/update-command`)
        if (!response.ok) return null
        const value = (await response.json()) as Partial<UpdateCommand>
        return typeof value.command === 'string' &&
          typeof value.windowsCommand === 'string' &&
          value.command.length < 400 &&
          value.windowsCommand.length < 400
          ? { command: value.command, windowsCommand: value.windowsCommand }
          : null
      } catch {
        return null
      }
    },
    /** Checks now and every hour while the app runs. */
    start() {
      void check()
      setInterval(() => void check(), HOUR).unref()
    },
  }
}
