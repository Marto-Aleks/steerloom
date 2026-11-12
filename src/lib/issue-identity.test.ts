import { describe, expect, it } from 'vitest'
import {
  duplicateIssueIdentityCount,
  uniqueIssuesByIdentity,
} from './issue-identity'

describe('issue identity', () => {
  it('keeps one record for repeated ids or Jira keys', () => {
    const issues = [
      { id: '1001', key: 'MMA-1' },
      { id: '1001', key: 'MMA-1' },
      { id: '1002', key: ' mma-1 ' },
      { id: '1003', key: 'MMA-3' },
    ]

    expect(uniqueIssuesByIdentity(issues)).toEqual([
      { id: '1001', key: 'MMA-1' },
      { id: '1003', key: 'MMA-3' },
    ])
    expect(duplicateIssueIdentityCount(issues)).toBe(2)
  })
})
