import { describe, expect, it } from 'vitest'
import {
  keptSprints,
  pointsField,
  sprintFieldId,
  sprintIdsOf,
  sprintItems,
} from './sprints'

const FIELDS = [
  { id: 'summary', name: 'Summary', schema: { type: 'string' } },
  {
    id: 'customfield_10020',
    name: 'Sprint',
    schema: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' },
  },
  {
    id: 'customfield_10016',
    name: 'Story point estimate',
    schema: { type: 'number' },
  },
  { id: 'customfield_10028', name: 'Story Points', schema: { type: 'number' } },
]

describe('Jira sprint reading', () => {
  it('finds the Sprint field by its type, not its name', () => {
    expect(sprintFieldId(FIELDS)).toBe('customfield_10020')
    expect(sprintFieldId([{ id: 'customfield_1', name: 'Sprint' }])).toBe(
      'customfield_1',
    )
    expect(sprintFieldId([{ id: 'summary', name: 'Summary' }])).toBeUndefined()
  })

  it('uses the board’s estimate field, and counts items for hours or item count', () => {
    expect(
      pointsField(
        {
          type: 'field',
          field: { fieldId: 'customfield_10028', displayName: 'Story Points' },
        },
        FIELDS,
      ),
    ).toEqual({ id: 'customfield_10028', name: 'Story Points' })
    expect(
      pointsField(
        { type: 'field', field: { fieldId: 'timeoriginalestimate' } },
        FIELDS,
      ),
    ).toBeUndefined()
    expect(pointsField({ type: 'issueCount' }, FIELDS)).toBeUndefined()
    // A team-managed board that does not report its estimate.
    expect(pointsField(undefined, FIELDS)).toEqual({
      id: 'customfield_10016',
      name: 'Story point estimate',
    })
  })

  it('keeps the last six closed sprints in order, the running one and the next two', () => {
    const closed = Array.from({ length: 9 }, (_, index) => ({
      id: index + 1,
      name: `Sprint ${index + 1}`,
      state: 'closed',
      startDate: `2026-0${(index % 9) + 1}-01T09:00:00.000Z`,
      completeDate: `2026-0${(index % 9) + 1}-12T17:00:00.000Z`,
    }))
    const kept = keptSprints([
      ...closed,
      { id: 10, name: 'Sprint 10', state: 'active', goal: ' Ship it ' },
      { id: 11, name: 'Sprint 11', state: 'future' },
      { id: 12, name: 'Sprint 12', state: 'future' },
      { id: 13, name: 'Sprint 13', state: 'future' },
      { id: 14, name: 'Broken', state: 'unknown' },
    ])
    expect(kept.map((sprint) => sprint.name)).toEqual([
      'Sprint 4',
      'Sprint 5',
      'Sprint 6',
      'Sprint 7',
      'Sprint 8',
      'Sprint 9',
      'Sprint 10',
      'Sprint 11',
      'Sprint 12',
    ])
    expect(kept[6]).toMatchObject({ state: 'active', goal: 'Ship it' })
  })

  it('reads sprint ids from Cloud objects and older Data Center text', () => {
    expect(sprintIdsOf([{ id: 12, name: 'A' }, { id: '13' }])).toEqual([
      '12',
      '13',
    ])
    expect(
      sprintIdsOf([
        'com.atlassian.greenhopper.service.sprint.Sprint@1a[id=7,rapidViewId=2,state=CLOSED,name=Sprint 7]',
      ]),
    ).toEqual(['7'])
    expect(sprintIdsOf(null)).toEqual([])
  })

  it('reads each item’s sprint and estimate changes, skipping items never in a sprint', () => {
    const items = sprintItems(
      [
        {
          id: '1',
          fields: {
            customfield_10020: [{ id: 12 }, { id: 13 }],
            customfield_10028: 5,
          },
          changelog: {
            histories: [
              {
                created: '2026-11-02T09:00:00.000+0000',
                items: [
                  {
                    field: 'Sprint',
                    fieldId: 'customfield_10020',
                    from: '',
                    to: '12',
                  },
                  {
                    field: 'Story Points',
                    fieldId: 'customfield_10028',
                    fromString: '3',
                    toString: '5',
                  },
                ],
              },
              {
                // Cloud's bulk history sends epoch milliseconds.
                created: Date.parse('2026-11-13T17:00:00.000Z'),
                items: [{ field: 'Sprint', from: '12', to: '12, 13' }],
              },
            ],
          },
        },
        {
          // Raw values only: the inherited toString must not be read as Jira's.
          id: '3',
          fields: { customfield_10020: [{ id: 12 }] },
          changelog: {
            histories: [
              {
                created: '2026-11-03T09:00:00.000Z',
                items: [{ fieldId: 'customfield_10028', from: '2', to: '8' }],
              },
            ],
          },
        },
        { id: '2', fields: {}, changelog: { histories: [] } },
      ],
      'customfield_10020',
      { id: 'customfield_10028', name: 'Story Points' },
    )
    expect(items).toEqual([
      {
        issueId: '1',
        sprintIds: ['12', '13'],
        points: 5,
        sprintChanges: [
          { at: '2026-11-02T09:00:00.000Z', from: [], to: ['12'] },
          { at: '2026-11-13T17:00:00.000Z', from: ['12'], to: ['12', '13'] },
        ],
        pointChanges: [{ at: '2026-11-02T09:00:00.000Z', from: 3, to: 5 }],
      },
      {
        issueId: '3',
        sprintIds: ['12'],
        sprintChanges: [],
        pointChanges: [{ at: '2026-11-03T09:00:00.000Z', from: 2, to: 8 }],
      },
    ])
  })
})
