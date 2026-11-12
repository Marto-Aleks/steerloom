// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { FigmaClient, FigmaError } from './client'

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

const client = () => new FigmaClient({ token: 'fictional-token' })
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

it('only reads, with the token in Figma’s header', async () => {
  mocks.fetch.mockResolvedValue(json({ id: 'fictional' }))
  await client().verify()
  const [url, init] = mocks.fetch.mock.calls[0]!
  expect(url).toBe('https://api.figma.com/v1/me')
  expect(init.method).toBeUndefined()
  expect(init.headers['X-Figma-Token']).toBe('fictional-token')
})

it('explains a rejected token and a file it cannot open', async () => {
  mocks.fetch.mockResolvedValue(
    json({ status: 403, err: 'Invalid token' }, 403),
  )
  await expect(client().verify()).rejects.toMatchObject({
    reason: 'figma-token-rejected',
  })
  mocks.fetch.mockResolvedValue(json({ status: 404, err: 'Not found' }, 404))
  const failure = await client()
    .fileName('FictionalFileKey01')
    .catch((caught: unknown) => caught)
  expect(failure).toBeInstanceOf(FigmaError)
  expect(failure).toMatchObject({ reason: 'figma-file-not-visible' })
})

it('names a file from its metadata', async () => {
  mocks.fetch.mockResolvedValue(json({ file: { name: 'Checkout redesign' } }))
  await expect(client().fileName('FictionalFileKey01')).resolves.toBe(
    'Checkout redesign',
  )
  expect(mocks.fetch.mock.calls[0]![0]).toBe(
    'https://api.figma.com/v1/files/FictionalFileKey01/meta',
  )
})
