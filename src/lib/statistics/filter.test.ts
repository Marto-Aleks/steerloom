import { describe, expect, it } from 'vitest'
import type { AnalysisFilters, DataRow } from '../../types'
import {
  analysisScopeLabel,
  availableStatusValues,
  availableTicketTypes,
} from './filter'

const rows: DataRow[] = [
  { id: 'A-1', type: 'Story', created: '2026-07-20' },
  { id: 'A-2', type: 'Bug', created: '2026-07-01' },
  { id: 'A-3', type: 'Bug', created: '2026-06-20' },
  { id: 'A-4', type: 'Task', created: '2026-07-23' },
]

describe('analysis filters', () => {
  it('derives unique sorted ticket types from the mapped column', () => {
    expect(availableTicketTypes(rows, 'type')).toEqual(['Bug', 'Story', 'Task'])
  })

  it('describes a fixed window as an exit period', () => {
    const filters: AnalysisFilters = {
      ticketTypes: ['Bug'],
      windowDays: 30,
      selectedColumnIds: ['ip-col', 'review-col'],
    }
    expect(analysisScopeLabel(filters)).toBe('Exited in the last 30 days · Bug')
  })

  it('describes an all-time scope without issue-type filters', () => {
    const filters: AnalysisFilters = {
      ticketTypes: [],
      windowDays: null,
      selectedColumnIds: ['ip-col', 'review-col'],
    }
    expect(analysisScopeLabel(filters)).toBe(
      'All time · All item types except sub-tasks and epics',
    )
  })

  it('keeps status order from the source data', () => {
    const transitionRows: DataRow[] = [
      { status: 'Backlog' },
      { status: 'In Progress' },
      { status: 'Code Review' },
      { status: 'Done' },
      { status: 'In Progress' },
    ]
    const statuses = availableStatusValues(transitionRows, 'status')

    expect(statuses).toEqual(['Backlog', 'In Progress', 'Code Review', 'Done'])
  })
})
