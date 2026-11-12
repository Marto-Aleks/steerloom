import { describe, expect, it } from 'vitest'
import type { DataRow, FlowColumnMapping } from '../../types'
import {
  assessTransitionHistory,
  dateLikeColumns,
  transitionTimestampColumns,
} from './transitions'

const mapping: FlowColumnMapping = {
  itemId: 'id',
  itemType: 'type',
  createdDate: 'created',
  status: 'status',
  transitionDate: 'changed',
}

describe('transition history capability detection', () => {
  it('rejects a flat issue export with only current status', () => {
    const rows: DataRow[] = [
      { id: 'A-1', status: 'Done', updated: '2026-07-20' },
      { id: 'A-2', status: 'Done', updated: '2026-07-21' },
    ]

    expect(assessTransitionHistory(rows, mapping)).toEqual({
      detected: false,
      uniqueItemCount: 2,
      distinctStatusCount: 1,
      itemsWithMultipleStatuses: 0,
    })
  })

  it('detects repeated tickets moving through multiple statuses', () => {
    const rows: DataRow[] = [
      {
        id: 'A-1',
        status: 'In Progress',
        created: '2026-07-01',
        changed: '2026-07-03',
      },
      {
        id: 'A-1',
        status: 'Code Review',
        created: '2026-07-01',
        changed: '2026-07-08',
      },
    ]

    expect(assessTransitionHistory(rows, mapping).detected).toBe(true)
    expect(dateLikeColumns(rows, Object.keys(rows[0] ?? {}))).toEqual([
      'created',
      'changed',
    ])
    expect(
      transitionTimestampColumns(rows, mapping, Object.keys(rows[0] ?? {})),
    ).toEqual(['changed'])
  })
})
