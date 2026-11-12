import { dirname, resolve } from 'node:path'
import { fetch, ProxyAgent } from 'undici'
import { loadHostedConfig } from './config'
import { supabaseAuthProvider } from './auth-provider'
import { createHostedAuthServices } from './auth-service'
import { HostedWorkspaceStore } from './workspace-store'
import { createHostedWorkspaceServices } from './workspace-service'
import { loadAtlassianProvider } from '../workspace/atlassian'
import { loadTrelloProvider } from '../trello/oauth'
import { diskSessionStore } from './session-store'
import { hostedHttpServer } from './http-server'
import { clientAddress } from '../http/client-address'
import { feedbackSender } from './feedback'
import { usageCounter } from './usage'
import { keepServing } from '../http/keep-serving'

// Production reads environment secrets only; never mounts local-account APIs.
const config = loadHostedConfig()
const secret = process.env.STEERLOOM_SUPABASE_SECRET_KEY
const sessionFile = process.env.STEERLOOM_SESSION_FILE
if (!secret || !sessionFile)
  throw new Error(
    'Configure STEERLOOM_SUPABASE_SECRET_KEY and STEERLOOM_SESSION_FILE on a persistent disk.',
  )
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
)
const proxy = process.env.STEERLOOM_SUPABASE_PROXY
const dispatcher = proxy ? new ProxyAgent(proxy) : undefined
const transport: typeof fetch = (input, init) =>
  fetch(input, { ...init, ...(dispatcher ? { dispatcher } : {}) })
const provider = supabaseAuthProvider(config, transport)
const store = new HostedWorkspaceStore(
  provider.database,
  config.supabaseUrl,
  secret,
  config.credentialKey,
  transport,
)
const atlassian = loadAtlassianProvider({
  ...env,
  STEERLOOM_ATLASSIAN_REDIRECT_URI: `${config.origin}/api/hosted/atlassian/callback`,
})
const trello = loadTrelloProvider(env, config.origin)
// Usage counts live beside the sessions on the persistent disk.
const usage = usageCounter(resolve(dirname(sessionFile), 'usage.json'))
const admins = (
  process.env.STEERLOOM_ADMIN_EMAILS ||
  process.env.STEERLOOM_FEEDBACK_TO ||
  ''
)
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean)
const workspace = createHostedWorkspaceServices(
  store,
  atlassian,
  undefined,
  undefined,
  trello,
  config.origin,
  usage,
)
const auth = createHostedAuthServices(
  config,
  provider,
  workspace,
  diskSessionStore(sessionFile, config.credentialKey),
  clientAddress(
    process.env.STEERLOOM_CLIENT_IP_HEADER,
    process.env.STEERLOOM_EDGE_SECRET,
  ),
  feedbackSender({
    apiKey: process.env.STEERLOOM_RESEND_API_KEY,
    to: process.env.STEERLOOM_FEEDBACK_TO,
    origin: config.origin,
    transport: (url, init) => transport(url, init),
  }),
  { usage, admins },
)
if (
  process.env.STEERLOOM_CLIENT_IP_HEADER &&
  !process.env.STEERLOOM_EDGE_SECRET?.trim()
)
  console.warn(
    'STEERLOOM_EDGE_SECRET is not set: the client address header is trusted from anyone. Add the secret here and as the x-steerloom-edge header in Cloudflare.',
  )
const server = hostedHttpServer(config.origin, resolve('dist'), auth.handle)
const port = Number(process.env.PORT || 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be 1–65535.')
server.listen(port, '0.0.0.0', () => {
  // From here on, one request's unexpected error must not end the server
  // for everyone. Before this point a failure (wrong configuration, a port
  // in use) still stops the start, loudly.
  keepServing()
  console.info('Steerloom hosted server is ready.')
})
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    usage.flush()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 10000).unref()
  })
