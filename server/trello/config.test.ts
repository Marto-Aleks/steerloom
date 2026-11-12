// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadTrelloProxy } from './config'

const directories: string[] = []
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
)
describe('Trello proxy configuration', () => {
  it('inherits Jira routing unless explicitly overridden, including direct access', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flowlens-proxy-test-'))
    directories.push(cwd)
    const fallback = 'http://jira-proxy.example:8080'
    expect(loadTrelloProxy(fallback, cwd, {})).toBe(fallback)
    writeFileSync(
      join(cwd, '.env.local'),
      'UNRELATED=ignored\nexport FLOWLENS_TRELLO_PROXY="http://trello-proxy.example:8080"\n',
    )
    expect(loadTrelloProxy(fallback, cwd, {})).toBe(
      'http://trello-proxy.example:8080',
    )
    expect(
      loadTrelloProxy(fallback, cwd, { FLOWLENS_TRELLO_PROXY: 'direct' }),
    ).toBeUndefined()
    expect(
      loadTrelloProxy(fallback, cwd, {
        FLOWLENS_TRELLO_PROXY: 'http://shell-proxy.example:8080',
      }),
    ).toBe('http://shell-proxy.example:8080')
    writeFileSync(join(cwd, '.env.local'), 'FLOWLENS_TRELLO_PROXY=direct\n')
    expect(loadTrelloProxy(fallback, cwd, {})).toBeUndefined()
  })
})
