import { describe, expect, it } from 'vitest'
import {
  normaliseIssues,
  normaliseJiraInvestigation,
  normaliseJiraOverview,
} from './jira-client'

describe('Jira history normalisation', () => {
  it('keeps only status changes and preserves re-entry events', () => {
    const result = normaliseIssues([
      {
        id: '10001',
        key: 'DEMO-1',
        fields: {
          created: '2026-01-01T09:00:00Z',
          issuetype: { id: '1', name: 'Story' },
          status: { id: '3', name: 'Review' },
        },
        changelog: {
          total: 3,
          histories: [
            {
              created: '2026-01-02T09:00:00Z',
              items: [
                {
                  field: 'status',
                  from: '1',
                  fromString: 'To Do',
                  to: '2',
                  toString: 'In Progress',
                },
              ],
            },
            {
              created: '2026-01-03T09:00:00Z',
              items: [
                {
                  field: 'assignee',
                  from: 'person-a',
                  fromString: null,
                  to: 'person-b',
                  toString: null,
                },
              ],
            },
            {
              created: '2026-01-04T09:00:00Z',
              items: [
                {
                  field: 'status',
                  from: '2',
                  fromString: 'In Progress',
                  to: '3',
                  toString: 'Review',
                },
              ],
            },
          ],
        },
      },
    ])

    expect(result.issues).toHaveLength(1)
    expect(result.changes.map((change) => change.toStatus.name)).toEqual([
      'In Progress',
      'Review',
    ])
  })

  it('normalizes Jira issue types and offset timestamps at the boundary', () => {
    const result = normaliseIssues([
      {
        id: '10002',
        key: 'DEMO-2',
        fields: {
          created: '2026-07-01T09:00:00.000+0200',
          issuetype: { id: '2', name: ' User Story ' },
          status: { id: '2', name: 'Done' },
        },
        changelog: {
          total: 1,
          histories: [
            {
              created: '2026-07-03T11:30:00.000+0200',
              items: [
                {
                  field: 'status',
                  from: '1',
                  fromString: 'In Progress',
                  to: '2',
                  toString: 'Done',
                },
              ],
            },
          ],
        },
      },
    ])

    expect(result.issues[0]?.issueTypeName).toBe('User Story')
    expect(result.issues[0]?.createdAt).toBe('2026-07-01T07:00:00.000Z')
    expect(result.changes[0]?.changedAt).toBe('2026-07-03T09:30:00.000Z')
  })

  it('keeps the resolution and marks sub-tasks and epics', () => {
    const base = { created: '2026-09-01T00:00:00Z', status: { id: '3' } }
    const { issues } = normaliseIssues([
      {
        id: '1',
        key: 'DEMO-1',
        fields: {
          ...base,
          issuetype: { id: '10', name: 'Story' },
          resolution: { name: "Won't Do" },
        },
      },
      {
        id: '2',
        key: 'DEMO-2',
        fields: {
          ...base,
          issuetype: { id: '11', name: 'Sub-task', subtask: true },
        },
      },
      {
        id: '3',
        key: 'DEMO-3',
        fields: {
          ...base,
          issuetype: { id: '12', name: 'Feature', hierarchyLevel: 1 },
        },
      },
    ])
    expect(
      issues.map(({ key, resolution, hierarchy }) => ({
        key,
        resolution,
        hierarchy,
      })),
    ).toEqual([
      { key: 'DEMO-1', resolution: "Won't Do", hierarchy: undefined },
      { key: 'DEMO-2', resolution: undefined, hierarchy: 'subtask' },
      { key: 'DEMO-3', resolution: undefined, hierarchy: 'epic' },
    ])
  })

  it('keeps one normalized record when Jira returns an issue twice', () => {
    const rawIssue = {
      id: '10003',
      key: 'DEMO-3',
      fields: {
        created: '2026-07-01T09:00:00Z',
        issuetype: { id: '1', name: 'Story' },
        status: { id: '2', name: 'Done' },
      },
      changelog: {
        total: 1,
        histories: [
          {
            created: '2026-07-03T09:00:00Z',
            items: [
              {
                field: 'status',
                from: '1',
                fromString: 'In Progress',
                to: '2',
                toString: 'Done',
              },
            ],
          },
        ],
      },
    }

    const result = normaliseIssues([rawIssue, { ...rawIssue }])

    expect(result.issues).toHaveLength(1)
    expect(result.changes).toHaveLength(1)
  })

  it('keeps history scoped to the selected project on a shared board', () => {
    const issue = (id: string, key: string) => ({
      id,
      key,
      fields: {
        created: '2026-07-01T09:00:00Z',
        issuetype: { id: '1', name: 'Story' },
        status: { id: '2', name: 'Done' },
      },
      changelog: {
        total: 1,
        histories: [
          {
            created: '2026-07-03T09:00:00Z',
            items: [
              {
                field: 'status',
                from: '1',
                fromString: 'In Progress',
                to: '2',
                toString: 'Done',
              },
            ],
          },
        ],
      },
    })

    const result = normaliseIssues(
      [issue('10004', 'OPS-1'), issue('10005', 'WEB-1')],
      new Map(),
      'WEB',
    )

    expect(result.issues.map((candidate) => candidate.key)).toEqual(['WEB-1'])
    expect(result.changes.map((change) => change.issueId)).toEqual(['10005'])
  })
})

describe('Jira AI investigation normalisation', () => {
  it('keeps only lightweight fields for a report-group overview', () => {
    const evidence = normaliseJiraOverview(
      [
        {
          key: 'DEMO-12',
          fields: {
            summary: 'Fictional review queue item',
            description: 'This must not be included in an overview.',
            issuetype: { name: 'Story' },
            status: {
              name: 'Review',
              statusCategory: { name: 'In Progress' },
            },
            priority: { name: 'Medium' },
            assignee: { displayName: 'Example Owner' },
            components: [{ name: 'Fictional portal' }],
            updated: '2026-09-10T10:00:00Z',
            duedate: '2026-09-20',
            comment: {
              comments: [
                {
                  author: { displayName: 'Example Reviewer' },
                  created: '2026-09-09T10:00:00Z',
                  body: 'This must not be included in an overview.',
                },
              ],
            },
          },
        },
      ],
      ['DEMO-12', 'DEMO-404'],
      'completed outliers above P85',
    )

    expect(evidence).toMatchObject({
      mode: 'overview',
      source: 'completed outliers above P85',
      requestedKeys: ['DEMO-12', 'DEMO-404'],
      unavailableKeys: ['DEMO-404'],
      omittedCount: 0,
      issues: [
        {
          key: 'DEMO-12',
          summary: 'Fictional review queue item',
          assignee: 'Example Owner',
          status: 'Review',
          updatedAt: '2026-09-10T10:00:00.000Z',
        },
      ],
    })
    expect(JSON.stringify(evidence)).not.toContain('description')
    expect(JSON.stringify(evidence)).not.toContain('comments')
  })

  it('keeps the approved ticket evidence and selected history only', () => {
    const evidence = normaliseJiraInvestigation(
      [
        {
          key: 'DEMO-7',
          fields: {
            summary: 'Fictional payment retry',
            description: 'Retries occasionally remain queued.',
            issuetype: { name: 'Bug' },
            status: {
              name: 'Review',
              statusCategory: { name: 'In Progress' },
            },
            priority: { name: 'High' },
            assignee: { displayName: 'Example Owner' },
            components: [{ name: 'Fictional checkout' }],
            labels: ['dependency-review'],
            fixVersions: [{ name: 'Demo 2.0' }],
            created: '2026-08-01T09:00:00Z',
            updated: '2026-08-09T12:00:00Z',
            duedate: '2026-08-15',
            parent: {
              key: 'DEMO-1',
              fields: {
                summary: 'Fictional checkout epic',
                status: { name: 'In Progress' },
                issuetype: { name: 'Epic' },
              },
            },
            issuelinks: [
              {
                type: { inward: 'is blocked by' },
                inwardIssue: {
                  key: 'DEMO-8',
                  fields: {
                    summary: 'Fictional gateway change',
                    status: { name: 'To Do' },
                    issuetype: { name: 'Story' },
                  },
                },
              },
            ],
            comment: {
              comments: [
                {
                  author: { displayName: 'Example Reviewer' },
                  created: '2026-08-08T10:00:00Z',
                  body: 'Waiting for the fictional gateway contract.',
                },
              ],
            },
          },
          changelog: {
            histories: [
              {
                created: '2026-08-07T09:00:00Z',
                author: { displayName: 'Example Owner' },
                items: [
                  {
                    field: 'status',
                    fromString: 'In Progress',
                    toString: 'Review',
                  },
                  {
                    field: 'description',
                    fromString: 'Old description',
                    toString: 'New description',
                  },
                ],
              },
            ],
          },
        },
      ],
      ['DEMO-7', 'DEMO-404'],
    )

    expect(evidence.unavailableKeys).toEqual(['DEMO-404'])
    expect(evidence.issues[0]).toMatchObject({
      key: 'DEMO-7',
      summary: 'Fictional payment retry',
      assignee: 'Example Owner',
      parent: { key: 'DEMO-1' },
      links: [
        {
          direction: 'inward',
          relationship: 'is blocked by',
          key: 'DEMO-8',
          summary: 'Fictional gateway change',
          issueType: 'Story',
          status: 'To Do',
        },
      ],
      comments: [
        {
          author: 'Example Reviewer',
          body: 'Waiting for the fictional gateway contract.',
        },
      ],
      history: [
        {
          changedBy: 'Example Owner',
          field: 'Status',
          fromValue: 'In Progress',
          toValue: 'Review',
        },
      ],
    })
    expect(JSON.stringify(evidence)).not.toContain('Old description')
  })

  it('reads who holds each item, and nobody only when Jira says so', () => {
    const base = {
      created: '2026-09-01T00:00:00Z',
      status: { id: '3' },
      issuetype: { id: '10', name: 'Story' },
    }
    const { issues } = normaliseIssues([
      {
        id: '1',
        key: 'DEMO-1',
        fields: { ...base, assignee: { displayName: 'Dana Fictional' } },
      },
      { id: '2', key: 'DEMO-2', fields: { ...base, assignee: null } },
      { id: '3', key: 'DEMO-3', fields: base },
    ])
    expect(
      issues.map(({ assignee, ownerKnown }) => ({ assignee, ownerKnown })),
    ).toEqual([
      { assignee: 'Dana Fictional', ownerKnown: true },
      { assignee: undefined, ownerKnown: true },
      { assignee: undefined, ownerKnown: undefined },
    ])
  })
})
