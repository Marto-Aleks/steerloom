import { describe, expect, it } from 'vitest'
import type { AiJiraEvidenceBundle } from '../../src/lib/ai/jira-evidence'
import { jiraLookupFingerprint, mergeAiJiraEvidence } from './agent-loop'

describe('AI Jira agent loop', () => {
  it('recognizes repeated lookups regardless of key order', () => {
    expect(
      jiraLookupFingerprint({
        mode: 'overview',
        source: 'named tickets',
        keys: ['DEMO-2', 'DEMO-1'],
        availableCount: 2,
        omittedCount: 0,
      }),
    ).toBe('overview:DEMO-1,DEMO-2')
  })

  it('merges bounded evidence and lets detailed fields upgrade an overview', () => {
    const overview: AiJiraEvidenceBundle = {
      mode: 'overview',
      source: 'delayed work in progress',
      requestedKeys: ['DEMO-1', 'DEMO-2'],
      issues: [issue('DEMO-1'), issue('DEMO-2')],
      unavailableKeys: [],
      omittedCount: 2,
    }
    const detail: AiJiraEvidenceBundle = {
      mode: 'detail',
      source: 'delayed work in progress',
      requestedKeys: ['DEMO-1'],
      issues: [{ ...issue('DEMO-1'), description: 'Fictional detail' }],
      unavailableKeys: [],
      omittedCount: 2,
    }

    expect(mergeAiJiraEvidence([overview, detail])).toMatchObject({
      mode: 'detail',
      source: 'delayed work in progress',
      requestedKeys: ['DEMO-1', 'DEMO-2'],
      omittedCount: 2,
      issues: [
        { key: 'DEMO-1', description: 'Fictional detail' },
        { key: 'DEMO-2' },
      ],
    })
  })
})

function issue(key: string) {
  return {
    key,
    summary: `Fictional ${key}`,
    issueType: 'Story',
    status: 'In Progress',
    statusCategory: 'indeterminate',
    priority: 'Medium',
    assignee: null,
    components: [],
  }
}
