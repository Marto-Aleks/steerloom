import { describe, expect, it } from 'vitest'
import type { AgingWorkItem } from './aging-work'
import {
  buildBriefing,
  pileUpStage,
  stageLoads,
  type BriefingInput,
} from './briefing'
import type { FocusSignal } from './focus-now'
import type { FlowPeriodComparison } from './flow-evidence'

const healthy: FocusSignal = {
  id: 'healthy',
  severity: 'healthy',
  title: 'No immediate flow risk detected',
  evidence: 'Nothing fired.',
  action: 'Keep going.',
}
const delayed: FocusSignal = {
  id: 'delayed-wip',
  severity: 'critical',
  title: '4 tickets past the usual 7 days',
  evidence: 'Current work has exceeded the 7d completed-ticket P85.',
  action: 'Review the delayed items.',
}
const concentration: FocusSignal = {
  id: 'wip-concentration',
  severity: 'warning',
  title: 'Work is piling up in “In progress”',
  evidence: '7 of 7 current tickets (100%) are in this column.',
  action: 'Review capacity.',
}
const throughputDrop: FocusSignal = {
  id: 'throughput-drop',
  severity: 'warning',
  title: 'Recent exit throughput dropped',
  evidence: '2 tickets exited in the last two complete weeks, compared with 6.',
  action: 'Check WIP.',
}
const reentry: FocusSignal = {
  id: 'active-reentry',
  severity: 'info',
  title: '1 active ticket re-entered the flow',
  evidence: '1 current ticket returned after previously leaving.',
  action: 'Review the re-entered items.',
}

const steadyInput: BriefingInput = {
  completedCount: 20,
  medianDays: 5,
  p85Days: 7,
  signals: [healthy],
  activeCount: 7,
  beyondLimitCount: 0,
  dataQuality: 'ready',
}

function comparison(
  currentMedian: number | null,
  previousMedian: number | null,
): FlowPeriodComparison {
  const period = {
    start: '2026-09-21T00:00:00.000Z',
    end: '2026-10-21T00:00:00.000Z',
    days: 30,
  }
  return {
    current: {
      period,
      completedObservations: 20,
      medianCycleTimeDays: currentMedian,
      percentile85CycleTimeDays: 7,
      exitThroughputPerWeek: 4.7,
      delayedWorkInProgress: 0,
      reenteredWorkInProgress: 0,
      historyCoverage: 'complete',
    },
    previous: {
      period: { ...period, start: '2026-08-22T00:00:00.000Z' },
      completedObservations: 17,
      medianCycleTimeDays: previousMedian,
      percentile85CycleTimeDays: 6,
      exitThroughputPerWeek: 4,
      delayedWorkInProgress: 1,
      reenteredWorkInProgress: 0,
      historyCoverage: 'complete',
    },
  }
}

describe('buildBriefing', () => {
  it('never gives an all-clear without a completed sample', () => {
    const briefing = buildBriefing({
      ...steadyInput,
      completedCount: 0,
      medianDays: null,
      p85Days: null,
      signals: [
        {
          id: 'insufficient-history',
          severity: 'warning',
          title: 'Cycle-time baseline is not available yet',
          evidence: '',
          action: '',
        },
      ],
    })
    expect(briefing.tone).toBe('insufficient')
    expect(briefing.headline).toBe(
      'Not enough finished work to judge delivery yet.',
    )
    expect(briefing.summary).toBe(
      '7 active items sit in the measured stages, but nothing finished in this period, so typical times and the usual limit cannot be calculated.',
    )
    expect(briefing.caveats).toContain(
      'No completed sample: this is not an all-clear.',
    )
    expect(briefing.headline).not.toMatch(/steady/i)
  })

  it('treats a missing median or P85 as insufficient even with a count', () => {
    expect(buildBriefing({ ...steadyInput, medianDays: null }).tone).toBe(
      'insufficient',
    )
    expect(
      buildBriefing({ ...steadyInput, activeCount: 0, completedCount: 0 })
        .summary,
    ).toBe(
      'Nothing finished in this period and nothing is active in the measured stages, so there is no delivery to judge yet.',
    )
  })

  it('reports steady delivery from the computed numbers only', () => {
    const briefing = buildBriefing(steadyInput)
    expect(briefing).toEqual({
      tone: 'steady',
      headline: 'Delivery is steady: 20 items finished, typical time 5 days.',
      summary:
        'Half of the 20 finished items took 5 days or less; 85% within 7 days.',
      caveats: [],
    })
  })

  it('raises attention when active items are past the usual limit', () => {
    const briefing = buildBriefing({
      ...steadyInput,
      signals: [delayed, concentration],
      beyondLimitCount: 4,
    })
    expect(briefing.tone).toBe('attention')
    expect(briefing.headline).toBe(
      '4 of 7 items in progress have taken longer than usual.',
    )
    expect(briefing.summary).toBe('Usual is 7 days, from 20 finished items.')
  })

  it('uses singular grammar for one delayed item and decimals for P85', () => {
    const briefing = buildBriefing({
      ...steadyInput,
      p85Days: 7.25,
      medianDays: 4.5,
      signals: [delayed],
      beyondLimitCount: 1,
    })
    expect(briefing.headline).toBe(
      '1 of 7 items in progress has taken longer than usual.',
    )
    expect(briefing.summary).toContain('Usual is 7.3 days')
  })

  it('moves to watch on warning signals and names the first one', () => {
    const briefing = buildBriefing({
      ...steadyInput,
      signals: [concentration, throughputDrop],
    })
    expect(briefing.tone).toBe('watch')
    expect(briefing.headline).toBe(
      'Delivery is moving, but work is piling up in “In progress”.',
    )
    // Further signals have their own cards; the summary stays one sentence.
    expect(briefing.summary).not.toContain('fewer items finished')
  })

  it('flags a small sample as watch with an explicit caveat', () => {
    const briefing = buildBriefing({ ...steadyInput, completedCount: 3 })
    expect(briefing.tone).toBe('watch')
    expect(briefing.headline).toBe(
      'Early signs look steady, but only 3 items have finished so far.',
    )
    expect(briefing.caveats).toEqual([
      'Small sample: only 3 items finished, so treat these numbers as indicative.',
    ])
  })

  it('keeps informational re-entry out of the tone and the summary', () => {
    const briefing = buildBriefing({
      ...steadyInput,
      signals: [reentry],
      reenteredCount: 1,
    })
    expect(briefing.tone).toBe('steady')
    expect(briefing.summary).toBe(
      'Half of the 20 finished items took 5 days or less; 85% within 7 days.',
    )
  })

  it('describes the typical-time trend only when it changed', () => {
    expect(
      buildBriefing({ ...steadyInput, comparison: comparison(5, 6.5) }).summary,
    ).toContain('typical time is 1.5 days quicker than the previous 30 days')
    expect(
      buildBriefing({ ...steadyInput, comparison: comparison(5, 4) }).summary,
    ).toContain('typical time is 1 day slower than the previous 30 days')
    expect(
      buildBriefing({ ...steadyInput, comparison: comparison(5, 5.01) })
        .summary,
    ).not.toContain('typical time is')
    expect(
      buildBriefing({ ...steadyInput, comparison: comparison(5, null) })
        .summary,
    ).not.toContain('typical time is')
  })

  it('adds a data-quality caveat without changing the tone', () => {
    const briefing = buildBriefing({ ...steadyInput, dataQuality: 'warning' })
    expect(briefing.tone).toBe('steady')
    expect(briefing.caveats).toEqual([
      'Data checks found something worth a look (see How this was measured).',
    ])
  })

  it('is deterministic and never mentions people', () => {
    const first = buildBriefing({ ...steadyInput, signals: [delayed] })
    const second = buildBriefing({ ...steadyInput, signals: [delayed] })
    expect(first).toEqual(second)
    expect(`${first.headline} ${first.summary}`).not.toMatch(
      /assignee|developer|engineer|person|who/i,
    )
  })
})

const columns = [
  { id: 'stage-0', name: 'Backlog' },
  { id: 'stage-1', name: 'In progress' },
  { id: 'stage-2', name: 'Review' },
  { id: 'stage-3', name: 'Done' },
]

function item(id: string, columnId: string): AgingWorkItem {
  return {
    id,
    item: id,
    columnId,
    column: columns.find((column) => column.id === columnId)?.name ?? columnId,
    currentStatus: columnId,
    ageInSelectedColumns: 3,
    currentStageAgeDays: 1,
    history: [],
  }
}

describe('stage loads', () => {
  it('counts active items per measured stage in board order, keeping empties', () => {
    const loads = stageLoads(
      columns,
      ['stage-2', 'stage-1'],
      [item('a', 'stage-1'), item('b', 'stage-1'), item('c', 'stage-2')],
    )
    expect(loads).toEqual([
      { id: 'stage-1', name: 'In progress', count: 2 },
      { id: 'stage-2', name: 'Review', count: 1 },
    ])
    expect(stageLoads(columns, [], [])).toEqual([])
  })

  it('counts items past the usual limit per stage when asked', () => {
    const loads = stageLoads(
      columns,
      ['stage-1', 'stage-2'],
      [item('a', 'stage-1'), item('b', 'stage-1'), item('c', 'stage-2')],
      (entry) => entry.id !== 'b',
    )
    expect(loads.map(({ count, late }) => ({ count, late }))).toEqual([
      { count: 2, late: 1 },
      { count: 1, late: 1 },
    ])
  })

  it('calls out a pile-up where finished work spent most of its time', () => {
    const piled = [
      { id: 'a', name: 'In progress', count: 5, timeShare: 0.76 },
      { id: 'b', name: 'Review', count: 6, timeShare: 0.24 },
    ]
    expect(pileUpStage(piled)?.name).toBe('In progress')
    const spread = [
      { id: 'a', name: 'In progress', count: 3, timeShare: 0.45 },
      { id: 'b', name: 'Review', count: 4, timeShare: 0.55 },
    ]
    expect(pileUpStage(spread)).toBeNull()
    // Slow, but not holding a pile today.
    expect(
      pileUpStage([
        { id: 'a', name: 'In progress', count: 2, timeShare: 0.9 },
        { id: 'b', name: 'Review', count: 9, timeShare: 0.1 },
      ]),
    ).toBeNull()
    // Unknown time shares: never a pile-up.
    expect(
      pileUpStage([
        { id: 'a', name: 'In progress', count: 9 },
        { id: 'b', name: 'Review', count: 1 },
      ]),
    ).toBeNull()
  })
})
