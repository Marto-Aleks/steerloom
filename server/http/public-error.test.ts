// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { publicMessage } from './public-error'

afterEach(() => vi.restoreAllMocks())

it('passes on messages written for people', () => {
  expect(publicMessage(new Error('Sign in to continue.'), 'Failed.')).toBe(
    'Sign in to continue.',
  )
  class JiraError extends Error {}
  expect(publicMessage(new JiraError('Jira refused the token.'), 'x')).toBe(
    'Jira refused the token.',
  )
})

it('hides programming, parse and network errors behind the fallback', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const network = Object.assign(
    new Error('connect ECONNREFUSED 10.0.0.4:5432'),
    { code: 'ECONNREFUSED' },
  )
  for (const caught of [
    new TypeError("Cannot read properties of undefined (reading 'id')"),
    new SyntaxError('Unexpected token < in JSON at position 0'),
    network,
    new Error(''),
    'a thrown string',
  ])
    expect(publicMessage(caught, 'Failed.')).toBe('Failed.')
  expect(log).toHaveBeenCalledTimes(4)
})
