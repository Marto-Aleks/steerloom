// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fetchWithRetry, isDropped, retryDelayMs } from './fetch-retry'

const reply = (status: number, retryAfter?: string) => ({
  status,
  headers: {
    get: (name: string) =>
      name === 'retry-after' ? (retryAfter ?? null) : null,
  },
})

describe('fetchWithRetry', () => {
  it('retries a throttled read after the time the provider asks for', async () => {
    const answers = [reply(429, '2'), reply(503), reply(200)]
    const waits: number[] = []
    const response = await fetchWithRetry(async () => answers.shift()!, {
      wait: async (ms) => {
        waits.push(ms)
      },
      random: () => 0,
    })
    expect(response.status).toBe(200)
    expect(waits).toEqual([2000, 1000])
  })

  it('gives up after the last attempt and returns that answer', async () => {
    let calls = 0
    const response = await fetchWithRetry(
      async () => {
        calls++
        return reply(429)
      },
      { wait: async () => {}, random: () => 0 },
    )
    expect(response.status).toBe(429)
    expect(calls).toBe(3)
  })

  it('does not retry other failures or after an abort', async () => {
    let calls = 0
    expect(
      (
        await fetchWithRetry(async () => {
          calls++
          return reply(401)
        })
      ).status,
    ).toBe(401)
    expect(calls).toBe(1)
    const controller = new AbortController()
    controller.abort()
    calls = 0
    await fetchWithRetry(
      async () => {
        calls++
        return reply(503)
      },
      { signal: controller.signal, wait: async () => {} },
    )
    expect(calls).toBe(1)
  })

  it('caps the wait at ten seconds', () => {
    expect(retryDelayMs('120', 1)).toBe(10_000)
    expect(retryDelayMs(null, 6, () => 0)).toBe(10_000)
    expect(retryDelayMs('not a number', 1, () => 0.5)).toBe(750)
  })
})

describe('fetchWithRetry with retryDropped', () => {
  const fast = { wait: async () => {}, random: () => 0 }
  const dropped = () =>
    Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'UND_ERR_SOCKET' },
    })
  /** Never answers until its signal gives up, like a VPN that drops the request. */
  const silent = (signal: AbortSignal | undefined) =>
    new Promise<ReturnType<typeof reply>>((_, reject) =>
      signal?.addEventListener('abort', () => reject(signal.reason as Error)),
    )

  it('tries a cut connection again', async () => {
    let calls = 0
    const response = await fetchWithRetry(
      async () => {
        calls++
        if (calls < 3) throw dropped()
        return reply(200)
      },
      { ...fast, retryDropped: true },
    )
    expect(response.status).toBe(200)
    expect(calls).toBe(3)
  })

  it('gives up on a silent attempt and tries again', async () => {
    let calls = 0
    const response = await fetchWithRetry(
      async (signal) => {
        calls++
        return calls === 1 ? silent(signal) : reply(200)
      },
      { ...fast, retryDropped: true, attemptTimeoutMs: 20 },
    )
    expect(response.status).toBe(200)
    expect(calls).toBe(2)
  })

  it('reports a timeout once every attempt stayed silent', async () => {
    let calls = 0
    await expect(
      fetchWithRetry(
        (signal) => {
          calls++
          return silent(signal)
        },
        { ...fast, retryDropped: true, attemptTimeoutMs: 10 },
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(calls).toBe(3)
  })

  it('does not limit a reply that has started', async () => {
    let attemptSignal: AbortSignal | undefined
    await fetchWithRetry(
      async (signal) => {
        attemptSignal = signal
        return reply(200)
      },
      { ...fast, retryDropped: true, attemptTimeoutMs: 10 },
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(attemptSignal?.aborted).toBe(false)
  })

  it('fails fast on lasting failures, a caller abort, or when not asked', async () => {
    for (const code of ['ENOTFOUND', 'ECONNREFUSED']) {
      let calls = 0
      await expect(
        fetchWithRetry(
          async () => {
            calls++
            throw Object.assign(new TypeError('fetch failed'), {
              cause: { code },
            })
          },
          { ...fast, retryDropped: true },
        ),
      ).rejects.toThrow('fetch failed')
      expect(calls).toBe(1)
    }
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    await expect(
      fetchWithRetry(
        async () => {
          calls++
          throw dropped()
        },
        { ...fast, retryDropped: true, signal: controller.signal },
      ),
    ).rejects.toThrow()
    expect(calls).toBe(1)
    calls = 0
    await expect(
      fetchWithRetry(async () => {
        calls++
        throw dropped()
      }, fast),
    ).rejects.toThrow()
    expect(calls).toBe(1)
  })

  it('tells drops apart from bugs', () => {
    expect(isDropped(dropped())).toBe(true)
    expect(isDropped(new DOMException('late', 'TimeoutError'))).toBe(true)
    expect(isDropped(new Error('bug'))).toBe(false)
    expect(isDropped(undefined)).toBe(false)
  })
})
