import { describe, expect, it } from 'vitest'
import type { FlowBoardSnapshot } from '../../types'
import { assessDataQuality } from './data-quality'

const now = new Date('2026-07-28T12:00:00Z')

function completedSnapshot(issueCount = 12): FlowBoardSnapshot {
  return {
    source: { kind: 'jira-data-center', label: 'Fictional board' },
    board: {
      id: 'board-1',
      name: 'Fictional board',
      statuses: [
        { id: 'todo', name: 'To Do' },
        { id: 'progress', name: 'In Progress' },
        { id: 'done', name: 'Done' },
      ],
      columns: [
        { id: 'todo-column', name: 'To Do', statusIds: ['todo'] },
        {
          id: 'progress-column',
          name: 'In Progress',
          statusIds: ['progress'],
        },
        { id: 'done-column', name: 'Done', statusIds: ['done'] },
      ],
    },
    issues: Array.from({ length: issueCount }, (_, index) => ({
      id: `issue-${index + 1}`,
      key: `DEMO-${index + 1}`,
      issueTypeId: 'story',
      issueTypeName: 'Story',
      createdAt: '2026-01-01T09:00:00Z',
    })),
    transitions: Array.from({ length: issueCount }, (_, index) => {
      const day = String(5 + index).padStart(2, '0')
      const exitDay = String(6 + index).padStart(2, '0')
      return [
        {
          issueId: `issue-${index + 1}`,
          statusId: 'progress',
          enteredAt: `2026-07-${day}T09:00:00Z`,
        },
        {
          issueId: `issue-${index + 1}`,
          statusId: 'done',
          enteredAt: `2026-07-${exitDay}T09:00:00Z`,
        },
      ]
    }).flat(),
    loadedAt: '2026-07-28T11:55:00Z',
  }
}

const filters = {
  ticketTypes: [] as string[],
  windowDays: 30,
  selectedColumnIds: ['progress-column'],
}

describe('data-quality assessment', () => {
  it('allows current-work insights while warning about an absent completed sample', () => {
    const snapshot = completedSnapshot(1)
    snapshot.transitions = snapshot.transitions.filter(
      (event) => event.statusId === 'progress',
    )
    const report = assessDataQuality(snapshot, filters, now)
    expect(report.status).toBe('warning')
    expect(report.completedObservationCount).toBe(0)
  })
  it('reconciles a complete exit cohort across every metric representation', () => {
    const report = assessDataQuality(completedSnapshot(), filters, now)

    expect(report.status).toBe('ready')
    expect(report.completedObservationCount).toBe(12)
    expect(report.metricsReconciled).toBe(true)
    expect(report.findings).toEqual([])
    expect(report.passedCount).toBe(report.checkCount)
    // 12 finished items: enough for direction, not yet strong.
    expect(report.verdict.level).toBe('directional')
  })

  it('explains mutually exclusive cohort exclusions', () => {
    const snapshot = completedSnapshot(1)
    snapshot.issues.push(
      {
        id: 'wip',
        key: 'DEMO-WIP',
        issueTypeId: 'story',
        issueTypeName: 'Story',
        createdAt: '2026-07-20T09:00:00Z',
      },
      {
        id: 'outside',
        key: 'DEMO-OUT',
        issueTypeId: 'story',
        issueTypeName: 'Story',
        createdAt: '2026-01-01T09:00:00Z',
      },
      {
        id: 'never-entered',
        key: 'DEMO-NEVER',
        issueTypeId: 'story',
        issueTypeName: 'Story',
        createdAt: '2026-07-20T09:00:00Z',
      },
      {
        id: 'bug',
        key: 'DEMO-BUG',
        issueTypeId: 'bug',
        issueTypeName: 'Bug',
        createdAt: '2026-07-20T09:00:00Z',
      },
    )
    snapshot.transitions.push(
      {
        issueId: 'wip',
        statusId: 'progress',
        enteredAt: '2026-07-20T09:00:00Z',
      },
      {
        issueId: 'outside',
        statusId: 'progress',
        enteredAt: '2026-05-01T09:00:00Z',
      },
      {
        issueId: 'outside',
        statusId: 'done',
        enteredAt: '2026-05-03T09:00:00Z',
      },
      {
        issueId: 'never-entered',
        statusId: 'todo',
        enteredAt: '2026-07-20T09:00:00Z',
      },
      {
        issueId: 'bug',
        statusId: 'progress',
        enteredAt: '2026-07-21T09:00:00Z',
      },
      {
        issueId: 'bug',
        statusId: 'done',
        enteredAt: '2026-07-22T09:00:00Z',
      },
    )

    const report = assessDataQuality(
      snapshot,
      { ...filters, ticketTypes: ['Story'] },
      now,
    )

    expect(report.completedObservationCount).toBe(1)
    expect(report.workInProgressCount).toBe(1)
    expect(report.exitedOutsideWindowCount).toBe(1)
    expect(report.neverEnteredCount).toBe(1)
    expect(report.typeExcludedCount).toBe(1)
    expect(report.metricsReconciled).toBe(true)
    expect(report.status).toBe('warning')
  })

  it('surfaces structural anomalies without exposing ticket contents', () => {
    const snapshot = completedSnapshot()
    snapshot.issues.push({ ...snapshot.issues[0]! })
    snapshot.transitions.push(
      {
        issueId: 'missing-issue',
        statusId: 'progress',
        enteredAt: '2026-07-20T09:00:00Z',
      },
      {
        issueId: 'issue-1',
        statusId: 'unknown',
        enteredAt: '2026-07-29T09:00:00Z',
      },
      {
        issueId: 'issue-2',
        statusId: 'done',
        enteredAt: 'not-a-timestamp',
      },
    )

    const report = assessDataQuality(snapshot, filters, now)

    expect(report.duplicateIssueCount).toBe(1)
    expect(report.orphanTransitionCount).toBe(1)
    expect(report.unmappedStatusEventCount).toBe(1)
    expect(report.futureTransitionCount).toBe(1)
    expect(report.invalidTransitionCount).toBe(1)
    expect(report.status).toBe('blocked')
  })

  it('says plainly when nothing has finished, and offers a longer period that has', () => {
    const snapshot = completedSnapshot(12)
    // Shift every finish to May: outside the last 30 days, inside 90.
    snapshot.transitions = snapshot.transitions.map((event) => ({
      ...event,
      enteredAt: event.enteredAt.replace('2026-07-', '2026-05-'),
    }))
    const report = assessDataQuality(snapshot, filters, now)
    const finding = report.findings.find(
      (item) => item.id === 'no-finished-work',
    )
    expect(finding?.title).toBe('Nothing has finished yet')
    expect(finding?.fix).toEqual({
      kind: 'window',
      days: 90,
      label: 'Measure the last 90 days',
    })
    expect(report.verdict.level).toBe('weak')
    expect(report.verdict.sentence).toMatch(/^Weak: no work has finished/)
  })

  it('flags a small sample and calls the numbers weak below five', () => {
    const report = assessDataQuality(completedSnapshot(3), filters, now)
    expect(report.findings.map((item) => item.id)).toContain('small-sample')
    expect(report.verdict.level).toBe('weak')
  })

  it('calls twenty clean finished items strong', () => {
    const snapshot = completedSnapshot(20)
    // Twenty finishes across the window, the earliest history before it.
    snapshot.transitions = snapshot.issues.flatMap((issue, index) => [
      {
        issueId: issue.id,
        statusId: 'progress',
        enteredAt: new Date(Date.UTC(2026, 5, 2 + index)).toISOString(),
      },
      {
        issueId: issue.id,
        statusId: 'done',
        enteredAt: new Date(Date.UTC(2026, 5, 4 + index)).toISOString(),
      },
    ])
    const report = assessDataQuality(
      snapshot,
      { ...filters, windowDays: 60 },
      now,
    )
    expect(report.completedObservationCount).toBe(20)
    expect(report.findings).toEqual([])
    expect(report.verdict.level).toBe('strong')
  })

  it('notices history that starts partway through the period', () => {
    const snapshot = completedSnapshot(12)
    const report = assessDataQuality(
      snapshot,
      { ...filters, windowDays: 90 },
      now,
    )
    const finding = report.findings.find((item) => item.id === 'late-history')
    expect(finding?.detail).toContain('begins on 5 Jul 2026')
  })

  it('notices many items moved in the same minute', () => {
    const snapshot = completedSnapshot(12)
    snapshot.transitions = snapshot.transitions.map((event) =>
      event.statusId === 'done'
        ? { ...event, enteredAt: '2026-07-25T10:02:30Z' }
        : event,
    )
    const report = assessDataQuality(snapshot, filters, now)
    const finding = report.findings.find((item) => item.id === 'bulk-moves')
    expect(finding?.detail).toMatch(
      /^12 items changed status in the same minute/,
    )
    expect(report.verdict.level).toBe('directional')
  })

  it('notices work that goes straight to done, skipping the measured stages', () => {
    const snapshot = completedSnapshot(4)
    for (let index = 0; index < 4; index++) {
      snapshot.issues.push({
        id: `skip-${index}`,
        key: `DEMO-S${index}`,
        issueTypeId: 'story',
        issueTypeName: 'Story',
        createdAt: '2026-07-01T09:00:00Z',
      })
      snapshot.transitions.push(
        {
          issueId: `skip-${index}`,
          statusId: 'todo',
          enteredAt: '2026-07-10T09:00:00Z',
        },
        {
          issueId: `skip-${index}`,
          statusId: 'done',
          enteredAt: '2026-07-12T09:00:00Z',
        },
      )
    }
    const report = assessDataQuality(snapshot, filters, now)
    expect(report.skippedStageCount).toBe(4)
    expect(
      report.findings.find((item) => item.id === 'skipped-stages')?.detail,
    ).toContain('without ever passing In Progress')
  })

  it('notices work in progress that has not moved for months', () => {
    const snapshot = completedSnapshot(12)
    snapshot.issues.push({
      id: 'old',
      key: 'DEMO-OLD',
      issueTypeId: 'story',
      issueTypeName: 'Story',
      createdAt: '2026-01-01T09:00:00Z',
    })
    snapshot.transitions.push({
      issueId: 'old',
      statusId: 'progress',
      enteredAt: '2026-02-01T09:00:00Z',
    })
    const report = assessDataQuality(snapshot, filters, now)
    expect(report.forgottenWorkCount).toBe(1)
    expect(report.findings.map((item) => item.id)).toContain('forgotten-work')
  })

  it('notices a stage first used partway through the period', () => {
    const snapshot = completedSnapshot(12)
    snapshot.board.statuses.push({ id: 'review', name: 'Review' })
    snapshot.board.columns.splice(2, 0, {
      id: 'review-column',
      name: 'Review',
      statusIds: ['review'],
    })
    // Months of earlier history, so a new stage stands out.
    snapshot.issues.forEach((issue, index) =>
      snapshot.transitions.push(
        {
          issueId: issue.id,
          statusId: 'todo',
          enteredAt: `2026-04-${String(index + 1).padStart(2, '0')}T09:00:00Z`,
        },
        {
          issueId: issue.id,
          statusId: 'progress',
          enteredAt: `2026-04-${String(index + 2).padStart(2, '0')}T09:00:00Z`,
        },
      ),
    )
    snapshot.transitions.push({
      issueId: 'issue-12',
      statusId: 'review',
      enteredAt: '2026-07-16T12:00:00Z',
    })
    const report = assessDataQuality(snapshot, filters, now)
    expect(
      report.findings.find((item) => item.id === 'workflow-changed')?.detail,
    ).toContain('“Review” was first used on 16 Jul 2026')
  })
})
