import { describe, expect, it } from 'vitest'
import {
  calculateBoardMetrics,
  findDelayedWorkInProgress,
  summarizeBoardSelection,
} from '../statistics'
import { normalizeTrelloBoard, type TrelloBoardHistory } from './trello'
import { demoSnapshot } from '../workspace/demo'
import { assessDataQuality } from '../statistics/data-quality'
import { buildFlowPeriodComparison } from '../statistics/flow-evidence'

function payload(): TrelloBoardHistory {
  return {
    board: { id: 'sample', name: 'Fictional delivery' },
    lists: [
      { id: 'todo', name: 'Backlog' },
      { id: 'active', name: 'In progress' },
      { id: 'done', name: 'Done' },
    ],
    cards: [
      {
        id: 'card1',
        idShort: 1,
        idList: 'done',
        closed: false,
        name: '  Fictional checkout card  ',
      },
    ],
    actions: [
      {
        id: 'a3',
        type: 'updateCard',
        date: '2026-07-05T12:00:00Z',
        data: {
          card: { id: 'card1' },
          old: { idList: 'active' },
          listAfter: { id: 'done' },
        },
      },
      {
        id: 'a1',
        type: 'createCard',
        date: '2026-07-01T12:00:00Z',
        data: { card: { id: 'card1' }, list: { id: 'todo' } },
      },
      {
        id: 'a2',
        type: 'updateCard',
        date: '2026-07-02T12:00:00Z',
        data: {
          card: { id: 'card1' },
          old: { idList: 'todo' },
          listAfter: { id: 'active' },
        },
      },
    ],
  }
}
describe('Trello normalized board history', () => {
  it('does not infer historical WIP from the current archive flag', () => {
    const snapshot = normalizeTrelloBoard(payload(), '2026-07-10T12:00:00Z')
    expect(
      buildFlowPeriodComparison(snapshot, {
        selectedColumnIds: ['active'],
        windowDays: 30,
        ticketTypes: [],
      }),
    ).toBeNull()
  })
  it('uses observed list movements and the same metric engine as Jira', () => {
    const snapshot = normalizeTrelloBoard(payload(), '2026-07-10T12:00:00Z')
    const metrics = calculateBoardMetrics(snapshot, ['active'])
    expect(metrics?.medianCycleTime).toBe(3)
    expect(metrics?.workItemCount).toBe(1)
    expect(snapshot.issues[0]?.title).toBe('Fictional checkout card')
    expect(snapshot.transitions.map((event) => event.statusId)).toEqual([
      'todo',
      'active',
      'done',
    ])
    expect(
      calculateBoardMetrics(
        {
          ...snapshot,
          source: { kind: 'jira-data-center', label: 'Equivalent sample' },
        },
        ['active'],
      ),
    ).toEqual(metrics)
  })
  it('excludes incomplete or discontinuous histories instead of inventing entry dates', () => {
    const input = payload()
    input.actions = input.actions.filter(
      (action) => action.type !== 'createCard',
    )
    expect(
      normalizeTrelloBoard(input, '2026-07-10T12:00:00Z').issues,
    ).toHaveLength(0)
    expect(
      normalizeTrelloBoard(input, '2026-07-10T12:00:00Z').historyWarnings?.[0],
    ).toContain('1 cards')
    const mismatched = payload()
    mismatched.cards[0]!.idList = 'active'
    expect(
      normalizeTrelloBoard(mismatched, '2026-07-10T12:00:00Z').issues,
    ).toHaveLength(0)
  })
  it('accumulates repeated visits and excludes reopened work from completed observations', () => {
    const input = payload()
    input.cards[0]!.idList = 'active'
    input.actions.push({
      id: 'a4',
      type: 'updateCard',
      date: '2026-07-06T12:00:00Z',
      data: {
        card: { id: 'card1' },
        old: { idList: 'done' },
        listAfter: { id: 'active' },
      },
    })
    const reopened = normalizeTrelloBoard(input, '2026-07-10T12:00:00Z')
    expect(calculateBoardMetrics(reopened, ['active'])).toBeNull()
    expect(
      findDelayedWorkInProgress(reopened, ['active'], 0)[0]
        ?.ageInSelectedColumns,
    ).toBe(7)
    input.cards[0]!.idList = 'done'
    input.actions.push({
      id: 'a5',
      type: 'updateCard',
      date: '2026-07-08T12:00:00Z',
      data: {
        card: { id: 'card1' },
        old: { idList: 'active' },
        listAfter: { id: 'done' },
      },
    })
    expect(
      calculateBoardMetrics(
        normalizeTrelloBoard(input, '2026-07-10T12:00:00Z'),
        ['active'],
      )?.medianCycleTime,
    ).toBe(5)
  })
  it('keeps archived completions but does not count archived cards as active WIP', () => {
    const input = payload()
    input.cards[0]!.closed = true
    expect(
      calculateBoardMetrics(
        normalizeTrelloBoard(input, '2026-07-10T12:00:00Z'),
        ['active'],
      )?.workItemCount,
    ).toBe(1)
    input.actions = input.actions.filter((action) => action.id !== 'a3')
    input.cards[0]!.idList = 'active'
    const snapshot = normalizeTrelloBoard(input, '2026-07-10T12:00:00Z')
    expect(findDelayedWorkInProgress(snapshot, ['active'], 0)).toEqual([])
    expect(
      summarizeBoardSelection(snapshot, ['active']).workInProgressItemCount,
    ).toBe(0)
  })
  it('generates a consistent fictional demo with no future events', () => {
    const now = new Date('2026-10-13T12:00:00Z')
    const snapshot = demoSnapshot('demo-product', now)
    expect(
      snapshot.transitions.every(
        (event) => Date.parse(event.enteredAt) <= now.getTime(),
      ),
    ).toBe(true)
    expect(
      assessDataQuality(
        snapshot,
        {
          selectedColumnIds: ['stage-1', 'stage-2'],
          windowDays: 30,
          ticketTypes: [],
        },
        now,
      ).status,
    ).toBe('ready')
  })

  it('takes the first card member as owner, and only when members were read', () => {
    const base = payload()
    const card = base.cards[0]!
    const withMembers = normalizeTrelloBoard(
      {
        ...base,
        cards: [{ ...card, idMembers: ['m2', 'm1'] }],
        members: [
          { id: 'm1', name: 'Priya Fictional' },
          { id: 'm2', name: 'Dana Fictional' },
        ],
      },
      '2026-07-10T12:00:00Z',
    )
    expect(withMembers.issues[0]).toMatchObject({
      assignee: 'Dana Fictional',
      ownerKnown: true,
    })
    const nobody = normalizeTrelloBoard(
      { ...base, cards: [{ ...card, idMembers: [] }], members: [] },
      '2026-07-10T12:00:00Z',
    )
    expect(nobody.issues[0]?.assignee).toBeUndefined()
    expect(nobody.issues[0]?.ownerKnown).toBe(true)
    expect(
      normalizeTrelloBoard(base, '2026-07-10T12:00:00Z').issues[0]?.ownerKnown,
    ).toBeUndefined()
  })
})
