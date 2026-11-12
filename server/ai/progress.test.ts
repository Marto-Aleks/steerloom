// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MockAgent } from 'undici'
import { afterEach, expect, it } from 'vitest'
import { PROGRESS_CONTENT_TYPE } from '../../src/lib/progress'
import { aiConfigFromKey } from './workspace-key'
import { createAiHandler } from './vite-plugin'

const validRequest = {
  context: {
    generatedAt: '2026-09-10T09:00:00Z',
    sourceLabel: 'DEMO · Fictional board',
    boardName: 'Fictional board',
    scope: {
      selectedColumns: ['In Progress'],
      ticketTypes: ['Story'],
      windowDays: 30,
    },
    headline: {
      completedObservations: 3,
      medianCycleTimeDays: 5,
      percentile85CycleTimeDays: 9,
      exitThroughputPerWeek: 0.7,
    },
    ticketGroupTotals: {
      completedOutliers: 0,
      delayedWorkInProgress: 0,
      reenteredWorkInProgress: 0,
    },
    focusSignals: [],
    weeklyThroughput: [],
    cycleTimeDistribution: [],
    weeklyCycleTimeTrend: [],
    delayedWorkInProgress: [],
    completedOutliers: [],
    reenteredWorkInProgress: [],
  },
  messages: [{ role: 'user', content: 'What should the team discuss?' }],
}

let server: Server | undefined
afterEach(() => server?.close())

async function start() {
  const agent = new MockAgent()
  agent.disableNetConnect()
  agent
    .get('https://api.openai.com')
    .intercept({ path: '/v1/chat/completions', method: 'POST' })
    .reply(200, { choices: [{ message: { content: 'Fictional answer.' } }] })
    .persist()
  const handle = createAiHandler(
    () => [],
    undefined,
    () => true,
    () =>
      aiConfigFromKey(
        {
          provider: 'openai',
          apiKey: 'fictional-key-123',
          model: 'fictional-model',
        },
        { dispatcher: agent },
      ),
  )
  server = createServer((request, response) => {
    void handle(request, response, () => response.end())
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

it('streams the steps of an answer when the browser asks for progress', async () => {
  const origin = await start()
  const response = await fetch(`${origin}/api/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: PROGRESS_CONTENT_TYPE,
    },
    body: JSON.stringify(validRequest),
  })
  expect(response.headers.get('content-type')).toContain(PROGRESS_CONTENT_TYPE)
  const lines = (await response.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type: string; step?: string })
  expect(
    lines.filter((line) => line.type === 'progress').map((l) => l.step),
  ).toEqual(['read', 'answer'])
  expect(lines.at(-1)).toMatchObject({
    type: 'result',
    value: { message: 'Fictional answer.' },
  })
})

it('keeps answering with plain JSON for other clients', async () => {
  const origin = await start()
  const response = await fetch(`${origin}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validRequest),
  })
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(await response.json()).toMatchObject({ message: 'Fictional answer.' })
})

it('on a gateway without tools, the planner asks before reading the board', async () => {
  const seen: string[] = []
  const agent = new MockAgent()
  agent.disableNetConnect()
  const openai = agent.get('https://api.openai.com')
  // The agent's first request carries tools: this gateway refuses them.
  openai
    .intercept({ path: '/v1/chat/completions', method: 'POST' })
    .reply(400, {
      error: { message: 'Unrecognized request argument supplied: tools' },
    })
  openai
    .intercept({ path: '/v1/chat/completions', method: 'POST' })
    .reply(200, { choices: [{ message: { content: 'Fictional answer.' } }] })
    .persist()
  const handle = createAiHandler(
    () => [],
    () =>
      Promise.resolve({
        label: 'Jira',
        keyExample: 'DEMO-1',
        normaliseKey: (raw: string) => raw.toUpperCase(),
        items: (keys: string[]) => {
          seen.push(...keys)
          return Promise.resolve({ items: [], unavailable: keys })
        },
        search: () => Promise.resolve({ items: [], total: 0, more: false }),
      }),
    () => true,
    () =>
      aiConfigFromKey(
        {
          provider: 'openai',
          apiKey: 'fictional-key-123',
          model: 'fictional-model',
        },
        { dispatcher: agent },
      ),
  )
  server = createServer((request, response) => {
    void handle(request, response, () => response.end())
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const ask = (body: object) =>
    fetch(`${origin}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validRequest,
        jiraScope: { connectionId: 'c1', projectKey: 'DEMO' },
        messages: [{ role: 'user', content: 'Why is DEMO-36 stuck?' }],
        ...body,
      }),
    }).then((response) => response.json() as Promise<Record<string, unknown>>)

  // Not allowed yet: a confirmation comes back and nothing was read.
  const first = await ask({ allowJiraForConversation: false })
  expect(first.confirmation).toMatchObject({ lookup: { keys: ['DEMO-36'] } })
  expect(seen).toEqual([])

  // Approved: the same lookup runs.
  const second = await ask({
    agentApproval: {
      plan: (first.confirmation as { plan: unknown }).plan,
      allowJira: true,
    },
  })
  expect(second.message).toBe('Fictional answer.')
  expect(seen).toEqual(['DEMO-36'])
})

it('still answers when the planner call fails', async () => {
  const agent = new MockAgent()
  agent.disableNetConnect()
  // The first call is the planner: it fails. The answer call succeeds.
  const openai = agent.get('https://api.openai.com')
  openai
    .intercept({ path: '/v1/chat/completions', method: 'POST' })
    .reply(500, { error: { message: 'fictional outage' } })
  openai
    .intercept({ path: '/v1/chat/completions', method: 'POST' })
    .reply(200, { choices: [{ message: { content: 'Fictional answer.' } }] })
    .persist()
  const handle = createAiHandler(
    () => [],
    undefined,
    () => true,
    () =>
      aiConfigFromKey(
        {
          provider: 'openai',
          apiKey: 'fictional-key-123',
          model: 'fictional-model',
        },
        { dispatcher: agent },
      ),
  )
  server = createServer((request, response) => {
    void handle(request, response, () => response.end())
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const answer = await fetch(`${origin}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...validRequest,
      jiraScope: { connectionId: 'c1', projectKey: 'DEMO' },
      allowJiraForConversation: true,
      messages: [{ role: 'user', content: 'Why is work piling up?' }],
    }),
  }).then((response) => response.json() as Promise<Record<string, unknown>>)
  expect(answer.message).toBe('Fictional answer.')
})
