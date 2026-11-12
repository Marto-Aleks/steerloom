import { describe, expect, it } from 'vitest'
import {
  extractProjectTicketKeys,
  extractTicketKeys,
  resolveAiJiraLookup,
  type AiJiraLookupContext,
} from './jira-evidence'

const reportContext: AiJiraLookupContext = {
  ticketGroupTotals: {
    completedOutliers: 7,
    delayedWorkInProgress: 2,
    reenteredWorkInProgress: 1,
  },
  completedOutliers: Array.from({ length: 7 }, (_, index) => ({
    key: `DEMO-${index + 1}`,
  })),
  delayedWorkInProgress: [{ key: 'DEMO-20' }, { key: 'DEMO-21' }],
  reenteredWorkInProgress: [{ key: 'DEMO-30' }],
}

describe('AI Jira ticket-key selection', () => {
  it('selects unique keys only from the active project', () => {
    expect(
      extractProjectTicketKeys(
        'Compare demo-12 with DEMO-4 and OTHER-9. Check DEMO-12 again.',
        'DEMO',
      ),
    ).toEqual(['DEMO-12', 'DEMO-4'])
  })

  it('caps lookups and rejects invalid project scopes', () => {
    expect(
      extractProjectTicketKeys(
        'DEMO-1 DEMO-2 DEMO-3 DEMO-4 DEMO-5 DEMO-6',
        'DEMO',
      ),
    ).toEqual(['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4', 'DEMO-5'])
    expect(extractProjectTicketKeys('DEMO-1', '../DEMO')).toEqual([])
  })

  it('recognizes ticket keys before a Jira report is available', () => {
    expect(extractTicketKeys('Check abc-12 and OTHER_2-8.')).toEqual([
      'ABC-12',
      'OTHER_2-8',
    ])
  })
})

describe('AI Jira conversational lookup resolution', () => {
  it('resolves a report group to a lightweight lookup for every ticket', () => {
    expect(
      resolveAiJiraLookup(
        reportContext,
        [
          {
            role: 'user',
            content: 'Do the completed outliers have a common assignee?',
          },
        ],
        'DEMO',
      ),
    ).toEqual({
      mode: 'overview',
      source: 'completed outliers above P85',
      keys: [
        'DEMO-1',
        'DEMO-2',
        'DEMO-3',
        'DEMO-4',
        'DEMO-5',
        'DEMO-6',
        'DEMO-7',
      ],
      availableCount: 7,
      omittedCount: 0,
    })
  })

  it('limits detailed group evidence and reports the omitted count', () => {
    expect(
      resolveAiJiraLookup(
        reportContext,
        [
          {
            role: 'user',
            content:
              'Show the comments and history for the completed outliers.',
          },
        ],
        'DEMO',
      ),
    ).toMatchObject({
      mode: 'detail',
      keys: ['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4', 'DEMO-5'],
      availableCount: 7,
      omittedCount: 2,
    })
  })

  it('reports report tickets omitted before the 25-key overview cap', () => {
    expect(
      resolveAiJiraLookup(
        {
          ...reportContext,
          ticketGroupTotals: {
            ...reportContext.ticketGroupTotals,
            completedOutliers: 31,
          },
        },
        [{ role: 'user', content: 'Who owns the completed outliers?' }],
        'DEMO',
      ),
    ).toMatchObject({
      mode: 'overview',
      availableCount: 31,
      keys: [
        'DEMO-1',
        'DEMO-2',
        'DEMO-3',
        'DEMO-4',
        'DEMO-5',
        'DEMO-6',
        'DEMO-7',
      ],
      omittedCount: 24,
    })
  })

  it('resolves delayed, re-entered, and conversational follow-up references', () => {
    expect(
      resolveAiJiraLookup(
        reportContext,
        [{ role: 'user', content: 'Who owns the delayed WIP?' }],
        'DEMO',
      )?.keys,
    ).toEqual(['DEMO-20', 'DEMO-21'])
    expect(
      resolveAiJiraLookup(
        reportContext,
        [{ role: 'user', content: 'Check the re-entered tickets.' }],
        'DEMO',
      )?.keys,
    ).toEqual(['DEMO-30'])
    expect(
      resolveAiJiraLookup(
        reportContext,
        [
          { role: 'user', content: 'Look at the completed outliers.' },
          { role: 'assistant', content: 'The report lists seven tickets.' },
          {
            role: 'user',
            content: 'Now show me the comments on those tickets.',
          },
        ],
        'DEMO',
      ),
    ).toMatchObject({
      mode: 'detail',
      source: 'completed outliers above P85',
      keys: ['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4', 'DEMO-5'],
      omittedCount: 2,
    })
  })

  it('does not trust ticket keys introduced only by an assistant', () => {
    expect(
      resolveAiJiraLookup(
        reportContext,
        [
          { role: 'assistant', content: 'Consider DEMO-999.' },
          { role: 'user', content: 'Who owns that ticket?' },
        ],
        'DEMO',
      ),
    ).toBeNull()
  })

  it('reads the current work in a stage the question names, preferring the longest name', () => {
    const context = {
      ticketGroupTotals: {
        completedOutliers: 0,
        delayedWorkInProgress: 0,
        reenteredWorkInProgress: 0,
      },
      completedOutliers: [],
      delayedWorkInProgress: [],
      reenteredWorkInProgress: [],
      workInProgressByStage: [
        { stage: 'Review', count: 1, items: [{ key: 'DEMO-1' }] },
        {
          stage: 'Code Review',
          count: 6,
          items: [{ key: 'DEMO-7' }, { key: 'DEMO-8' }],
        },
      ],
    }
    const ask = (content: string) =>
      resolveAiJiraLookup(context, [{ role: 'user', content }], 'DEMO')
    expect(ask('Why is work piling up in Code Review?')).toMatchObject({
      source: 'current work in a stage',
      mode: 'detail',
      keys: ['DEMO-7', 'DEMO-8'],
      availableCount: 6,
    })
    expect(ask('Who owns the Review queue?')).toMatchObject({
      mode: 'overview',
      keys: ['DEMO-1'],
    })
    // A stage word used without pointing at the stage reads nothing.
    expect(ask('Should we review our forecast?')).toBeNull()
  })
})
