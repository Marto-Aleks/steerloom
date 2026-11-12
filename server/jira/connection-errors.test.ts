// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JiraClient } from './jira-client'
const mocks = vi.hoisted(() => ({
  fetch: vi.fn<
    (
      input: string,
      init: {
        method?: string
        headers: Record<string, string>
        redirect?: string
      },
    ) => Promise<Response>
  >(),
}))
vi.mock('undici', () => ({ fetch: mocks.fetch, ProxyAgent: class {} }))
afterEach(() => vi.resetAllMocks())
const client = () =>
  new JiraClient({
    instance: 'fictional',
    baseUrl: 'https://jira.example.invalid',
    pat: 'fictional-pat',
    apiKey: 'fictional-key',
    proxyUrl: '',
    defaultProjectKey: 'DEMO',
    missing: [],
  })
describe('actionable Jira connection failures', () => {
  it('reports an API redirect without following it or exposing credentials', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://login.example.invalid' },
      }),
    )
    await expect(client().listBoards('DEMO')).rejects.toThrow(
      'Jira redirected the API request',
    )
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls[0]?.[1].redirect).toBe('manual')
  })
  it('distinguishes DNS failures, refused connections, and timeouts', async () => {
    for (const [code, expected] of [
      ['ENOTFOUND', 'could not resolve Jira'],
      ['ECONNREFUSED', 'connection was refused'],
      ['UND_ERR_CONNECT_TIMEOUT', 'did not respond in time'],
    ]) {
      mocks.fetch.mockRejectedValueOnce(
        Object.assign(new Error('fictional-sensitive-provider-response'), {
          cause: { code },
        }),
      )
      await expect(client().listBoards('DEMO')).rejects.toThrow(expected)
    }
  })
  it('tries a request the VPN cut off again instead of failing the board', async () => {
    mocks.fetch
      .mockRejectedValueOnce(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'UND_ERR_SOCKET' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          values: [{ id: 7, name: 'Fictional board' }],
          isLast: true,
        }),
      )
    await expect(client().listBoards('DEMO')).resolves.toEqual([
      expect.objectContaining({ id: '7' }),
    ])
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it('explains a token Jira itself refused, without upstream response text', async () => {
    mocks.fetch.mockResolvedValue(
      new Response('fictional-sensitive-provider-response', {
        status: 401,
        headers: {
          'X-AREQUESTID': '1x2',
          'X-Seraph-LoginReason': 'AUTHENTICATED_FAILED',
        },
      }),
    )
    const failure = client().listBoards('DEMO')
    await expect(failure).rejects.toThrow(
      'did not accept this personal access token',
    )
    await expect(failure).rejects.toMatchObject({
      reason: 'jira-token-rejected',
    })
    await expect(failure).rejects.not.toThrow('fictional-sensitive')
  })
  it('recognises a company gateway that wants its own key', async () => {
    mocks.fetch.mockResolvedValue(
      new Response('{"message":"Missing API key"}', { status: 401 }),
    )
    const withoutKey = new JiraClient({
      instance: 'fictional',
      baseUrl: 'https://jira.example.invalid',
      pat: 'fictional-pat',
      apiKey: '',
      proxyUrl: '',
      defaultProjectKey: 'DEMO',
      missing: [],
    })
    const missing = withoutKey.listBoards('DEMO')
    await expect(missing).rejects.toThrow('separate from your Jira token')
    await expect(missing).rejects.toMatchObject({
      reason: 'gateway-key-required',
    })
    // With a key the gateway still refuses: the key itself is wrong.
    mocks.fetch.mockResolvedValue(new Response(null, { status: 403 }))
    const rejected = client().listBoards('DEMO')
    await expect(rejected).rejects.toMatchObject({
      reason: 'gateway-key-rejected',
    })
  })
  it('keeps Jira’s own permission refusals as permission problems', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(null, { status: 403, headers: { 'X-AREQUESTID': '1x2' } }),
    )
    const failure = client().listBoards('DEMO')
    await expect(failure).rejects.toThrow('cannot access this project')
    await expect(failure).rejects.toMatchObject({ reason: undefined })
  })
})

describe('web pages instead of Jira data', () => {
  const config = (
    extra: Partial<ConstructorParameters<typeof JiraClient>[0]>,
  ) =>
    new JiraClient({
      instance: 'fictional',
      baseUrl: 'https://jira.example.invalid',
      pat: 'fictional-pat',
      apiKey: '',
      proxyUrl: '',
      defaultProjectKey: 'DEMO',
      missing: [],
      ...extra,
    })
  const page = (status: number) =>
    new Response('<!DOCTYPE HTML><html><body>Sign in</body></html>', {
      status,
      headers: { 'Content-Type': 'text/html' },
    })

  it('explains a sign-in page answered instead of raw parser text', async () => {
    mocks.fetch.mockResolvedValue(page(200))
    const failure = config({}).listBoards('DEMO')
    await expect(failure).rejects.toThrow('answered with a web page')
    await expect(failure).rejects.not.toThrow('Unexpected token')
    await expect(failure).rejects.toMatchObject({
      reason: 'gateway-key-required',
    })
  })

  it('blames the proxy, not a gateway key, when the page came through one', async () => {
    mocks.fetch.mockResolvedValue(page(200))
    const failure = config({
      proxyUrl: 'http://proxy.example.invalid:3128',
    }).listBoards('DEMO')
    await expect(failure).rejects.toThrow('computer’s proxy answered')
    expect(mocks.fetch.mock.calls[0]?.[1]).toHaveProperty(
      'dispatcher',
      expect.anything(),
    )
    await expect(failure).rejects.not.toMatchObject({
      reason: 'gateway-key-required',
    })
  })

  it('reaches Jira directly when NO_PROXY lists it, as the browser does', async () => {
    vi.stubEnv('NO_PROXY', '*.example.invalid')
    try {
      mocks.fetch.mockResolvedValue(page(200))
      const failure = config({
        proxyUrl: 'http://proxy.example.invalid:3128',
      }).listBoards('DEMO')
      await expect(failure).rejects.toMatchObject({
        reason: 'gateway-key-required',
      })
      expect(mocks.fetch.mock.calls[0]?.[1]).not.toHaveProperty(
        'dispatcher',
        expect.anything(),
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('on the hosted site, points company-internal Jira to the local version', async () => {
    for (const status of [200, 401, 302]) {
      mocks.fetch.mockResolvedValueOnce(page(status))
      const failure = config({ hosted: true }).listBoards('DEMO')
      await expect(failure).rejects.toMatchObject({
        reason: 'jira-not-reachable-hosted',
      })
    }
    mocks.fetch.mockResolvedValueOnce(page(200))
    await expect(config({ hosted: true }).listBoards('DEMO')).rejects.toThrow(
      'Run Steerloom on your own computer',
    )
  })
})
