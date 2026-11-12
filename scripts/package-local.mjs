import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(join(tmpdir(), 'steerloom-local-'))
const packageRoot = join(temporary, 'steerloom-local')
const output = join(root, 'dist', 'downloads')
// The download is public. Refuse to package terms the operator never wants
// published (internal hosts, instances, tooling). The terms are kept out of
// the repository: set STEERLOOM_PACKAGE_DENYLIST to a comma-separated list.
// The Render build, which makes the download people install, fails when it
// is missing. Elsewhere (a contributor's computer, CI on a fork, where
// secrets are not available) the check is skipped with a warning.
function loadDenylist() {
  const terms = (process.env.STEERLOOM_PACKAGE_DENYLIST ?? '')
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean)
  if (terms.length)
    return new RegExp(
      terms
        .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|'),
      'i',
    )
  if (process.env.RENDER)
    throw new Error(
      'STEERLOOM_PACKAGE_DENYLIST is required to build the public local package.',
    )
  process.stderr.write(
    'Warning: STEERLOOM_PACKAGE_DENYLIST is not set; skipping the publish check.\n',
  )
  return null
}

async function assertPublishable(directory, forbidden) {
  if (!forbidden) return
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })
  const leaks = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    if (forbidden.test(path) || forbidden.test(await readFile(path, 'utf8')))
      leaks.push(path.slice(directory.length + 1))
  }
  if (leaks.length)
    throw new Error(
      `Refusing to package denylisted terms in: ${leaks.join(', ')}`,
    )
}

const forbidden = loadDenylist()

// The package is the built app, not its source: the one-file local server
// (dist-local/server.mjs, all dependencies bundled), the built frontend and
// the AI skill files the server reads. It runs on plain Node 22 with no
// npm install. Build first: npm run build && vite build --config vite.local.config.ts
const server = join(root, 'dist-local', 'server.mjs')
const app = join(root, 'dist')
for (const required of [server, join(app, 'index.html')])
  await readFile(required).catch(() => {
    throw new Error(
      `Missing ${required}. Run "npm run build" and "npx vite build --config vite.local.config.ts" first.`,
    )
  })
try {
  await mkdir(packageRoot, { recursive: true })
  await mkdir(output, { recursive: true })
  await cp(server, join(packageRoot, 'server.mjs'))
  // The local app never shows the landing film; leave it and earlier
  // downloads out of the package.
  await cp(app, join(packageRoot, 'dist'), {
    recursive: true,
    filter: (source) =>
      !/(?:^|\/)dist\/(?:video|downloads)(?:\/|$)/.test(source),
  })
  const skills = join(root, 'server', 'ai', 'skills')
  for (const entry of await readdir(skills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    await mkdir(join(packageRoot, 'server', 'ai', 'skills', entry.name), {
      recursive: true,
    })
    await cp(
      join(skills, entry.name, 'SKILL.md'),
      join(packageRoot, 'server', 'ai', 'skills', entry.name, 'SKILL.md'),
    )
  }
  for (const file of ['LOCAL-SETUP.md', '.env.example'])
    await cp(join(root, file), join(packageRoot, file))
  const version = new Date().toISOString().slice(0, 16).replace('T', ' ')
  await writeFile(join(packageRoot, 'VERSION'), `${version} UTC\n`)
  await assertPublishable(packageRoot, forbidden)
  execFileSync('tar', [
    '-czf',
    join(output, 'steerloom-local.tar.gz'),
    '-C',
    temporary,
    'steerloom-local',
  ])
  process.stdout.write('Created dist/downloads/steerloom-local.tar.gz\n')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
