/*
 * Steerloom on your own computer, without Vite: the same local workspace,
 * Jira and AI handlers the development server uses, plus the built app.
 * Started by the launcher or `node server.mjs` inside the install folder;
 * workspace data stays in .flowlens/ beside it.
 *
 *   --open   open the app in a browser window once the server is ready
 *
 * Starting it twice is harmless: the second start sees Steerloom already
 * running, opens the window and exits.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { userInfo } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkspaceServices } from '../workspace/vite-plugin'
import { createJiraHandler } from '../jira/vite-plugin'
import { createAiHandler } from '../ai/vite-plugin'
import { localEnvironment } from '../http/local-env'
import { SECURITY_HEADERS, staticFiles } from './static'
import { systemProxySettings } from './system-proxy'
import { trustSystemCertificates } from './system-certificates'
import { updateChecker } from './update-check'
import { selfUpdater } from './self-update'
import { RELEASE } from '../http/release'
import { keepServing } from '../http/keep-serving'

const here = dirname(fileURLToPath(import.meta.url))
// Company networks that inspect HTTPS: trust what the computer trusts.
trustSystemCertificates()
const env = localEnvironment()
const port = Number(env.STEERLOOM_PORT || 5173)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('STEERLOOM_PORT must be 1–65535.')
const url = `http://127.0.0.1:${port}/`
const shouldOpen = process.argv.includes('--open')

// Started from the app icon there is no terminal environment: use the
// computer's own proxy settings when neither the environment nor .env.local
// names one, so sites outside the company network stay reachable. Its
// exceptions come too, so company sites are reached directly, as the browser
// does. A NO_PROXY in .env.local counts like one from the terminal.
if (env.NO_PROXY && !process.env.NO_PROXY) process.env.NO_PROXY = env.NO_PROXY
if (!env.HTTPS_PROXY && !env.HTTP_PROXY) {
  const { proxy, bypass } = systemProxySettings()
  if (proxy) {
    process.env.HTTPS_PROXY = proxy
    process.env.HTTP_PROXY = proxy
    if (bypass && !process.env.NO_PROXY && !process.env.no_proxy)
      process.env.NO_PROXY = bypass
    console.info(`Using the system proxy ${proxy}`)
  }
}

type Handler = (
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
  next: () => void,
) => Promise<void>

/*
 * The start link: a secret written where only this computer user can read
 * it. The app icon opens Steerloom with it and lands signed in, so one person
 * on their own laptop never sees a sign-in page. Other programs and other
 * computer users cannot read the file, so they still meet the sign-in page.
 */
const dataDir =
  env.FLOWLENS_WORKSPACE_DIR || resolve(process.cwd(), '.flowlens')
const secretFile = resolve(dataDir, 'start.key')
const readSecret = () => {
  try {
    return readFileSync(secretFile, 'utf8').trim()
  } catch {
    return ''
  }
}
const startUrl = (secret: string) =>
  secret ? `${url}api/auth/start?token=${secret}` : url
const ownerName = (() => {
  try {
    return userInfo().username
  } catch {
    return 'owner'
  }
})()
let secret = ''
/** A fresh start secret, written where only this computer user can read it. */
function renewSecret() {
  secret = randomBytes(32).toString('hex')
  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    writeFileSync(secretFile, secret, { mode: 0o600 })
    chmodSync(secretFile, 0o600)
  } catch {
    secret = ''
  }
}

const workspace = createWorkspaceServices(
  undefined,
  undefined,
  undefined,
  undefined,
  {
    secret: () => secret,
    // A used link stops working: the next start reads the new secret.
    used: () => renewSecret(),
    owner: { username: ownerName, workspaceName: 'My workspace' },
  },
)
const handlers: Handler[] = [
  workspace.handle,
  createJiraHandler(workspace.jiraConnections),
  createAiHandler(
    workspace.jiraConnections,
    workspace.boardReader,
    undefined,
    workspace.aiConfig,
  ),
]
const dist = [resolve(here, 'dist'), resolve(here, '../dist')].find((path) =>
  existsSync(resolve(path, 'index.html')),
)
if (!dist) throw new Error('The built app (dist/index.html) is missing.')
const files = staticFiles(dist)

// Whether steerloom.app has a newer version (see update-check.ts).
const updates = updateChecker({
  current: RELEASE.version,
  ...(env.STEERLOOM_UPDATE_ORIGIN
    ? { origin: env.STEERLOOM_UPDATE_ORIGIN }
    : {}),
})

// "Update now" in the app: only a copy the installer installed updates
// itself. The installer writes into the folder around the app, so a copy
// unpacked by hand (say in Downloads) or run from source must not: its
// launcher beside the app is how an installed copy is told apart.
const installed =
  basename(here) === 'steerloom-local' &&
  ['start-steerloom', 'start-steerloom.cmd'].some((launcher) =>
    existsSync(resolve(here, '..', launcher)),
  )
const selfUpdate = selfUpdater({
  appDir: here,
  dataDir,
  ...(env.STEERLOOM_UPDATE_ORIGIN
    ? { origin: env.STEERLOOM_UPDATE_ORIGIN }
    : {}),
})

/** A request from this app's own page: its address, and not another site. */
function ownPage(request: import('node:http').IncomingMessage): boolean {
  const site = request.headers['sec-fetch-site']
  const host = request.headers.host
  return (
    (site === undefined || site === 'same-origin' || site === 'none') &&
    (host === `127.0.0.1:${port}` || host === `localhost:${port}`)
  )
}

const server = createServer(
  { requestTimeout: 0, headersTimeout: 15000, maxHeaderSize: 16384 },
  (request, response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS))
      response.setHeader(name, value)
    // The sign-in page asks whether a hosted account can be linked here.
    // The packaged app has none; answer plainly instead of a 401, which the
    // app would read as an expired session.
    if (request.url === '/api/hosted/config' && request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Cache-Control', 'no-store')
      response.end('{"configured":false}')
      return
    }
    // Update routes answer only on this computer's own address, so another
    // website cannot read them or spend the update allowance through them.
    if (request.url?.startsWith('/api/local/') && !ownPage(request)) {
      response.statusCode = 403
      response.setHeader('Content-Type', 'application/json')
      response.end('{"error":"Not allowed."}')
      return
    }
    if (
      request.method === 'GET' &&
      request.url?.startsWith('/api/local/update-command')
    ) {
      void updates.command().then((command) => {
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        if (command) response.end(JSON.stringify(command))
        else {
          response.statusCode = 503
          response.end(
            '{"error":"Could not reach steerloom.app for the update command."}',
          )
        }
      })
      return
    }
    if (request.method === 'POST' && request.url === '/api/local/update-now') {
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Cache-Control', 'no-store')
      // Only this app's own page may start an update: another website open
      // in the browser cannot set the header or pass as the same site.
      if (request.headers['x-steerloom-update'] !== '1') {
        response.statusCode = 403
        response.end('{"error":"Not allowed."}')
        return
      }
      if (!installed) {
        response.statusCode = 409
        response.end(
          '{"error":"This copy was not installed with the Steerloom installer."}',
        )
        return
      }
      void updates.command().then((command) => {
        const result = command ? selfUpdate.start(command) : null
        if (result?.started) {
          response.statusCode = 202
          response.end('{"started":true}')
          return
        }
        response.statusCode = result ? 500 : 503
        response.end(
          JSON.stringify({
            error: result
              ? 'The update could not start.'
              : 'Could not reach steerloom.app for the update.',
          }),
        )
      })
      return
    }
    if (
      request.method === 'GET' &&
      /^\/api\/local\/update(?:\?|$)/.test(request.url ?? '')
    ) {
      void updates
        .state((request.url ?? '').includes('refresh=1'))
        .then((state) => {
          response.setHeader('Content-Type', 'application/json')
          response.setHeader('Cache-Control', 'no-store')
          response.end(JSON.stringify(state))
        })
      return
    }
    if (request.url === '/healthz') {
      response.setHeader('Content-Type', 'application/json')
      response.end('{"ok":true,"app":"steerloom-local"}')
      return
    }
    let index = 0
    const next = () => {
      const handler = handlers[index++]
      if (!handler) {
        if ((request.url ?? '').startsWith('/api/')) {
          response.statusCode = 404
          response.setHeader('Content-Type', 'application/json')
          response.end('{"error":"Not found."}')
          return
        }
        void files(request, response)
        return
      }
      handler(request, response, next).catch(() => {
        if (!response.headersSent) {
          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json')
          response.end('{"error":"Request failed."}')
        } else response.destroy()
      })
    }
    next()
  },
)

/** Opens Steerloom in an app window (Chrome or Edge) or the default browser. */
export function openApp(target: string) {
  const quiet = { stdio: 'ignore' as const, detached: true }
  const tryRun = (command: string, args: string[]) => {
    try {
      const child = spawn(command, args, quiet)
      child.on('error', () => {})
      child.unref()
      return true
    } catch {
      return false
    }
  }
  if (process.platform === 'darwin') {
    for (const app of ['Google Chrome', 'Microsoft Edge'])
      if (existsSync(`/Applications/${app}.app`))
        return tryRun('open', ['-na', app, '--args', `--app=${target}`])
    return tryRun('open', [target])
  }
  if (process.platform === 'win32')
    return (
      tryRun('cmd', ['/c', 'start', '', 'msedge', `--app=${target}`]) ||
      tryRun('cmd', ['/c', 'start', '', target])
    )
  return tryRun('xdg-open', [target])
}

/** A system dialog with the message, where the platform offers one. */
export function notify(message: string) {
  const run = (command: string, args: string[]) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true })
      child.on('error', () => {})
      child.unref()
    } catch {
      // No dialog on this system: the log has the message.
    }
  }
  const text = message.replace(/["\\]/g, ' ')
  if (process.platform === 'darwin')
    run('osascript', [
      '-e',
      `display dialog "${text}" with title "Steerloom" buttons {"OK"} default button "OK" with icon caution`,
    ])
  else if (process.platform === 'win32')
    run('powershell', [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show("${text}", "Steerloom")`,
    ])
  else run('notify-send', ['Steerloom', text])
}

async function alreadyRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${url}healthz`, {
      signal: AbortSignal.timeout(1500),
    })
    const body = (await response.json()) as { app?: string }
    return body.app === 'steerloom-local'
  } catch {
    return false
  }
}

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EADDRINUSE') throw error
  void alreadyRunning().then((running) => {
    if (running) {
      console.info(`Steerloom is already running at ${url}`)
      if (shouldOpen) openApp(startUrl(readSecret()))
      process.exit(0)
    }
    const message = `Port ${port} is used by another program. Close it, or set STEERLOOM_PORT in .env.local (sign-in with Google or Atlassian expects ${port}).`
    console.error(message)
    // Started from the app icon there is no terminal: say it on screen,
    // or the browser quietly shows whatever else answers on that port.
    if (shouldOpen) notify(message)
    process.exit(1)
  })
})

server.listen(port, '127.0.0.1', () => {
  // Once running, an unexpected error in one request must not close the
  // app. A failed start (the port in use) still stops, as above.
  keepServing()
  updates.start()
  // A new secret for every start; written only once this server owns the port.
  renewSecret()
  console.info(`Steerloom is running at ${url}`)
  if (shouldOpen) openApp(startUrl(secret))
})

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  })
