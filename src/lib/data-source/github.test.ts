import { describe, expect, it } from 'vitest'
import { pullRequestKeys, unlinkedReason } from './github'

const pull = (
  over: Partial<Parameters<typeof unlinkedReason>[0]>,
): Parameters<typeof unlinkedReason>[0] => ({
  title: 'Fix login',
  branch: 'fix-login',
  description: '',
  commits: [],
  bot: false,
  ...over,
})

describe('pull requests that name no item key', () => {
  it('finds keys in the title or branch, in any case', () => {
    expect(pullRequestKeys('FLOW-131: fix', 'feature/flow-132-login')).toEqual([
      'FLOW-131',
      'FLOW-132',
    ])
  })

  it('names why, in order: bot, description, commits, number, none', () => {
    expect(unlinkedReason(pull({ bot: true, description: 'FLOW-1' }))).toBe(
      'bot',
    )
    expect(
      unlinkedReason(
        pull({ description: 'Closes FLOW-12', commits: ['FLOW-12'] }),
      ),
    ).toBe('description')
    expect(
      unlinkedReason(pull({ commits: ['wip', 'FLOW-12 fix login'] })),
    ).toBe('commits')
    expect(unlinkedReason(pull({ branch: 'feature/1234-login' }))).toBe(
      'number',
    )
    expect(unlinkedReason(pull({ title: 'Fix login (#1234)' }))).toBe('number')
    expect(unlinkedReason(pull({ title: 'AB#1234 fix login' }))).toBe('number')
    expect(unlinkedReason(pull({ title: '1234: fix login' }))).toBe('number')
    expect(unlinkedReason(pull({}))).toBe('none')
  })

  it('does not take technical names, lower case or dates for keys', () => {
    expect(
      unlinkedReason(
        pull({
          description: 'Use UTF-8 and SHA-256; see RFC-7231 and CVE-2024-1234.',
          commits: ['bump react to 18', 'flow-12 lower case'],
        }),
      ),
    ).toBe('none')
    expect(unlinkedReason(pull({ branch: 'release/2026-11-15' }))).toBe('none')
    expect(
      unlinkedReason(pull({ branch: 'dependabot/npm_and_yarn/react-18.3.1' })),
    ).toBe('none')
    expect(unlinkedReason(pull({ title: 'Upgrade to v2' }))).toBe('none')
  })
})
