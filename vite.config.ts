import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { aiApiPlugin } from './server/ai/vite-plugin'
import { jiraApiPlugin } from './server/jira/vite-plugin'
import { createWorkspaceServices } from './server/workspace/vite-plugin'

import { fetch, ProxyAgent } from 'undici'
import { createHostedAuthServices } from './server/hosted/auth-service'
import { feedbackSender } from './server/hosted/feedback'
import { clientAddress } from './server/http/client-address'
import {
  loadSupabaseAuthConfig,
  supabaseAuthProvider,
} from './server/hosted/auth-provider'

import { HostedWorkspaceStore } from './server/hosted/workspace-store'
import { createHostedWorkspaceServices } from './server/hosted/workspace-service'
import { loadAtlassianProvider } from './server/workspace/atlassian'
import { loadTrelloProvider } from './server/trello/oauth'
import { loadTrelloProxy } from './server/trello/config'

const workspace = createWorkspaceServices()
const env = loadEnv('development', process.cwd(), '')
const authConfig = loadSupabaseAuthConfig(env)
const proxy = env.STEERLOOM_SUPABASE_PROXY || env.HTTPS_PROXY || env.HTTP_PROXY
const dispatcher = proxy ? new ProxyAgent(proxy) : undefined
const transport: typeof fetch = (input, init) =>
  fetch(input, { ...init, ...(dispatcher ? { dispatcher } : {}) })
const provider = authConfig ? supabaseAuthProvider(authConfig, transport) : null
const credentialKey = env.STEERLOOM_CREDENTIAL_KEY ?? ''
const workspaceStore =
  authConfig &&
  provider &&
  env.STEERLOOM_SUPABASE_SECRET_KEY &&
  /^[a-fA-F0-9]{64}$/.test(credentialKey)
    ? new HostedWorkspaceStore(
        provider.database,
        authConfig.supabaseUrl,
        env.STEERLOOM_SUPABASE_SECRET_KEY,
        Buffer.from(credentialKey, 'hex'),
        transport,
      )
    : null
const hostedAtlassian = authConfig
  ? loadAtlassianProvider({
      ...env,
      STEERLOOM_ATLASSIAN_REDIRECT_URI: `${authConfig.origin}/api/hosted/atlassian/callback`,
    })
  : null
const connectorProxy = env.HTTPS_PROXY || env.HTTP_PROXY
const hosted = createHostedAuthServices(
  authConfig,
  provider,
  workspaceStore
    ? createHostedWorkspaceServices(
        workspaceStore,
        hostedAtlassian,
        connectorProxy,
        loadTrelloProxy(connectorProxy),
        loadTrelloProvider(env, authConfig!.origin, transport),
      )
    : undefined,
  undefined,
  clientAddress(),
  // Development: feedback goes to the terminal unless Resend is configured.
  feedbackSender({
    apiKey: env.STEERLOOM_RESEND_API_KEY,
    to: env.STEERLOOM_FEEDBACK_TO,
    origin: authConfig?.origin ?? 'http://127.0.0.1:5173',
    transport: (url, init) => fetch(url, init),
  }),
)

export default defineConfig({
  plugins: [
    hosted.plugin,
    workspace.plugin,
    jiraApiPlugin(workspace.jiraConnections),
    aiApiPlugin(
      workspace.jiraConnections,
      workspace.boardReader,
      workspace.aiConfig,
    ),
    react(),
    tailwindcss(),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    strictPort: true,
  },
})
