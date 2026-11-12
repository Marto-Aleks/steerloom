// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  INSTALL_LINK_MINUTES,
  installLinks,
  installPowerShellScript,
  installScript,
} from './install-command'

it('issues install links that expire and cannot be forged', () => {
  let now = 1_800_000_000_000
  const links = installLinks(Buffer.alloc(32, 1), () => now)
  const { token } = links.issue()
  expect(links.valid(token)).toBe(true)
  expect(links.valid(token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBe(
    false,
  )
  expect(installLinks(Buffer.alloc(32, 2), () => now).valid(token)).toBe(false)
  expect(links.valid(null)).toBe(false)
  now += INSTALL_LINK_MINUTES * 60_000 + 1
  expect(links.valid(token)).toBe(false)
})

it('builds a syntactically valid shell installer with the archive address', () => {
  const script = installScript(
    'https://steerloom.example/api/hosted/download/local?t=1.abc',
  )
  expect(script).toContain(
    "ARCHIVE_URL='https://steerloom.example/api/hosted/download/local?t=1.abc'",
  )
  expect(script.trimEnd().endsWith('main "$@"')).toBe(true)
  const file = join(mkdtempSync(join(tmpdir(), 'steerloom-install-')), 'i.sh')
  writeFileSync(file, script)
  expect(() => execFileSync('sh', ['-n', file])).not.toThrow()
  expect(() => installScript("https://x.example/'; rm -rf ~")).toThrow()
})

it("installs the prebuilt app without npm and keeps the person's data", () => {
  const script = installScript('https://steerloom.example/x?t=1.abc')
  expect(script).not.toMatch(/^\s*npm /m)
  expect(script).toContain('.flowlens|.env.local) ;;')
  expect(script).toContain('"$APP/server.mjs" --open')
  expect(script).toContain('Applications/Steerloom.app')
  expect(script).toContain('steerloom.desktop')
  const windows = installPowerShellScript('https://steerloom.example/x?t=1.abc')
  expect(windows).not.toContain('npm.cmd')
  expect(windows).toContain(
    "$_.Name -ne '.flowlens' -and $_.Name -ne '.env.local'",
  )
  expect(windows).toContain('Steerloom.lnk')
})

const hasPwsh =
  spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0

it('builds a PowerShell installer with the archive address', () => {
  const script = installPowerShellScript(
    'https://steerloom.example/api/hosted/download/local?t=1.abc',
  )
  expect(script).toContain(
    "$SteerloomArchiveUrl = 'https://steerloom.example/api/hosted/download/local?t=1.abc'",
  )
  expect(script.trimEnd().endsWith('Install-Steerloom')).toBe(true)
  // Windows PowerShell 5.1 reads irm output reliably only as plain ASCII.
  expect([...script].every((c) => c === '\n' || (c >= ' ' && c <= '~'))).toBe(
    true,
  )
  // iex runs in the person's own window; exit would close it.
  expect(script).not.toMatch(/^\s*exit\b/m)
  for (const bad of [
    "https://x.example/'; Remove-Item -Recurse ~",
    'https://x.example/a b',
    'https://x.example/$(calc)',
    'https://x.example/\u2019',
    'file:///C:/x',
  ])
    expect(() => installPowerShellScript(bad)).toThrow()
})

it.skipIf(!hasPwsh)('parses the PowerShell installer without errors', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'steerloom-install-')), 'i.ps1')
  writeFileSync(
    file,
    installPowerShellScript('https://steerloom.example/download?t=1.abc'),
  )
  const output = execFileSync('pwsh', [
    '-NoProfile',
    '-Command',
    `$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$null, [ref]$errors); $errors.Count`,
  ]).toString()
  expect(output.trim()).toBe('0')
})
