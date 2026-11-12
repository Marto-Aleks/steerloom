import { describe, expect, it } from 'vitest'
import type { FlowBoardSnapshot, FlowMetrics } from '../../types'
import {
  buildFocusNowSummary,
  focusSignalAgentPrompt,
  focusSignalActionLabel,
  selectTodaySignals,
} from './focus-now'

const snapshot: FlowBoardSnapshot = {
  source: { kind: 'jira-data-center', label: 'Fictional delivery board' },
  board: {
    id: 'board-1',
    name: 'Fictional delivery board',
    statuses: [
      { id: 'progress', name: 'In Progress' },
      { id: 'review', name: 'Code Review' },
      { id: 'done', name: 'Done' },
    ],
    columns: [
      { id: 'progress-column', name: 'In Progress', statusIds: ['progress'] },
      { id: 'review-column', name: 'Code Review', statusIds: ['review'] },
      { id: 'done-column', name: 'Done', statusIds: ['done'] },
    ],
  },
  issues: ['A', 'B', 'C', 'D', 'E', 'F'].map((suffix, index) => ({
    id: `issue-${suffix}`,
    key: `DEMO-${index + 1}`,
    issueTypeId: 'story',
    issueTypeName: 'Story',
    createdAt: '2026-08-01T09:00:00Z',
    browseUrl: `https://jira.example.invalid/jira/browse/DEMO-${index + 1}`,
  })),
  transitions: [
    {
      issueId: 'issue-A',
      statusId: 'review',
      enteredAt: '2026-08-20T09:00:00Z',
    },
    {
      issueId: 'issue-B',
      statusId: 'review',
      enteredAt: '2026-09-01T09:00:00Z',
    },
    {
      issueId: 'issue-C',
      statusId: 'progress',
      enteredAt: '2026-08-01T09:00:00Z',
    },
    {
      issueId: 'issue-C',
      statusId: 'done',
      enteredAt: '2026-08-05T09:00:00Z',
    },
    {
      issueId: 'issue-C',
      statusId: 'review',
      enteredAt: '2026-08-25T09:00:00Z',
    },
    {
      issueId: 'issue-D',
      statusId: 'review',
      enteredAt: '2026-09-02T09:00:00Z',
    },
    {
      issueId: 'issue-E',
      statusId: 'progress',
      enteredAt: '2026-09-04T09:00:00Z',
    },
    // F finished: 1 day in progress, 8 in review, so review takes 89% of time.
    {
      issueId: 'issue-F',
      statusId: 'progress',
      enteredAt: '2026-08-01T09:00:00Z',
    },
    {
      issueId: 'issue-F',
      statusId: 'review',
      enteredAt: '2026-08-02T09:00:00Z',
    },
    {
      issueId: 'issue-F',
      statusId: 'done',
      enteredAt: '2026-08-10T09:00:00Z',
    },
  ],
  loadedAt: '2026-09-09T09:00:00Z',
}

const metrics: FlowMetrics = {
  uniqueItemCount: 10,
  validTransitionCount: 20,
  workItemCount: 5,
  cycleTimeItemCount: 5,
  medianCycleTime: 6,
  percentile85CycleTime: 10,
  weeklyThroughput: [],
  cycleTimes: [
    cyclePoint('DEMO-1', '2026-08-12T09:00:00Z'),
    cyclePoint('DEMO-2', '2026-08-13T09:00:00Z'),
    cyclePoint('DEMO-3', '2026-08-19T09:00:00Z'),
    cyclePoint('DEMO-4', '2026-08-20T09:00:00Z'),
    cyclePoint('DEMO-5', '2026-08-26T09:00:00Z'),
  ],
  distribution: [],
  explanation: 'Fictional flow summary.',
}

describe('Focus now summary', () => {
  it('does not call a board healthy or classify delayed work without a completed baseline', () => {
    const summary = buildFocusNowSummary({
      snapshot,
      selectedColumnIds: ['progress-column', 'review-column'],
      metrics: {
        ...metrics,
        workItemCount: 0,
        cycleTimes: [],
        medianCycleTime: null,
        percentile85CycleTime: null,
      },
      windowDays: 30,
    })
    expect(
      summary.signals.some((signal) => signal.id === 'insufficient-history'),
    ).toBe(true)
    expect(
      summary.signals.some(
        (signal) => signal.id === 'healthy' || signal.id === 'delayed-wip',
      ),
    ).toBe(false)
    expect(summary.delayedWorkInProgress).toEqual([])
    expect(summary.reenteredWorkInProgress).toHaveLength(1)
  })
  it('prioritizes delayed WIP, starting over finishing, concentration, re-entry, and throughput decline', () => {
    const summary = buildFocusNowSummary({
      snapshot,
      selectedColumnIds: ['progress-column', 'review-column'],
      metrics,
      windowDays: 60,
    })

    expect(summary.signals.map(({ id }) => id)).toEqual([
      'delayed-wip',
      'start-finish',
      'wip-concentration',
      'active-reentry',
      'throughput-drop',
    ])
    expect(summary.delayedWorkInProgress.map(({ item }) => item)).toEqual([
      'DEMO-1',
      'DEMO-3',
    ])
    expect(summary.reenteredWorkInProgress).toEqual([
      { item: 'DEMO-3', currentStatus: 'Code Review' },
    ])
    expect(summary.signals[1]?.evidence).toBe(
      '3 items started and 0 finished in the last two complete weeks. Active work grew from 1 to 5.',
    )
    expect(summary.signals[2]?.title).toBe('Work is piling up in “Code Review”')
    expect(summary.signals[2]?.evidence).toBe(
      'Finished items spent 89% of their time in Code Review, and 4 of 5 active items sit there now.',
    )
    expect(summary.signals[2]?.meta).toBe('4 items in Code Review')
    expect(summary.signals[4]?.evidence).toContain(
      '1 item finished in the last two complete weeks, down from 4',
    )
    const delayedFilter = summary.signals[0]?.jiraFilter
    const delayedUrl = new URL(delayedFilter?.href ?? '')
    expect(delayedFilter?.label).toBe('Open the delayed items in Jira')
    expect(delayedUrl.pathname).toBe('/jira/issues/')
    expect(delayedUrl.searchParams.get('jql')).toBe('key in (DEMO-1, DEMO-3)')
    expect(summary.signals[2]?.jiraFilter).toBeUndefined()
    expect(summary.signals[0]?.meta).toBe('DEMO-1, DEMO-3')
    expect(summary.signals[0]?.evidence).toMatch(/^Oldest: DEMO-\d+, /)
    expect(summary.signals[0]?.evidence).toContain('already late')

    const reentryFilter = summary.signals[3]?.jiraFilter
    const reentryUrl = new URL(reentryFilter?.href ?? '')
    expect(reentryFilter?.label).toBe('Open the re-entered items in Jira')
    expect(reentryUrl.pathname).toBe('/jira/issues/')
    expect(reentryUrl.searchParams.get('jql')).toBe('key in (DEMO-3)')
    expect(summary.signals[4]?.jiraFilter).toBeUndefined()
  })

  it('grounds investigations in the selected signal and requests supported decisions', () => {
    const summary = buildFocusNowSummary({
      snapshot,
      selectedColumnIds: ['progress-column', 'review-column'],
      metrics,
      windowDays: 60,
    })
    for (const signal of summary.signals) {
      const prompt = focusSignalAgentPrompt(signal)
      expect(prompt).toContain(signal.title)
      expect(prompt).toContain(signal.evidence)
      expect(prompt).toContain('Cite relevant ticket evidence')
      expect(prompt).toContain(
        'distinguish observed facts from possible causes',
      )
      expect(prompt).toContain('measurable checkpoint')
    }
    expect(summary.signals.map(focusSignalActionLabel)).toEqual([
      'Investigate aging items',
      'Investigate what was started',
      'Investigate work concentration',
      'Review re-entered items',
      'Investigate throughput drop',
    ])
  })

  it('returns one explicit clear-state signal when no rule fires', () => {
    const quietSnapshot: FlowBoardSnapshot = {
      ...snapshot,
      issues: [snapshot.issues[4]!],
      transitions: [snapshot.transitions.at(-1)!],
    }
    const quietMetrics: FlowMetrics = {
      ...metrics,
      cycleTimes: [],
    }

    const summary = buildFocusNowSummary({
      snapshot: quietSnapshot,
      selectedColumnIds: ['progress-column', 'review-column'],
      metrics: quietMetrics,
      windowDays: 60,
    })

    expect(summary.delayedWorkInProgress).toEqual([])
    expect(summary.signals).toEqual([
      expect.objectContaining({ id: 'healthy', severity: 'healthy' }),
    ])
  })

  it('does not call a slow stage a pile-up when few active items sit there', () => {
    // Review takes 89% of finished time, but only A and B are in it now.
    const thinSnapshot: FlowBoardSnapshot = {
      ...snapshot,
      issues: snapshot.issues.filter(({ key }) =>
        ['DEMO-1', 'DEMO-2', 'DEMO-5', 'DEMO-6'].includes(key),
      ),
      transitions: snapshot.transitions.filter(({ issueId }) =>
        ['issue-A', 'issue-B', 'issue-E', 'issue-F'].includes(issueId),
      ),
    }
    const summary = buildFocusNowSummary({
      snapshot: thinSnapshot,
      selectedColumnIds: ['progress-column', 'review-column'],
      metrics,
      windowDays: 60,
    })
    expect(summary.signals.map(({ id }) => id)).not.toContain(
      'wip-concentration',
    )
  })

  it('reads the time shares it is given instead of the snapshot', () => {
    const summary = buildFocusNowSummary({
      snapshot,
      selectedColumnIds: ['progress-column', 'review-column'],
      metrics,
      windowDays: 60,
      timeShares: new Map([
        ['progress-column', 0.7],
        ['review-column', 0.3],
      ]),
    })
    // In Progress takes most time but holds only E: no pile-up either way.
    expect(summary.signals.map(({ id }) => id)).not.toContain(
      'wip-concentration',
    )
  })

  it('keeps the Today surface focused while preserving lower-priority signals', () => {
    const summary = buildFocusNowSummary({
      snapshot,
      selectedColumnIds: ['progress-column', 'review-column'],
      metrics,
      windowDays: 60,
    })

    const selection = selectTodaySignals(summary.signals)

    expect(selection.priorities.map(({ id }) => id)).toEqual([
      'delayed-wip',
      'start-finish',
      'wip-concentration',
    ])
    expect(selection.additional.map(({ id }) => id)).toEqual([
      'active-reentry',
      'throughput-drop',
    ])
    expect(focusSignalAgentPrompt(selection.priorities[0]!)).toContain(
      'distinguish age from cause',
    )
  })
})

function cyclePoint(item: string, cycleEnd: string) {
  return {
    item,
    cycleTime: 5,
    sequence: Number(item.slice(-1)),
    cycleStart: '2026-08-01T09:00:00Z',
    cycleEnd,
    completedLabel: cycleEnd.slice(0, 10),
  }
}

/** Eight items in progress since Sep 1, held by the given owners (null: nobody). */
function ownedBoard(
  owners: Array<string | null>,
  ownerKnown = true,
): FlowBoardSnapshot {
  return {
    ...snapshot,
    issues: owners.map((owner, index) => ({
      id: `owned-${index}`,
      key: `DEMO-${index + 11}`,
      issueTypeId: 'story',
      issueTypeName: 'Story',
      createdAt: '2026-08-01T09:00:00Z',
      browseUrl: `https://jira.example.invalid/jira/browse/DEMO-${index + 11}`,
      ...(owner ? { assignee: owner } : {}),
      ...(ownerKnown ? { ownerKnown: true } : {}),
    })),
    transitions: owners.map((_, index) => ({
      issueId: `owned-${index}`,
      statusId: 'progress',
      enteredAt: '2026-09-01T09:00:00Z',
    })),
  }
}

function signalsFor(board: FlowBoardSnapshot) {
  return buildFocusNowSummary({
    snapshot: board,
    selectedColumnIds: ['progress-column', 'review-column'],
    metrics,
    windowDays: 60,
  }).signals
}

describe('Ownership signals', () => {
  it('names the person holding most of the active work as a load, with their items', () => {
    const signal = signalsFor(
      ownedBoard([
        'Dana',
        'Dana',
        'Priya',
        'Dana',
        'Sam',
        'Dana',
        'Dana',
        'Priya',
      ]),
    ).find(({ id }) => id === 'owner-concentration')
    expect(signal).toMatchObject({
      severity: 'warning',
      title: 'Work piles on one person',
      evidence:
        'Dana holds 5 of 8 active items (63%). If Dana is out, no one else holds them.',
      meta: '5 items with Dana',
      action: 'Spread the load: agree what Dana hands over this week.',
    })
    expect(signal?.jiraFilter?.label).toBe('Open Dana’s items in Jira')
    expect(signal?.jiraFilter?.href).toContain('DEMO-11')
    expect(focusSignalActionLabel(signal!)).toBe('Investigate the load')
    expect(focusSignalAgentPrompt(signal!)).toContain('never as that person')
  })

  it('stays quiet for a one-person board and below four in ten or five items', () => {
    const ids = (owners: Array<string | null>) =>
      signalsFor(ownedBoard(owners)).map(({ id }) => id)
    expect(ids(Array(8).fill('Dana'))).not.toContain('owner-concentration')
    expect(
      ids(['Dana', 'Dana', 'Dana', 'Dana', 'Priya', 'Priya', 'Sam', 'Sam']),
    ).not.toContain('owner-concentration')
  })

  it('lists active items nobody holds on a board that assigns work', () => {
    const signal = signalsFor(
      ownedBoard(['Dana', null, 'Priya', null, 'Sam', null, 'Lee', 'Ana']),
    ).find(({ id }) => id === 'no-owner')
    expect(signal).toMatchObject({
      severity: 'warning',
      title: '3 active items have no owner',
      evidence: '3 items are in progress but assigned to nobody.',
      meta: 'DEMO-12, DEMO-14, DEMO-16',
      action: 'Give each one an owner today, or move it back to the backlog.',
    })
    expect(focusSignalActionLabel(signal!)).toBe('Review the unowned items')
  })

  it('does not call items unowned when the board does not use owners', () => {
    const ids = (board: FlowBoardSnapshot) =>
      signalsFor(board).map(({ id }) => id)
    expect(ids(ownedBoard(Array(8).fill(null)))).not.toContain('no-owner')
    expect(
      ids(
        ownedBoard(
          ['Dana', null, null, null, 'Sam', null, 'Lee', 'Ana'],
          false,
        ),
      ),
    ).not.toContain('no-owner')
    expect(
      ids(
        ownedBoard(['Dana', null, 'Priya', null, 'Sam', 'Ana', 'Lee', 'Ana']),
      ),
    ).not.toContain('no-owner')
  })
})
