import { spawn } from 'node:child_process'
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { unixInstallCommand } from '../hosted/install-command'
import type { UpdateCommand } from './update-check'

/*
 * "Update now": the installed app runs the same installer the pasted command
 * runs, so nobody has to open a terminal to update.
 *
 * What it trusts: only the short-lived link from steerloom.app. The command
 * itself is built here, from the fixed site address and that link, so a
 * tampered answer cannot make this computer run anything else.
 *
 * Before anything is replaced, the person's data (.flowlens) and settings
 * (.env.local) are copied to a backups folder beside the app. The installer
 * keeps both anyway; the copy is there in case an update goes wrong.
 */
const LINK = /[?&]t=(\d{13}\.[\w-]{43})(?=[&"]|$)/
const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/
const BACKUP_NAME = /^before-update-\d{8}T\d{6}$/
const KEEP_BACKUPS = 3
/** A second click while an update runs starts nothing new. */
const RUNNING_FOR = 10 * 60 * 1000

export type UpdateStart =
  | { started: true; backup: string }
  | { started: false; reason: 'link' | 'backup' | 'start' }

export interface UpdateProcess {
  file: string
  args: string[]
  /** The folder that holds steerloom-local, so this copy is the one updated. */
  dir: string
}

/** The installer process for this computer, built from the link alone. */
export function updateProcess(
  command: UpdateCommand,
  {
    origin,
    appDir,
    platform,
  }: { origin: string; appDir: string; platform: NodeJS.Platform },
): UpdateProcess | null {
  if (!ORIGIN.test(origin)) return null
  const windows = platform === 'win32'
  const link = LINK.exec(windows ? command.windowsCommand : command.command)
  if (!link) return null
  const dir = dirname(appDir)
  return windows
    ? {
        file: 'powershell.exe',
        args: [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `irm "${origin}/api/hosted/install.ps1?t=${link[1]}&u=1" | iex`,
        ],
        dir,
      }
    : {
        file: '/bin/sh',
        // Run in the background of a shell that exits at once, so the
        // installer is no longer a child of this server. On macOS pkill
        // spares its own ancestors: as a child, the installer could not
        // stop the running copy, and the old version would keep serving.
        args: ['-c', `(${unixInstallCommand(origin, link[1]!, true)}) &`],
        dir,
      }
}

/** "before-update-20261112T174500": sorts by time, safe as a folder name. */
function backupName(at: number): string {
  return `before-update-${new Date(at)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '')}`
}

/**
 * Copies the data folder and the settings file next to the app, and keeps
 * the three newest copies. Only folders this function named are removed.
 */
export function backUp({
  appDir,
  dataDir,
  at,
}: {
  appDir: string
  dataDir: string
  at: number
}): string {
  const root = resolve(dirname(appDir), 'backups')
  const target = resolve(root, backupName(at))
  mkdirSync(target, { recursive: true, mode: 0o700 })
  if (existsSync(dataDir))
    cpSync(dataDir, resolve(target, basename(dataDir)), { recursive: true })
  const settings = resolve(appDir, '.env.local')
  if (existsSync(settings)) cpSync(settings, resolve(target, '.env.local'))
  const older = readdirSync(root)
    .filter((name) => BACKUP_NAME.test(name))
    .sort()
    .slice(0, -KEEP_BACKUPS)
  for (const name of older)
    rmSync(resolve(root, name), { recursive: true, force: true })
  return target
}

export function selfUpdater({
  origin = 'https://steerloom.app',
  appDir,
  dataDir,
  platform = process.platform,
  now = Date.now,
  run = (process: UpdateProcess) => {
    // Its own session, so it outlives this server, which the installer
    // stops before it replaces the files. What it prints goes to a log.
    const log = openSync(resolve(process.dir, 'update.log'), 'a')
    try {
      spawn(process.file, process.args, {
        cwd: process.dir,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log, log],
        env: { ...globalThis.process.env, STEERLOOM_DIR: process.dir },
      }).unref()
    } finally {
      closeSync(log)
    }
  },
}: {
  origin?: string
  appDir: string
  dataDir: string
  platform?: NodeJS.Platform
  now?: () => number
  run?: (process: UpdateProcess) => void
}) {
  let startedAt = 0
  let lastBackup = ''
  return {
    start(command: UpdateCommand): UpdateStart {
      if (startedAt && now() - startedAt < RUNNING_FOR)
        return { started: true, backup: lastBackup }
      const process = updateProcess(command, { origin, appDir, platform })
      if (!process) return { started: false, reason: 'link' }
      let backup: string
      try {
        backup = backUp({ appDir, dataDir, at: now() })
      } catch {
        // No copy of the data, no update: the pasted command still works.
        return { started: false, reason: 'backup' }
      }
      try {
        run(process)
      } catch {
        return { started: false, reason: 'start' }
      }
      startedAt = now()
      lastBackup = backup
      return { started: true, backup }
    },
  }
}
