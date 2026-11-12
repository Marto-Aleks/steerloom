import { describe, expect, it } from 'vitest'
import { loadInstallationProxy, parseProxyEnvironment } from './config'

describe('Installation proxy configuration', () => {
  it('reads only proxy variables from environment files', () => {
    expect(
      parseProxyEnvironment(`
        HTTPS_PROXY="http://proxy.example.invalid:3128"
        export HTTP_PROXY=http://fallback.example.invalid:8080
        JIRA_TOKEN=must-not-be-loaded
      `),
    ).toEqual({
      HTTPS_PROXY: 'http://proxy.example.invalid:3128',
      HTTP_PROXY: 'http://fallback.example.invalid:8080',
    })
  })

  it('prefers process values and falls back to HTTP_PROXY', () => {
    const cwd = '/path/that/does/not/exist'
    expect(
      loadInstallationProxy(cwd, {
        HTTPS_PROXY: ' http://proxy.example.invalid:3128 ',
        HTTP_PROXY: 'http://fallback.example.invalid:8080',
      }),
    ).toBe('http://proxy.example.invalid:3128')
    expect(
      loadInstallationProxy(cwd, {
        HTTP_PROXY: 'http://fallback.example.invalid:8080',
      }),
    ).toBe('http://fallback.example.invalid:8080')
    expect(loadInstallationProxy(cwd, {})).toBe('')
  })
})
