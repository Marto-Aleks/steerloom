// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { checkReach } from './reach'

const at =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address }))
const reply =
  (status: number, headers: Record<string, string>) => async () => ({
    status,
    headers: new Headers(headers),
  })
const PUBLIC = at('93.184.216.34')

describe('checkReach', () => {
  it('reports a Jira that answers itself as reachable, even when it wants a sign-in', async () => {
    const asked: string[] = []
    await expect(
      checkReach('https://jira.example.com/jira', 'jira', {
        lookup: PUBLIC,
        request: async (url) => {
          asked.push(String(url))
          return { status: 401, headers: new Headers({ 'X-AREQUESTID': '1' }) }
        },
      }),
    ).resolves.toBe('reachable')
    // An anonymous product endpoint, never the pasted page, no credentials.
    expect(asked).toEqual([
      'https://jira.example.com/jira/rest/api/2/serverInfo',
    ])
  })

  it('treats a company sign-in page in front of Jira as company-only', async () => {
    // A public gateway (such as WebSEAL) answers with a web page or a redirect.
    for (const request of [
      reply(200, { 'content-type': 'text/html' }),
      reply(302, { location: 'https://login.example.com/pkmslogin.form' }),
    ])
      await expect(
        checkReach('https://jira.example.com/jira', 'jira', {
          lookup: PUBLIC,
          request,
        }),
      ).resolves.toBe('company-network')
  })

  it('accepts data answers, such as an API gateway asking for its key', async () => {
    await expect(
      checkReach('https://jira.example.com', 'jira', {
        lookup: PUBLIC,
        request: reply(401, { 'content-type': 'application/json' }),
      }),
    ).resolves.toBe('reachable')
  })

  it('recognises Azure DevOps Server by its own headers', async () => {
    await expect(
      checkReach('https://tfs.example.com/tfs/Main', 'azure-devops', {
        lookup: PUBLIC,
        request: reply(401, { 'x-tfs-processid': 'abc' }),
      }),
    ).resolves.toBe('reachable')
  })

  it('never contacts an address inside a company network', async () => {
    const request = vi.fn(reply(200, {}))
    await expect(
      checkReach('https://jira.corp.example.com/jira', 'jira', {
        lookup: at('10.1.2.3'),
        request,
      }),
    ).resolves.toBe('company-network')
    await expect(
      checkReach('https://192.168.1.20/jira', 'jira', { request }),
    ).resolves.toBe('company-network')
    expect(request).not.toHaveBeenCalled()
  })

  it('treats names unknown on the internet as company-only', async () => {
    await expect(
      checkReach('https://jira.corp.internal', 'jira', {
        lookup: async () => {
          throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' })
        },
        request: reply(200, {}),
      }),
    ).resolves.toBe('company-network')
  })

  it('treats a public name that never answers as company-only', async () => {
    await expect(
      checkReach('https://jira.example.com', 'jira', {
        lookup: PUBLIC,
        request: async () => {
          throw new Error('timeout')
        },
      }),
    ).resolves.toBe('company-network')
  })

  it('refuses links that are not web addresses', async () => {
    await expect(checkReach('jira.example.com', 'jira')).rejects.toThrow(
      'full link',
    )
    await expect(checkReach('ftp://jira.example.com', 'jira')).rejects.toThrow(
      'https://',
    )
    // Plain http and other ports are never probed from the hosted site.
    await expect(checkReach('http://jira.example.com', 'jira')).rejects.toThrow(
      'https://',
    )
    await expect(
      checkReach('https://jira.example.com:8443', 'jira'),
    ).rejects.toThrow('https://')
  })
})
