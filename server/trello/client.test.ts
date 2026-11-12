// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { TrelloClient, trelloNetworkError } from './client'

describe('Trello connection errors', () => {
  it('explains nested DNS failures without exposing raw request details', () => {
    const error = new Error('fictional secret', {
      cause: { code: 'ENOTFOUND', hostname: 'private-host.example' },
    })
    const message = trelloNetworkError(error, false)
    expect(message).toContain('could not resolve api.trello.com')
    expect(message).toContain('Your token has not been validated')
    expect(message).not.toContain('fictional secret')
    expect(message).not.toContain('private-host')
    expect(trelloNetworkError(error, true)).toContain(
      'configured proxy hostname',
    )
  })
  it.each([
    ['ECONNREFUSED', 'refused'],
    ['UND_ERR_CONNECT_TIMEOUT', 'timed out'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'TLS certificate'],
  ])('provides guidance for %s', (code, expected) => {
    expect(trelloNetworkError({ cause: { code } }, true)).toContain(expected)
  })
  it('handles timeout exceptions and unknown errors safely', () => {
    expect(trelloNetworkError({ name: 'TimeoutError' }, false)).toContain(
      'timed out',
    )
    expect(
      trelloNetworkError(new Error('fictional secret'), false),
    ).not.toContain('fictional secret')
  })
  it('rejects invalid proxy configuration without including its value', () => {
    expect(
      () =>
        new TrelloClient(
          'fictionalkey',
          'fictionaltoken',
          'socks://user:fictionalsecret@proxy.example',
        ),
    ).toThrow('The Trello proxy setting is invalid.')
  })
})
