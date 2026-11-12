// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import {
  checkTokenAccess,
  connectGithub,
  githubSummary,
  readGithubInput,
} from './workspace-github'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('undici', () => ({ fetch: mocks.fetch, ProxyAgent: class {} }))
afterEach(() => vi.resetAllMocks())

it('defaults to github.com and keeps only the origin of a typed address', () => {
  expect(readGithubInput({ token: ' tok ', repositories: 'acme/web' })).toEqual(
    { baseUrl: 'https://github.com', token: 'tok', repositories: ['acme/web'] },
  )
  expect(
    readGithubInput({
      baseUrl: 'https://git.example.invalid/acme/web',
      token: 'tok',
      repositories: 'acme/web',
    }).baseUrl,
  ).toBe('https://git.example.invalid')
  expect(() =>
    readGithubInput({ baseUrl: 'http://git.example.invalid', token: 'x' }),
  ).toThrow('https://')
})

it('keeps the saved token only for the same address', () => {
  const saved = {
    baseUrl: 'https://git.example.invalid',
    token: 'saved',
    repositories: ['acme/web'],
  }
  expect(
    readGithubInput(
      { baseUrl: 'https://git.example.invalid', repositories: 'acme/web' },
      saved,
    ).token,
  ).toBe('saved')
  expect(() =>
    readGithubInput(
      { baseUrl: 'https://github.com', repositories: 'acme/web' },
      saved,
    ),
  ).toThrow('Paste a GitHub token')
  expect(githubSummary(saved)).toEqual({
    host: 'git.example.invalid',
    repositories: ['acme/web'],
  })
})

it('reads names and links, and names what it cannot read', () => {
  const read = (repositories: string) =>
    readGithubInput({ token: 't', repositories }).repositories
  expect(
    read(
      'acme/web, https://git.example.invalid/acme/api.git\nhttps://git.example.invalid/acme/app/pulls acme/web',
    ),
  ).toEqual(['acme/web', 'acme/api', 'acme/app'])
  expect(() => read('MMA-backend, acme/web')).toThrow(
    'Not understood: MMA-backend',
  )
  expect(() => read('')).toThrow('at least one repository')
  expect(() =>
    read(Array.from({ length: 11 }, (_, i) => `acme/r${i}`).join(',')),
  ).toThrow('up to 10')
})

it('checks every repository on save and counts linked pull requests', async () => {
  const reply = (data: unknown) =>
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  const pr = (title: string) => ({
    number: 1,
    url: 'https://git.example.invalid/Acme/Web/pull/1',
    title,
    headRefName: 'main',
    isDraft: false,
    createdAt: '2026-10-01T09:00:00Z',
    updatedAt: '2026-10-05T09:00:00Z',
    reviews: { nodes: [] },
    timelineItems: { nodes: [] },
  })
  mocks.fetch.mockImplementation((_url: string, init: { body: string }) => {
    const query = (JSON.parse(init.body) as { query: string }).query
    if (query.includes('viewer'))
      return Promise.resolve(reply({ viewer: { id: 'x' } }))
    if (query.includes('pullRequests('))
      return Promise.resolve(
        reply({
          repository: {
            nameWithOwner: 'Acme/Web',
            pullRequests: {
              pageInfo: { hasNextPage: false },
              nodes: [pr('FLOW-1 fix'), pr('tidy up'), pr('FLOW-2: add')],
            },
          },
        }),
      )
    return Promise.resolve(reply({ repository: { nameWithOwner: 'Acme/Web' } }))
  })
  const saved = await connectGithub(
    {
      baseUrl: 'https://git.example.invalid',
      token: 'github_pat_fictional',
      repositories: ['acme/web'],
    },
    {},
    undefined,
    new Date('2026-11-06T09:00:00Z'),
  )
  expect(saved.repositories).toEqual(['Acme/Web'])
  expect(saved.checks).toEqual([{ name: 'Acme/Web', read: 3, linked: 2 }])
  expect(saved.checkedAt).toBe('2026-11-06T09:00:00.000Z')
})

it('accepts a classic token only with repo scopes and an expiry', () => {
  const expiresAt = '2026-11-13T09:00:00.000Z'
  expect(
    checkTokenAccess('ghp_fictional', { scopes: ['repo'], expiresAt }),
  ).toEqual({ classic: true, expiresAt })
  expect(() =>
    checkTokenAccess('ghp_fictional', {
      scopes: ['repo', 'workflow', 'delete_repo'],
      expiresAt,
    }),
  ).toThrow('workflow, delete_repo')
  expect(() => checkTokenAccess('ghp_fictional', { scopes: ['repo'] })).toThrow(
    'never expires',
  )
  // A classic token with no scopes reads public repositories only.
  expect(checkTokenAccess('ghp_fictional', { expiresAt })).toEqual({
    classic: true,
    expiresAt,
  })
})

it('leaves fine-grained tokens to their own permissions', () => {
  expect(checkTokenAccess('github_pat_fictional', {})).toEqual({})
  expect(
    githubSummary({
      baseUrl: 'https://git.example.invalid',
      token: 'x',
      repositories: [],
      classic: true,
      expiresAt: '2026-11-13T09:00:00.000Z',
    }),
  ).toEqual({
    host: 'git.example.invalid',
    repositories: [],
    classic: true,
    expiresAt: '2026-11-13T09:00:00.000Z',
  })
})
