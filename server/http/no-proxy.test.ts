// @vitest-environment node
import { expect, it } from 'vitest'
import { bypassesProxy } from './no-proxy'

it('reads NO_PROXY the way curl and undici do', () => {
  const list =
    '*.corp.example.invalid, .intra.example.invalid,10.*,ai.example.invalid:8443'
  const direct = (url: string) => bypassesProxy(url, list)
  expect(direct('https://jira.corp.example.invalid/rest')).toBe(true)
  expect(direct('https://corp.example.invalid')).toBe(true)
  expect(direct('https://wiki.intra.example.invalid')).toBe(true)
  expect(direct('http://10.1.2.3:8080')).toBe(true)
  expect(direct('https://ai.example.invalid:8443/v1')).toBe(true)
  expect(direct('https://ai.example.invalid/v1')).toBe(false)
  expect(direct('https://notcorp.example.invalid')).toBe(false)
  expect(direct('https://api.anthropic.com')).toBe(false)
  expect(bypassesProxy('https://anything.example.invalid', '*')).toBe(true)
  expect(bypassesProxy('https://jira.example.invalid', '')).toBe(false)
  expect(bypassesProxy('not a url', '*')).toBe(false)
})
