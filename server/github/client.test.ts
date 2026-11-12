// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GithubClient,
  GithubError,
  graphqlEndpoint,
  tokenAccess,
} from './client'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<
    (
      input: string,
      init: {
        method?: string
        headers: Record<string, string>
        body: string
      },
    ) => Promise<Response>
  >(),
}))
vi.mock('undici', () => ({ fetch: mocks.fetch, ProxyAgent: class {} }))
afterEach(() => vi.resetAllMocks())

const client = () =>
  new GithubClient({ baseUrl: 'https://git.example.invalid', token: 'tok' })
const answer = (data: unknown, errors?: unknown[]) =>
  new Response(JSON.stringify({ data, ...(errors ? { errors } : {}) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
const pr = (overrides: Record<string, unknown>) => ({
  number: 1,
  url: 'https://git.example.invalid/acme/web/pull/1',
  title: 'FLOW-1: fictional change',
  headRefName: 'feature/flow-1',
  isDraft: false,
  createdAt: '2026-10-01T09:00:00Z',
  updatedAt: '2026-10-05T09:00:00Z',
  mergedAt: null,
  closedAt: null,
  author: { login: 'author-a' },
  reviews: { nodes: [] },
  timelineItems: { nodes: [] },
  ...overrides,
})
const sent = (call: number) =>
  JSON.parse(mocks.fetch.mock.calls[call]![1].body) as {
    query: string
    variables: Record<string, unknown>
  }
const page = (nodes: unknown[], next?: string) =>
  answer({
    repository: {
      nameWithOwner: 'acme/web',
      pullRequests: {
        pageInfo: { hasNextPage: Boolean(next), endCursor: next ?? null },
        nodes,
      },
    },
  })

describe('GithubClient', () => {
  it('finds the API for github.com and for Enterprise Server', () => {
    expect(graphqlEndpoint('https://github.com/acme')).toBe(
      'https://api.github.com/graphql',
    )
    expect(graphqlEndpoint('https://git.example.invalid/acme/web')).toBe(
      'https://git.example.invalid/api/graphql',
    )
    expect(() => graphqlEndpoint('http://git.example.invalid')).toThrow(
      GithubError,
    )
  })

  it('only sends read queries, with the token as a Bearer header', async () => {
    mocks.fetch.mockResolvedValue(answer({ viewer: { id: 'x' } }))
    await client().verify()
    const [url, init] = mocks.fetch.mock.calls[0]!
    expect(url).toBe('https://git.example.invalid/api/graphql')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(sent(0).query).toMatch(/^query\b/)
    expect(init.body).not.toMatch(/mutation/i)
  })

  it('keeps timing and keys only, and ignores the author replying in review', async () => {
    mocks.fetch.mockResolvedValue(
      page([
        pr({
          isDraft: false,
          timelineItems: { nodes: [{ createdAt: '2026-10-02T09:00:00Z' }] },
          reviews: {
            nodes: [
              // The author answering a thread before anyone reviewed.
              {
                state: 'COMMENTED',
                submittedAt: '2026-10-02T10:00:00Z',
                author: { login: 'author-a' },
              },
              {
                state: 'CHANGES_REQUESTED',
                submittedAt: '2026-10-03T09:00:00Z',
                author: { login: 'reviewer-b' },
              },
              {
                state: 'APPROVED',
                submittedAt: '2026-10-04T09:00:00Z',
                author: { login: 'reviewer-b' },
              },
              { state: 'PENDING', submittedAt: null, author: null },
            ],
          },
          mergedAt: '2026-10-05T09:00:00Z',
        }),
      ]),
    )
    const [record] = await client().pullRequests(
      'acme/web',
      new Date('2026-09-01T00:00:00Z'),
    )
    expect(record).toEqual({
      repo: 'acme/web',
      number: 1,
      url: 'https://git.example.invalid/acme/web/pull/1',
      keys: ['FLOW-1'],
      changesRequested: 1,
      comments: 0,
      lastActivityAt: '2026-10-05T09:00:00Z',
      readyAt: '2026-10-02T09:00:00Z',
      firstReviewAt: '2026-10-03T09:00:00Z',
      approvedAt: '2026-10-04T09:00:00Z',
      mergedAt: '2026-10-05T09:00:00Z',
    })
    // Nothing that names a person or carries the title leaves the server.
    expect(JSON.stringify(record)).not.toMatch(/author|reviewer|fictional/)
  })

  it('keeps the size and, for open pull requests, the latest checks', async () => {
    const rollup = (state: string | null) => ({
      nodes: [{ commit: { statusCheckRollup: state ? { state } : null } }],
    })
    mocks.fetch.mockResolvedValue(
      page([
        pr({
          number: 5,
          additions: 420,
          deletions: 80,
          changedFiles: 12,
          commits: rollup('FAILURE'),
        }),
        pr({ number: 6, commits: rollup('PENDING') }),
        pr({ number: 7, commits: rollup(null) }),
        // Merged: its checks no longer matter.
        pr({
          number: 8,
          mergedAt: '2026-10-05T09:00:00Z',
          commits: rollup('FAILURE'),
        }),
      ]),
    )
    const records = await client().pullRequests('acme/web', new Date(0))
    expect(records[0]).toMatchObject({
      linesChanged: 500,
      filesChanged: 12,
      checks: 'failing',
    })
    expect(records[1]?.checks).toBe('running')
    expect(records[2]).not.toHaveProperty('checks')
    expect(records[3]).not.toHaveProperty('checks')
    expect(sent(0).query).toContain('statusCheckRollup')
  })

  it('reads on when the token may not see checks', async () => {
    mocks.fetch.mockResolvedValue(
      answer(
        {
          repository: {
            nameWithOwner: 'acme/web',
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                pr({
                  number: 9,
                  commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
                }),
              ],
            },
          },
        },
        [
          {
            type: 'FORBIDDEN',
            message: 'Resource not accessible by personal access token',
            path: [
              'repository',
              'pullRequests',
              'nodes',
              0,
              'commits',
              'nodes',
              0,
              'commit',
              'statusCheckRollup',
            ],
          },
        ],
      ),
    )
    const records = await client().pullRequests('acme/web', new Date(0))
    expect(records.map((record) => record.number)).toEqual([9])
    expect(records[0]).not.toHaveProperty('checks')
  })

  it('treats a draft as not yet waiting and skips pull requests with no key', async () => {
    mocks.fetch.mockResolvedValue(
      page([
        pr({ number: 2, isDraft: true }),
        pr({ number: 3, title: 'Bump dependencies', headRefName: 'deps' }),
        pr({
          number: 4,
          closedAt: '2026-10-04T09:00:00Z',
          title: 'FLOW-4 and FLOW-5',
        }),
      ]),
    )
    const records = await client().pullRequests('acme/web', new Date(0))
    expect(records.map((record) => record.number)).toEqual([2, 4])
    expect(records[0]).not.toHaveProperty('readyAt')
    expect(records[1]).toMatchObject({
      keys: ['FLOW-4', 'FLOW-5', 'FLOW-1'],
      closedAt: '2026-10-04T09:00:00Z',
    })
  })

  it('pages back until pull requests are older than the period', async () => {
    mocks.fetch
      .mockResolvedValueOnce(page([pr({ number: 10 })], 'cursor-1'))
      .mockResolvedValueOnce(
        page([
          pr({ number: 11 }),
          pr({ number: 12, updatedAt: '2026-08-01T00:00:00Z' }),
          pr({ number: 13 }),
        ]),
      )
    const records = await client().pullRequests(
      'acme/web',
      new Date('2026-09-01T00:00:00Z'),
    )
    expect(records.map((record) => record.number)).toEqual([10, 11])
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(sent(1).variables.after).toBe('cursor-1')
  })

  it('says when the token cannot see a repository, as a pending token cannot', async () => {
    mocks.fetch.mockResolvedValue(
      answer({ repository: null }, [{ type: 'NOT_FOUND', message: 'x' }]),
    )
    await expect(client().repository('acme/web')).rejects.toMatchObject({
      reason: 'github-repo-not-visible',
    })
  })

  it('reports a classic token’s scopes and expiry from GitHub’s headers', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { viewer: { id: 'x' } } }), {
        status: 200,
        headers: {
          'X-OAuth-Scopes': 'repo, read:org',
          'GitHub-Authentication-Token-Expiration': '2026-11-13 09:00:00 UTC',
        },
      }),
    )
    await expect(client().verify()).resolves.toEqual({
      scopes: ['repo', 'read:org'],
      expiresAt: '2026-11-13T09:00:00.000Z',
    })
    expect(
      tokenAccess(
        new Headers({
          'GitHub-Authentication-Token-Expiration': '2026-11-13 10:00:00 +0100',
        }),
      ),
    ).toEqual({ expiresAt: '2026-11-13T09:00:00.000Z' })
    expect(tokenAccess(new Headers())).toEqual({})
  })

  it('refuses to send anything but its fixed read queries', async () => {
    const query = (
      client() as unknown as {
        query: (document: string, variables: object) => Promise<unknown>
      }
    ).query.bind(client())
    await expect(
      query(
        'mutation { deleteRepository(input: {}) { clientMutationId } }',
        {},
      ),
    ).rejects.toThrow('only sends read queries')
    await expect(query('query { viewer { login } }', {})).rejects.toThrow(
      'only sends read queries',
    )
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('explains a rejected token and a web page answer', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('', { status: 401 }))
    await expect(client().verify()).rejects.toMatchObject({
      reason: 'github-token-rejected',
    })
    mocks.fetch.mockResolvedValueOnce(
      new Response('<html>Sign in</html>', { status: 200 }),
    )
    await expect(client().verify()).rejects.toThrow('web page')
  })

  it('reads branches that name an item: keys and last commit only', async () => {
    mocks.fetch.mockResolvedValue(
      answer({
        repository: {
          nameWithOwner: 'acme/web',
          refs: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                name: 'feature/flow-7-secret-customer-name',
                target: { committedDate: '2026-10-20T09:00:00Z' },
              },
              {
                name: 'main',
                target: { committedDate: '2026-10-21T09:00:00Z' },
              },
              {
                name: 'FLOW-8',
                target: { committedDate: '2020-01-01T00:00:00Z' },
              },
            ],
          },
        },
      }),
    )
    const branches = await client().branches(
      'acme/web',
      new Date('2026-09-01T00:00:00Z'),
    )
    expect(branches).toEqual([
      {
        repo: 'acme/web',
        keys: ['FLOW-7'],
        lastCommitAt: '2026-10-20T09:00:00Z',
      },
    ])
    expect(JSON.stringify(branches)).not.toMatch(/secret|feature/)
    expect(sent(0).query).toMatch(/^query\b/)
  })

  it('tries a dropped connection again, then says so plainly', async () => {
    mocks.fetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(answer({ viewer: { id: 'x' } }))
    await expect(client().verify()).resolves.toEqual({})
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    mocks.fetch.mockReset()
    mocks.fetch.mockRejectedValue(new TypeError('fetch failed'))
    await expect(client().verify()).rejects.toThrow('could not be reached')
    expect(mocks.fetch).toHaveBeenCalledTimes(3)
  })
})
