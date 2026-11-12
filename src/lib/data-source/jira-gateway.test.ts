import { describe, expect, it } from 'vitest'
import { JiraBoardDataSource, type JiraBoardGateway } from './jira-gateway'

describe('Jira board data source contract', () => {
  it('normalises board configuration, issues, and changelog entries', async () => {
    const issue = {
      id: '10001',
      key: 'ABC-1',
      issueTypeId: '10000',
      issueTypeName: 'Story',
      createdAt: '2026-07-01T09:00:00Z',
      browseUrl: 'https://jira.example.invalid/tracker/browse/ABC-1',
      title: 'Fictional checkout story',
      currentStatus: { id: '5', name: 'Done' },
    }
    let requestedIssueIds: string[] = []
    const gateway: JiraBoardGateway = {
      getBoard: async () => ({
        id: '42',
        name: 'Delivery',
        columns: [
          {
            id: 'column-progress',
            name: 'In Progress',
            statuses: [{ id: '3', name: 'Development' }],
          },
          {
            id: 'column-done',
            name: 'Done',
            statuses: [{ id: '5', name: 'Done' }],
          },
        ],
      }),
      getBoardIssues: async () => [issue, { ...issue }],
      getStatusChanges: async (issueIds) => {
        requestedIssueIds = issueIds
        return [
          {
            issueId: '10001',
            changedAt: '2026-07-03T09:00:00Z',
            fromStatus: { id: '1', name: 'To Do' },
            toStatus: { id: '3', name: 'Development' },
          },
          {
            issueId: '10001',
            changedAt: '2026-07-05T09:00:00Z',
            fromStatus: { id: '3', name: 'Development' },
            toStatus: { id: '5', name: 'Done' },
          },
        ]
      },
    }

    const snapshot = await new JiraBoardDataSource(gateway).loadBoard('42')

    expect(snapshot.source.kind).toBe('jira-data-center')
    expect(snapshot.board.columns[0]?.statusIds).toEqual(['3'])
    expect(requestedIssueIds).toEqual(['10001'])
    expect(snapshot.issues).toHaveLength(1)
    expect(snapshot.issues[0]?.browseUrl).toBe(
      'https://jira.example.invalid/tracker/browse/ABC-1',
    )
    expect(snapshot.issues[0]?.title).toBe('Fictional checkout story')
    expect(snapshot.transitions).toEqual([
      {
        issueId: '10001',
        statusId: '1',
        enteredAt: '2026-07-01T09:00:00Z',
      },
      {
        issueId: '10001',
        statusId: '3',
        enteredAt: '2026-07-03T09:00:00Z',
      },
      {
        issueId: '10001',
        statusId: '5',
        enteredAt: '2026-07-05T09:00:00Z',
      },
    ])
  })
})
