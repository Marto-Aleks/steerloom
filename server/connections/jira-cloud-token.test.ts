// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiJiraLookup } from '../../src/lib/ai/jira-evidence'
import {
  boardReader,
  jiraConnection,
  verifyNewConnection,
  type ConnectionRuntime,
} from '.'

const mocks = vi.hoisted(() => ({
  fetch:
    vi.fn<
      (
        input: string,
        init: { method?: string; headers: Record<string, string> },
      ) => Promise<Response>
    >(),
}))
vi.mock('undici', () => ({ fetch: mocks.fetch, ProxyAgent: class {} }))
afterEach(() => vi.resetAllMocks())

const localRuntime: ConnectionRuntime = {
  proxyUrl: '',
  jiraCloudToken: true,
  accessToken: () => Promise.reject(new Error('OAuth must not be used.')),
}
const oauthRuntime: ConnectionRuntime = {
  proxyUrl: '',
  accessToken: async () => 'fictional-access',
}
const input = {
  provider: 'jira',
  name: 'My Jira',
  baseUrl:
    'https://fictional.atlassian.net/jira/software/c/projects/DEMO/boards/1',
  email: ' person@example.invalid ',
  token: 'fictional-api-token',
}
const basic = `Basic ${Buffer.from('person@example.invalid:fictional-api-token').toString('base64')}`

describe('Jira Cloud with an account email and API token', () => {
  it('verifies boards on the site with Basic auth and stores the token secret', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ values: [{ id: 1, name: 'Board' }], isLast: true }),
    )
    const secret = await verifyNewConnection(input, localRuntime)
    expect(secret).toEqual({
      provider: 'jira',
      jiraEdition: 'cloud',
      name: 'My Jira',
      baseUrl: 'https://fictional.atlassian.net',
      projectKey: 'DEMO',
      email: 'person@example.invalid',
      token: 'fictional-api-token',
    })
    const [url, init] = mocks.fetch.mock.calls[0]!
    expect(url).toBe(
      'https://fictional.atlassian.net/rest/agile/1.0/board?projectKeyOrId=DEMO&startAt=0&maxResults=50',
    )
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe(basic)
  })

  it('uses Cloud v3 search paths on the site for saved connections', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({
        issues: [
          {
            id: '10',
            key: 'DEMO-1',
            fields: {
              summary: 'Fictional',
              created: '2026-10-01T00:00:00Z',
              issuetype: { name: 'Story' },
              status: { name: 'Done' },
            },
          },
        ],
        isLast: true,
      }),
    )
    const secret = {
      provider: 'jira' as const,
      jiraEdition: 'cloud' as const,
      name: 'My Jira',
      baseUrl: 'https://fictional.atlassian.net',
      projectKey: 'DEMO',
      email: 'person@example.invalid',
      token: 'fictional-api-token',
    }
    const lookup: AiJiraLookup = {
      mode: 'overview',
      source: 'named tickets',
      keys: ['DEMO-1'],
      availableCount: 1,
      omittedCount: 0,
    }
    const evidence = await boardReader(
      'c1',
      secret,
      { connectionId: 'c1', projectKey: 'DEMO' },
      localRuntime,
    ).items(lookup.keys, false)
    const [url, init] = mocks.fetch.mock.calls[0]!
    expect(new URL(url).origin).toBe('https://fictional.atlassian.net')
    expect(new URL(url).pathname).toBe('/rest/api/3/search/jql')
    expect(init.headers.Authorization).toBe(basic)
    expect(evidence.items.map((issue) => issue.key)).toEqual(['DEMO-1'])
    expect(JSON.stringify(evidence)).not.toContain('fictional-api-token')
    expect(jiraConnection('c1', secret, localRuntime)).toMatchObject({
      cloud: true,
      baseUrl: 'https://fictional.atlassian.net',
      siteUrl: 'https://fictional.atlassian.net',
    })
  })

  it('rejects invalid email, token, or host before contacting Jira', async () => {
    await expect(
      verifyNewConnection({ ...input, email: 'not-an-email' }, localRuntime),
    ).rejects.toThrow('email address')
    await expect(
      verifyNewConnection({ ...input, token: 'has space' }, localRuntime),
    ).rejects.toThrow('API token')
    await expect(
      verifyNewConnection({ ...input, token: 'x'.repeat(513) }, localRuntime),
    ).rejects.toThrow('API token')
    await expect(
      verifyNewConnection(
        {
          ...input,
          baseUrl: 'https://fictional.atlassian.net:8443/',
          projectKey: 'DEMO',
        },
        localRuntime,
      ),
    ).rejects.toThrow('atlassian.net')
    expect(() =>
      jiraConnection(
        'c1',
        {
          provider: 'jira',
          jiraEdition: 'cloud',
          name: 'Bad',
          baseUrl: 'https://jira.example.invalid',
          projectKey: 'DEMO',
          email: 'person@example.invalid',
          token: 'fictional-api-token',
        },
        localRuntime,
      ),
    ).toThrow('Reconnect Jira Cloud.')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('keeps OAuth as the only Cloud path where an Atlassian app is configured', async () => {
    await expect(verifyNewConnection(input, oauthRuntime)).rejects.toThrow(
      'Connect with Atlassian',
    )
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('explains a rejected email and token without echoing them', async () => {
    mocks.fetch.mockResolvedValue(new Response('', { status: 401 }))
    const failure = verifyNewConnection(input, localRuntime)
    await expect(failure).rejects.toThrow('email and API token')
    await expect(failure).rejects.not.toThrow('fictional-api-token')
  })
})
