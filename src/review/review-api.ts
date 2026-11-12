import { answerCardText, type AnswerCard } from '../lib/ai/answer-card'
/*
 * Review mode (development builds only): the real app runs against sample
 * answers served in the browser, so every signed-in screen can be reviewed
 * without an account. Nothing here is bundled into production; main.tsx only
 * imports it behind import.meta.env.DEV.
 */
import { demoCodeTrail } from '../lib/workspace/demo-github'
import { demoSnapshot } from '../lib/workspace/demo'
import { defaultMetrics } from '../lib/workspace/model'
import type { SavedDashboard, WorkspaceSession } from '../lib/workspace/model'

export type ReviewScenario = 'new' | 'connected' | 'briefings'

export const REVIEW_SCENARIOS: ReadonlyArray<{
  id: ReviewScenario
  title: string
  body: string
}> = [
  {
    id: 'new',
    title: 'First run',
    body: 'A brand-new workspace: no boards connected yet.',
  },
  {
    id: 'connected',
    title: 'Board connected',
    body: 'One board connected, no briefing built yet.',
  },
  {
    id: 'briefings',
    title: 'Briefings ready',
    body: 'Two sample briefings and an AI key, ready to open.',
  },
]

export function reviewHref(scenario: ReviewScenario) {
  return `/?review=${scenario}`
}

export function readReviewScenario(
  value: string | null,
): ReviewScenario | null {
  return REVIEW_SCENARIOS.some((item) => item.id === value)
    ? (value as ReviewScenario)
    : null
}

const demoDashboard = (
  boardId: string,
  name: string,
  reviewMode: SavedDashboard['reviewMode'],
): SavedDashboard => ({
  id: `demo:${boardId}`,
  name,
  connectionId: 'demo',
  provider: 'demo',
  boardId,
  filters: {
    selectedColumnIds: ['stage-1', 'stage-2'],
    windowDays: 90,
    ticketTypes: [],
  },
  metrics: defaultMetrics,
  reviewMode,
})

function startingSession(scenario: ReviewScenario): WorkspaceSession {
  return {
    workspaceRole: 'owner',
    user: { id: 'review-user', username: 'reviewer' },
    workspaceName: 'Product delivery',
    connections:
      scenario === 'new'
        ? []
        : [
            {
              id: 'review-jira',
              name: 'Company Jira',
              provider: 'jira',
              jiraEdition: 'cloud',
              projectKey: 'SHOP',
            },
          ],
    dashboards:
      scenario === 'briefings'
        ? [
            demoDashboard('demo-product', 'Product delivery · Demo', 'daily'),
            demoDashboard(
              'demo-platform',
              'Platform delivery · Demo',
              'weekly',
            ),
          ]
        : [],
    ...(scenario === 'briefings'
      ? {
          ai: { provider: 'anthropic' as const, model: 'claude-sonnet-5-5' },
          github: REVIEW_GITHUB,
          figma: { connected: true as const },
        }
      : {}),
  }
}

/** A fictional connection: one repository with linked pull requests, one without. */
const REVIEW_GITHUB = {
  host: 'git.example.invalid',
  repositories: ['acme/shop', 'acme/docs'],
  checkedAt: '2026-11-06T09:00:00.000Z',
  checks: [
    { name: 'acme/shop', read: 87, linked: 64 },
    { name: 'acme/docs', read: 12, linked: 0 },
  ],
}

const SAMPLE_ANSWER = `Four items need you before stand-up.

- DEMO-36 has been in progress for 20 days, 2.9× the usual 7. Ask what is blocking it.
- DEMO-35 and DEMO-34 are past the usual limit too, both in In progress.
- Nothing is waiting in Review, so the pile-up is in the work itself, not in handoffs.

This is a sample answer in review mode; no AI provider was called.`

/** A checked card, as the server sends it for a why question. */
const SAMPLE_CARD: AnswerCard = {
  verdict: '**DEMO-36 is waiting on a design decision**, not on development.',
  confidence: 'possible',
  basis: 'Only Jira shows it',
  sources: ['Jira'],
  reasons: [
    {
      kind: 'supports',
      source: 'Jira',
      keys: [],
      fact: 'Last comment, 8 Sep: “Waiting for the design decision on the zoom gesture.”',
    },
    {
      kind: 'rules-out',
      source: 'Board',
      keys: [],
      fact: 'Not a review queue: nothing is waiting in Review.',
    },
    {
      kind: 'unchecked',
      source: 'Jira',
      keys: ['DEMO-35'],
      fact: 'DEMO-35 may wait on the same decision.',
    },
  ],
  options: [
    {
      what: 'Ask design for the decision on DEMO-36 by Thursday.',
      tradeOff: 'Cheap; enough if the choice is small.',
      checkpoint: 'A decision comment on DEMO-36 by Thursday.',
      keys: ['DEMO-36'],
      recommended: true,
    },
    {
      what: 'Ship DEMO-36 with the current gesture and revisit later.',
      tradeOff: 'Finishes now; may need rework.',
      checkpoint: 'DEMO-36 in Done this week.',
      keys: ['DEMO-36'],
    },
  ],
  why: 'the work is done apart from one choice.',
  next: 'Ask the assignee whether design has answered, and agree a date for the decision.',
  checkpoint: 'DEMO-36 leaves In progress by the next refresh.',
  removed: ['option “Improve team communication”: generic advice'],
}

/** Replaces window.fetch for /api/* with sample answers for one scenario. */
export function installReviewApi(scenario: ReviewScenario) {
  let session: WorkspaceSession | null = startingSession(scenario)
  const realFetch = window.fetch.bind(window)

  const answer = (status: number, body: unknown) =>
    new Promise<Response>((resolve) =>
      // A short pause keeps loading states visible, as on a real server.
      window.setTimeout(() => resolve(Response.json(body, { status })), 250),
    )
  const unavailable = (what: string) =>
    answer(400, {
      error: `${what} isn’t available in review mode. Open a demo briefing instead.`,
    })

  window.fetch = async (input, init) => {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const url = new URL(href, window.location.origin)
    // Hosted sign-in pages and non-API requests keep talking to the dev server.
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/api/hosted/')
    )
      return realFetch(input, init)

    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname
    const body: Record<string, unknown> =
      typeof init?.body === 'string' && init.body
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {}

    if (path === '/api/auth/session') return answer(200, { session })
    if (path === '/api/auth/providers')
      return answer(200, {
        google: false,
        atlassian: false,
        jiraCloudToken: true,
        trello: true,
      })
    if (path === '/api/auth/logout') {
      session = null
      return answer(200, {})
    }
    if (path === '/api/auth/login' || path === '/api/auth/register') {
      session = startingSession(scenario)
      return answer(200, { session })
    }
    if (!session) return answer(401, { error: 'Sign in again.' })

    if (path === '/api/workspace/dashboards' && method === 'PUT') {
      const dashboard = body as unknown as SavedDashboard
      session = {
        ...session,
        dashboards: [
          ...session.dashboards.filter((item) => item.id !== dashboard.id),
          dashboard,
        ],
      }
      return answer(200, { session })
    }
    if (path.startsWith('/api/workspace/dashboards/') && method === 'DELETE') {
      const id = decodeURIComponent(path.split('/').pop() ?? '')
      session = {
        ...session,
        dashboards: session.dashboards.filter((item) => item.id !== id),
      }
      return answer(200, { session })
    }
    if (/^\/api\/workspace\/connections\/[^/]+\/boards$/.test(path))
      return answer(200, {
        boards: [
          { id: '101', name: 'Checkout team' },
          { id: '102', name: 'Platform team' },
        ],
      })
    if (path.endsWith('/snapshot')) return unavailable('Loading a real board')
    if (path.startsWith('/api/workspace/connections') && method === 'DELETE') {
      session = { ...session, connections: [] }
      return answer(200, { session })
    }
    if (path === '/api/workspace/ai-models')
      return answer(200, {
        models: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
      })
    if (path === '/api/workspace/github-settings') {
      session =
        method === 'DELETE'
          ? { ...session, github: undefined }
          : { ...session, github: REVIEW_GITHUB }
      return answer(200, { session })
    }
    if (path === '/api/workspace/figma-settings') {
      session =
        method === 'DELETE'
          ? { ...session, figma: undefined }
          : { ...session, figma: { connected: true } }
      return answer(200, { session })
    }
    if (path === '/api/workspace/figma/files')
      return answer(200, {
        files: [{ key: 'FictionalFileKey01', name: 'Checkout redesign' }],
      })
    if (path === '/api/workspace/github/pull-requests')
      return answer(200, demoCodeTrail(demoSnapshot('demo-product')))
    if (path === '/api/workspace/ai-settings') {
      session =
        method === 'DELETE'
          ? { ...session, ai: undefined }
          : {
              ...session,
              ai: {
                provider: 'anthropic',
                model:
                  typeof body.model === 'string' && body.model
                    ? body.model
                    : 'claude-sonnet-5-5',
              },
            }
      return answer(200, { session })
    }
    if (path === '/api/ai/config')
      return answer(200, {
        configured: Boolean(session.ai),
        source: session.ai ? 'anthropic' : null,
        missing: session.ai ? [] : ['API key'],
        invalid: [],
      })
    if (path === '/api/ai/chat') {
      const messages = Array.isArray(body.messages)
        ? (body.messages as Array<{ content?: string }>)
        : []
      const question = messages.at(-1)?.content ?? ''
      // Why and what-to-do questions answer as a card, as the real server does.
      const isCard = /^\s*(why|what should|what to raise)/i.test(question)
      const result = isCard
        ? { message: answerCardText(SAMPLE_CARD), card: SAMPLE_CARD }
        : { message: SAMPLE_ANSWER }
      const accept = new Headers(init?.headers).get('accept') ?? ''
      if (!accept.includes('ndjson')) return answer(200, result)
      // As the real server streams: a read, then the answer piece by piece.
      const written = isCard
        ? JSON.stringify({
            verdict: SAMPLE_CARD.verdict,
            next: SAMPLE_CARD.next,
            checkpoint: SAMPLE_CARD.checkpoint,
            reasons: SAMPLE_CARD.reasons,
          })
        : SAMPLE_ANSWER
      const pieces = written.match(/.{1,12}/gs) ?? []
      const lines = [
        { type: 'progress', step: 'plan', label: 'Planning' },
        {
          type: 'progress',
          step: 'jira',
          label:
            'Read DEMO-36 in detail: description, comments, history and links',
          detail: 'Read-only · Jira',
        },
        { type: 'progress', step: 'plan', label: 'Thinking', detail: '1 item' },
        ...pieces.map((text) => ({ type: 'text', text })),
        { type: 'result', value: result },
      ]
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const line of lines) {
            controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
            await new Promise((resolve) =>
              window.setTimeout(resolve, line.type === 'text' ? 60 : 500),
            )
          }
          controller.close()
        },
      })
      return new Response(stream, {
        headers: { 'content-type': 'application/x-ndjson' },
      })
    }

    return unavailable('This action')
  }
}
