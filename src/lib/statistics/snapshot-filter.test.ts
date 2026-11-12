import { describe, expect, it } from 'vitest'
import type { FlowBoardSnapshot } from '../../types'
import { calculateBoardMetrics } from '.'
import { filterBoardSnapshot } from './snapshot-filter'

const snapshot: FlowBoardSnapshot = {
  source: { kind: 'jira-data-center', label: 'Fictional board' },
  board: {
    id: '1',
    name: 'Fictional board',
    columns: [
      {
        id: 'progress-column',
        name: 'In Progress',
        statusIds: ['progress'],
      },
      { id: 'done-column', name: 'Done', statusIds: ['done'] },
    ],
    statuses: [
      { id: 'progress', name: 'In Progress' },
      { id: 'done', name: 'Done' },
    ],
  },
  issues: [
    {
      id: '1',
      key: 'DEMO-1',
      issueTypeId: 'story',
      issueTypeName: 'Story',
      createdAt: '2026-07-20T10:00:00Z',
    },
    {
      id: '2',
      key: 'DEMO-2',
      issueTypeId: 'story',
      issueTypeName: 'Story',
      createdAt: '',
    },
    {
      id: '3',
      key: 'DEMO-3',
      issueTypeId: 'story',
      issueTypeName: 'Story',
      createdAt: '2026-07-10T10:00:00Z',
    },
  ],
  transitions: [
    {
      issueId: '1',
      statusId: 'progress',
      enteredAt: '2026-05-28T10:00:00Z',
    },
    { issueId: '1', statusId: 'done', enteredAt: '2026-06-01T10:00:00Z' },
    {
      issueId: '2',
      statusId: 'progress',
      enteredAt: '2026-07-15T10:00:00Z',
    },
    { issueId: '2', statusId: 'done', enteredAt: '2026-07-20T10:00:00Z' },
    {
      issueId: '3',
      statusId: 'progress',
      enteredAt: '2026-07-18T10:00:00Z',
    },
  ],
  loadedAt: '2026-07-24T10:00:00Z',
}

describe('normalized snapshot filtering', () => {
  it('filters by latest completed exit rather than issue creation', () => {
    const filtered = filterBoardSnapshot(
      snapshot,
      {
        ticketTypes: ['Story'],
        windowDays: 30,
        selectedColumnIds: ['progress-column'],
      },
      new Date('2026-07-24T12:00:00Z'),
    )

    expect(filtered.issues.map((issue) => issue.key)).toEqual(['DEMO-2'])
    expect(filtered.transitions.map((event) => event.issueId)).toEqual([
      '2',
      '2',
    ])
  })

  it('matches normalized issue types with realistic Jira timestamps', () => {
    const completedSnapshot: FlowBoardSnapshot = {
      source: { kind: 'jira-data-center', label: 'Fictional board' },
      board: {
        id: '2',
        name: 'Fictional board',
        statuses: [
          { id: 'progress', name: 'In Progress' },
          { id: 'done', name: 'Done' },
        ],
        columns: [
          {
            id: 'progress-column',
            name: 'In Progress',
            statusIds: ['progress'],
          },
          { id: 'done-column', name: 'Done', statusIds: ['done'] },
        ],
      },
      issues: [
        {
          id: '3',
          key: 'DEMO-3',
          issueTypeId: 'user-story',
          issueTypeName: ' User Story ',
          createdAt: '2026-07-01T09:00:00.000+0200',
        },
      ],
      transitions: [
        {
          issueId: '3',
          statusId: 'progress',
          enteredAt: '2026-07-02T09:00:00.000+0200',
        },
        {
          issueId: '3',
          statusId: 'done',
          enteredAt: '2026-07-05T09:00:00.000+0200',
        },
      ],
      loadedAt: '2026-07-24T10:00:00Z',
    }

    const filtered = filterBoardSnapshot(
      completedSnapshot,
      {
        ticketTypes: ['User Story'],
        windowDays: 60,
        selectedColumnIds: ['progress-column'],
      },
      new Date('2026-07-24T12:00:00Z'),
    )
    const metrics = calculateBoardMetrics(filtered, ['progress-column'])

    expect(filtered.issues.map((issue) => issue.key)).toEqual(['DEMO-3'])
    expect(filtered.transitions).toHaveLength(2)
    expect(metrics?.workItemCount).toBe(1)
    expect(metrics?.cycleTimes[0]?.cycleEnd).toBe(
      '2026-07-05T09:00:00.000+0200',
    )
  })
})
