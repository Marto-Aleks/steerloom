// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MockAgent } from 'undici'
import { afterEach, expect, it } from 'vitest'
import type { AiJiraIssueEvidence } from '../../src/lib/ai/jira-evidence'
import type { BoardReader, BoardSearch } from './board-reader'
import {
  askedKeys,
  firstSentence,
  notOnBoard,
  toollessEndpoints,
} from './agent'
import { aiConfigFromKey } from './workspace-key'
import { createAiHandler } from './vite-plugin'

/*
 * The assistant as an agent, end to end through the handler: the model asks
 * for board reads with tools, Steerloom asks the person once, reads, hands
 * the results back, and the model answers. One stand-in model per format.
 */

const context = {
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
    delayedWorkInProgress: 1,
    reenteredWorkInProgress: 0,
  },
  focusSignals: [],
  weeklyThroughput: [],
  cycleTimeDistribution: [],
  weeklyCycleTimeTrend: [],
  delayedWorkInProgress: [
    { key: 'DEMO-36', status: 'In Progress', ageDays: 20 },
  ],
  completedOutliers: [],
  reenteredWorkInProgress: [],
}

const item: AiJiraIssueEvidence = {
  key: 'DEMO-36',
  summary: 'Image zoom stuck on the first photo',
  issueType: 'Story',
  status: 'In Progress',
  statusCategory: 'In Progress',
  priority: 'High',
  assignee: 'Fictional Person',
  components: [],
  comments: [
    {
      author: 'Fictional Reviewer',
      createdAt: '2026-09-08T10:00:00.000Z',
      body: 'Waiting for the design decision on the zoom gesture.',
    },
  ],
}

/** A board that records what was asked of it. */
function fakeBoard() {
  const reads: Array<{ keys: string[]; detail: boolean }> = []
  const searches: BoardSearch[] = []
  const reader: BoardReader = {
    label: 'Jira',
    keyExample: 'DEMO-123',
    normaliseKey: (raw) =>
      /^DEMO-\d+$/i.test(raw.trim()) ? raw.trim().toUpperCase() : null,
    items: (keys, detail) => {
      reads.push({ keys, detail })
      return Promise.resolve({
        items: keys.includes('DEMO-36') ? [item] : [],
        unavailable: keys.filter((key) => key !== 'DEMO-36'),
      })
    },
    search: (query) => {
      searches.push(query)
      return Promise.resolve({ items: [item], total: 1, more: false })
    },
  }
  return { reader, reads, searches }
}

/** A stand-in model: answers from a script, keeps every request body. */
function model(
  host: string,
  path: string | RegExp,
  answers: Array<Record<string, unknown> | { status: number; body: object }>,
) {
  const agent = new MockAgent()
  agent.disableNetConnect()
  const bodies: Array<Record<string, unknown>> = []
  agent
    .get(host)
    .intercept({
      path: (value) =>
        typeof path === 'string' ? value === path : path.test(value),
      method: 'POST',
    })
    .reply((options) => {
      bodies.push(JSON.parse(options.body as string) as Record<string, unknown>)
      const next = answers.shift() ?? { error: 'script ended' }
      return 'status' in next && typeof next.status === 'number'
        ? { statusCode: next.status, data: next.body as object }
        : { statusCode: 200, data: next }
    })
    .persist()
  return { agent, bodies }
}

let server: Server | undefined
afterEach(() => {
  server?.close()
  toollessEndpoints.clear()
})

async function serve(
  provider: 'openai' | 'anthropic' | 'gemini',
  agent: MockAgent,
  reader: BoardReader,
) {
  // Gemini's own format is what company gateways on "google" routes speak.
  const secret =
    provider === 'gemini'
      ? {
          provider: 'custom' as const,
          endpoint: 'https://generativelanguage.googleapis.com/v1beta',
          format: 'gemini' as const,
          apiKey: 'fictional-key-123',
          model: 'fictional-model',
        }
      : { provider, apiKey: 'fictional-key-123', model: 'fictional-model' }
  const handle = createAiHandler(
    () => [],
    () => Promise.resolve(reader),
    () => true,
    () => aiConfigFromKey(secret, { dispatcher: agent }),
  )
  server = createServer((request, response) => {
    void handle(request, response, () => response.end())
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return (body: object) =>
    fetch(`${origin}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context,
        jiraScope: { connectionId: 'c1', projectKey: 'DEMO' },
        messages: [{ role: 'user', content: 'Why is the oldest item stuck?' }],
        ...body,
      }),
    }).then((response) => response.json() as Promise<Record<string, unknown>>)
}

const openAiToolCall = (args: object, name = 'get_items', id = 'call-1') => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      },
    },
  ],
})
const openAiText = (content: string) => ({
  choices: [{ message: { role: 'assistant', content } }],
})

it('asks the person before the first board read, then reads and answers', async () => {
  const board = fakeBoard()
  const { agent, bodies } = model(
    'https://api.openai.com',
    '/v1/chat/completions',
    [
      openAiToolCall({ keys: ['DEMO-36'], detail: true }),
      openAiToolCall({ keys: ['DEMO-36'], detail: true }),
      openAiText('DEMO-36 waits for a design decision.'),
    ],
  )
  const ask = await serve('openai', agent, board.reader)

  const first = await ask({ allowJiraForConversation: false })
  expect(first.confirmation).toMatchObject({
    board: 'Jira',
    requests: [
      'Read DEMO-36 in detail: description, comments, history and links',
    ],
  })
  expect(board.reads).toEqual([])
  // The tools were offered to the model.
  expect(bodies[0]!.tools).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({ name: 'get_items' }) as unknown,
      }),
      expect.objectContaining({
        function: expect.objectContaining({ name: 'search_items' }) as unknown,
      }),
    ]),
  )

  const second = await ask({ allowJiraForConversation: true })
  expect(second.message).toBe('DEMO-36 waits for a design decision.')
  expect(second.jira).toMatchObject({
    checkedKeys: ['DEMO-36'],
    mode: 'detail',
    source: 'agent-selected report tickets',
  })
  expect(board.reads).toEqual([{ keys: ['DEMO-36'], detail: true }])
  // The read went back to the model as a tool result, after its own call.
  const messages = bodies[2]!.messages as Array<Record<string, unknown>>
  const call = messages.at(-2)!
  const result = messages.at(-1)!
  expect(call).toMatchObject({
    role: 'assistant',
    tool_calls: [{ id: 'call-1' }],
  })
  expect(result).toMatchObject({ role: 'tool', tool_call_id: 'call-1' })
  expect(String(result.content)).toContain('Waiting for the design decision')
})

it('answers from the report alone when the person declines', async () => {
  const board = fakeBoard()
  const { agent, bodies } = model(
    'https://api.openai.com',
    '/v1/chat/completions',
    [openAiText('From the report: DEMO-36 is 20 days in progress.')],
  )
  const ask = await serve('openai', agent, board.reader)
  const answer = await ask({ declineBoard: true })
  expect(answer.message).toContain('From the report')
  expect(bodies[0]!.tools).toBeUndefined()
  expect(board.reads).toEqual([])
})

it('searches, reads at most five items in detail at once, and says which were left', async () => {
  const board = fakeBoard()
  const keys = Array.from({ length: 8 }, (_, index) => `DEMO-${30 + index}`)
  const { agent, bodies } = model(
    'https://api.openai.com',
    '/v1/chat/completions',
    [
      openAiToolCall(
        { assignee: 'unassigned', state: 'open' },
        'search_items',
        's1',
      ),
      openAiToolCall({ keys, detail: true }, 'get_items', 'g1'),
      openAiText('Done.'),
    ],
  )
  const ask = await serve('openai', agent, board.reader)
  const answer = await ask({ allowJiraForConversation: true })
  expect(answer.message).toBe('Done.')
  expect(board.searches).toEqual([
    expect.objectContaining({ assignee: 'unassigned', state: 'open' }),
  ])
  expect(board.reads[0]!.keys).toHaveLength(5)
  const result = (bodies[2]!.messages as Array<Record<string, unknown>>).at(-1)!
  expect(JSON.parse(String(result.content))).toMatchObject({
    not_read: keys.slice(5),
  })
})

it('stops after the step limit and makes the model answer with what it has', async () => {
  const board = fakeBoard()
  const calls = Array.from({ length: 8 }, (_, index) =>
    openAiToolCall({ keys: ['DEMO-36'] }, 'get_items', `c${index}`),
  )
  const { agent, bodies } = model(
    'https://api.openai.com',
    '/v1/chat/completions',
    [...calls, openAiText('Here is what I found so far.')],
  )
  const ask = await serve('openai', agent, board.reader)
  const answer = await ask({ allowJiraForConversation: true })
  expect(answer.message).toBe('Here is what I found so far.')
  expect(bodies.at(-1)!.tool_choice).toBe('none')
})

it('falls back to the planner when the gateway refuses tools', async () => {
  const board = fakeBoard()
  const { agent, bodies } = model(
    'https://api.openai.com',
    '/v1/chat/completions',
    [
      {
        status: 400,
        body: {
          error: { message: 'Unrecognized request argument supplied: tools' },
        },
      },
      openAiText('Answer without tools.'),
    ],
  )
  const ask = await serve('openai', agent, board.reader)
  const answer = await ask({
    allowJiraForConversation: true,
    messages: [{ role: 'user', content: 'What should the team discuss?' }],
  })
  expect(answer.message).toBe('Answer without tools.')
  expect(bodies.slice(1).every((body) => body.tools === undefined)).toBe(true)
})

it('speaks Anthropic tool use: tool_result travels in the next user turn', async () => {
  const board = fakeBoard()
  const { agent, bodies } = model('https://api.anthropic.com', '/v1/messages', [
    {
      content: [
        { type: 'text', text: 'Let me check.' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'get_items',
          input: { keys: ['DEMO-36'], detail: true },
        },
      ],
      stop_reason: 'tool_use',
    },
    { content: [{ type: 'text', text: 'It waits for design.' }] },
  ])
  const ask = await serve('anthropic', agent, board.reader)
  const answer = await ask({ allowJiraForConversation: true })
  expect(answer.message).toBe('It waits for design.')
  expect(bodies[0]!.tools).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'get_items',
        input_schema: expect.any(Object) as unknown,
      }),
    ]),
  )
  const messages = bodies[1]!.messages as Array<{
    role: string
    content: unknown
  }>
  expect(messages.at(-2)).toMatchObject({
    role: 'assistant',
    content: [{ type: 'text' }, { type: 'tool_use', id: 'toolu_1' }],
  })
  expect(messages.at(-1)).toMatchObject({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }],
  })
})

it('speaks Gemini function calling and replays its parts with their signatures', async () => {
  const board = fakeBoard()
  const { agent, bodies } = model(
    'https://generativelanguage.googleapis.com',
    /:generateContent$/,
    [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'search_items',
                    args: { text: 'zoom', state: 'open' },
                  },
                  thoughtSignature: 'fictional-signature',
                },
              ],
            },
          },
        ],
      },
      {
        candidates: [{ content: { parts: [{ text: 'One open zoom item.' }] } }],
      },
    ],
  )
  const ask = await serve('gemini', agent, board.reader)
  const answer = await ask({ allowJiraForConversation: true })
  expect(answer.message).toBe('One open zoom item.')
  expect(board.searches).toEqual([
    expect.objectContaining({ text: 'zoom', state: 'open' }),
  ])
  expect(bodies[0]!.tools).toEqual([
    {
      functionDeclarations: expect.arrayContaining([
        expect.objectContaining({ name: 'search_items' }),
      ]) as unknown,
    },
  ])
  const contents = bodies[1]!.contents as Array<{
    role: string
    parts: unknown[]
  }>
  expect(contents.at(-2)).toEqual({
    role: 'model',
    parts: [
      {
        functionCall: {
          name: 'search_items',
          args: { text: 'zoom', state: 'open' },
        },
        thoughtSignature: 'fictional-signature',
      },
    ],
  })
  expect(contents.at(-1)).toMatchObject({
    role: 'user',
    parts: [{ functionResponse: { name: 'search_items' } }],
  })
})

it('gives a thinking model a second try with twice the room', async () => {
  const board = fakeBoard()
  const { agent, bodies } = model(
    'https://api.openai.com',
    '/v1/chat/completions',
    [
      { choices: [{ finish_reason: 'length', message: { content: '' } }] },
      openAiText('Answered with more room.'),
    ],
  )
  const ask = await serve('openai', agent, board.reader)
  const answer = await ask({
    allowJiraForConversation: true,
    messages: [{ role: 'user', content: 'Who holds DEMO-36?' }],
  })
  expect(answer.message).toBe('Answered with more room.')
  expect(bodies[0]!.max_completion_tokens).toBe(16_000)
  expect(bodies[1]!.max_completion_tokens).toBe(32_000)
})

it('asks for less output when the model says the limit is too high', async () => {
  const board = fakeBoard()
  const { agent, bodies } = model(
    'https://api.openai.com',
    '/v1/chat/completions',
    [
      {
        status: 400,
        body: {
          error: {
            message:
              'max_completion_tokens is too large: 16000. This model supports at most 4096 completion tokens.',
          },
        },
      },
      openAiText('Short answer.'),
    ],
  )
  const ask = await serve('openai', agent, board.reader)
  const answer = await ask({
    allowJiraForConversation: true,
    messages: [{ role: 'user', content: 'Who holds DEMO-36?' }],
  })
  expect(answer.message).toBe('Short answer.')
  expect(bodies[1]!.max_completion_tokens).toBe(4_096)
})

it('sends a why answer back once to check the board first', async () => {
  const board = fakeBoard()
  const { agent, bodies } = model(
    'https://api.openai.com',
    '/v1/chat/completions',
    [
      openAiText('Review is probably the constraint.'),
      openAiToolCall({ keys: ['DEMO-36'], detail: true }),
      openAiText('DEMO-36 waits for a design decision.'),
    ],
  )
  const ask = await serve('openai', agent, board.reader)

  const answer = await ask({ allowJiraForConversation: true })
  expect(answer.message).toBe('DEMO-36 waits for a design decision.')
  expect(board.reads).toEqual([{ keys: ['DEMO-36'], detail: true }])
  const nudge = (bodies[1]!.messages as Array<Record<string, unknown>>).at(-1)!
  expect(nudge).toMatchObject({ role: 'user' })
  expect(String(nudge.content)).toContain('check it on the board')
})

it('keeps a working note to its first sentence, short enough for a status line', () => {
  expect(
    firstSentence('  I will read the started items.\nThen weigh them.'),
  ).toBe('I will read the started items.')
  expect(firstSentence('')).toBe('')
  expect(firstSentence('x'.repeat(200))).toHaveLength(150)
})

it('answers in one sentence when the asked item is not on the board', () => {
  const { reader } = fakeBoard()
  expect(askedKeys(reader, 'Why is demo-199 late, and DEMO-199?')).toEqual([
    'DEMO-199',
  ])
  expect(notOnBoard(['DEMO-199'], new Set(), new Set(['DEMO-199']))).toContain(
    '**DEMO-199 is not on this board**',
  )
  // Found, or never looked up: the model's answer stands.
  expect(
    notOnBoard(['DEMO-36'], new Set(['DEMO-36']), new Set()),
  ).toBeUndefined()
  expect(notOnBoard(['DEMO-199'], new Set(), new Set())).toBeUndefined()
  expect(notOnBoard([], new Set(), new Set())).toBeUndefined()
})
