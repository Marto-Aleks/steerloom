import { describe, expect, it } from 'vitest'
import {
  AI_ASSISTANT_MESSAGE_CHAR_LIMIT,
  AI_USER_MESSAGE_CHAR_LIMIT,
} from '../../src/lib/ai/conversation'
import { parseAiChatRequest } from './request'

const validRequest = {
  context: {
    generatedAt: '2026-09-10T09:00:00Z',
    sourceLabel: 'DEMO · Fictional board',
    boardName: 'Fictional board',
    scope: {
      selectedColumns: ['In Progress'],
      ticketTypes: ['Story'],
      windowDays: 30,
    },
    headline: {
      completedObservations: 3,
      medianCycleTimeDays: 5,
      percentile85CycleTimeDays: 9,
      exitThroughputPerWeek: 0.7,
    },
    ticketGroupTotals: {
      completedOutliers: 0,
      delayedWorkInProgress: 0,
      reenteredWorkInProgress: 0,
    },
    focusSignals: [],
    weeklyThroughput: [],
    cycleTimeDistribution: [],
    weeklyCycleTimeTrend: [],
    delayedWorkInProgress: [],
    completedOutliers: [],
    reenteredWorkInProgress: [],
  },
  messages: [{ role: 'user', content: 'What should the team discuss?' }],
}

describe('pull request evidence in the report context', () => {
  const withPullRequests = (pullRequests: unknown) => ({
    ...validRequest,
    context: { ...validRequest.context, pullRequests },
  })
  const evidence = {
    repositories: 1,
    coverage: { linked: 8, finished: 10 },
    typicalInsideReview: {
      waitingForFirstReviewDays: 2,
      reviewRoundsDays: 1,
      waitingToMergeDays: 0.5,
    },
    items: [
      {
        key: 'FLOW-1',
        stage: 'Review',
        daysInStage: 9,
        ageDays: 14,
        pullRequests: [
          {
            ref: 'acme/web#1',
            state: 'merged',
            readyDaysAgo: 9,
            changesRequested: 0,
            mergedDaysAgo: 3,
          },
        ],
      },
    ],
    omittedItems: 0,
  }

  it('keeps valid evidence as sent', () => {
    expect(
      parseAiChatRequest(withPullRequests(evidence))?.context.pullRequests,
    ).toEqual(evidence)
  })

  it('accepts a code lookup next to the evidence, checked the same way', () => {
    const lookupItem = {
      key: 'FLOW-5',
      stage: 'In progress',
      code: 'coding',
      pullRequests: [],
    }
    const parsed = parseAiChatRequest({
      ...validRequest,
      context: { ...validRequest.context, codeLookup: [lookupItem] },
    })
    expect(parsed?.context.codeLookup).toEqual([lookupItem])
    expect(
      parseAiChatRequest({
        ...validRequest,
        context: {
          ...validRequest.context,
          codeLookup: [{ ...lookupItem, code: 'hacked' }],
        },
      }),
    ).toBeNull()
  })

  it('keeps an item’s code trail and refuses an unknown code state', () => {
    const item = {
      ...evidence.items[0]!,
      code: 'coding',
      branchLastCommitDaysAgo: 90,
      codeQuietDays: 90,
      boardDisagrees: true,
      pullRequests: [{ ...evidence.items[0]!.pullRequests[0]!, comments: 4 }],
    }
    expect(
      parseAiChatRequest(withPullRequests({ ...evidence, items: [item] }))
        ?.context.pullRequests?.items[0],
    ).toEqual(item)
    expect(
      parseAiChatRequest(
        withPullRequests({ ...evidence, items: [{ ...item, code: 'hacked' }] }),
      ),
    ).toBeNull()
    expect(
      parseAiChatRequest(
        withPullRequests({
          ...evidence,
          items: [{ ...item, boardDisagrees: 'yes' }],
        }),
      ),
    ).toBeNull()
  })

  it('refuses unknown states, people and oversized lists', () => {
    const item = evidence.items[0]!
    const pr = item.pullRequests[0]!
    expect(
      parseAiChatRequest(
        withPullRequests({
          ...evidence,
          items: [{ ...item, pullRequests: [{ ...pr, state: 'hacked' }] }],
        }),
      ),
    ).toBeNull()
    expect(
      parseAiChatRequest(
        withPullRequests({
          ...evidence,
          items: [{ ...item, pullRequests: [{ ...pr, readyDaysAgo: -1 }] }],
        }),
      ),
    ).toBeNull()
    expect(
      parseAiChatRequest(
        withPullRequests({
          ...evidence,
          items: Array.from({ length: 31 }, () => item),
        }),
      ),
    ).toBeNull()
    // Extra fields such as an author are dropped, never passed to the model.
    const parsed = parseAiChatRequest(
      withPullRequests({
        ...evidence,
        items: [{ ...item, pullRequests: [{ ...pr, author: 'someone' }] }],
      }),
    )
    expect(JSON.stringify(parsed?.context.pullRequests)).not.toContain(
      'someone',
    )
  })
})

describe('on-prem AI request validation', () => {
  it('requires an explicit board scope for Trello investigations', () => {
    const jiraScope = {
      connectionId: 'trello-demo',
      projectKey: 'CARD',
      provider: 'trello',
      boardId: '0123456789abcdef01234567',
    }
    expect(
      parseAiChatRequest({ ...validRequest, jiraScope })?.jiraScope,
    ).toEqual(jiraScope)
    for (const invalid of [
      { ...jiraScope, boardId: '../other-board' },
      { ...jiraScope, boardId: undefined },
      { ...jiraScope, projectKey: 'DEMO' },
      { ...jiraScope, provider: undefined },
    ])
      expect(
        parseAiChatRequest({ ...validRequest, jiraScope: invalid }),
      ).toBeNull()
  })
  it('accepts the allowlisted report context', () => {
    expect(parseAiChatRequest(validRequest)).toEqual({
      ...validRequest,
      allowJiraForConversation: false,
    })
  })

  it('allowlists a validated service expectation for AI interpretation', () => {
    const request = {
      ...validRequest,
      context: {
        ...validRequest.context,
        scope: {
          ...validRequest.context.scope,
          serviceExpectation: { days: 7, targetPercent: 85, secret: 'discard' },
        },
      },
    }
    expect(
      parseAiChatRequest(request)?.context.scope.serviceExpectation,
    ).toEqual({ days: 7, targetPercent: 85 })
    request.context.scope.serviceExpectation.days = -1
    expect(parseAiChatRequest(request)).toBeNull()
  })

  it('drops fields outside the allowlisted context', () => {
    const parsed = parseAiChatRequest({
      ...validRequest,
      context: {
        ...validRequest.context,
        rawJiraRows: [{ secret: 'must not pass through' }],
      },
    })

    expect(parsed).not.toBeNull()
    expect(JSON.stringify(parsed)).not.toContain('rawJiraRows')
    expect(JSON.stringify(parsed)).not.toContain('must not pass through')
  })

  it('keeps only validated aggregate period-comparison evidence', () => {
    const periodComparison = {
      current: periodSummary(
        '2026-08-12T00:00:00.000Z',
        '2026-09-11T00:00:00.000Z',
        5,
      ),
      previous: periodSummary(
        '2026-07-13T00:00:00.000Z',
        '2026-08-12T00:00:00.000Z',
        3,
      ),
      rawTickets: ['DEMO-SECRET'],
    }
    const parsed = parseAiChatRequest({
      ...validRequest,
      context: { ...validRequest.context, periodComparison },
    })

    expect(parsed?.context.periodComparison).toEqual({
      current: periodComparison.current,
      previous: periodComparison.previous,
    })
    expect(JSON.stringify(parsed)).not.toContain('rawTickets')
    expect(JSON.stringify(parsed)).not.toContain('DEMO-SECRET')
    expect(
      parseAiChatRequest({
        ...validRequest,
        context: {
          ...validRequest.context,
          periodComparison: {
            ...periodComparison,
            previous: {
              ...periodComparison.previous,
              endExclusive: 'not-a-date',
            },
          },
        },
      }),
    ).toBeNull()
  })

  it('accepts a strictly validated Monte Carlo forecast', () => {
    const forecast = {
      basis: {
        sampleStart: '2026-07-16',
        sampleEndExclusive: '2026-09-10',
        sampledDays: 56,
        completedItems: 31,
      },
      finishCurrentWork: {
        items: 6,
        p50: '2026-09-21',
        p70: '2026-09-24',
        p85: '2026-09-28',
        p95: null,
        beyondYear: true,
        withinTwoWeeksPercent: 40,
      },
      nextTwoWeeks: { atLeastItemsP85: 5, itemsP50: 8 },
      rawExits: ['DEMO-SECRET'],
    }
    const withForecast = (value: unknown) =>
      parseAiChatRequest({
        ...validRequest,
        context: { ...validRequest.context, forecast: value },
      })

    expect(withForecast(forecast)?.context.forecast).toEqual({
      basis: forecast.basis,
      finishCurrentWork: forecast.finishCurrentWork,
      nextTwoWeeks: forecast.nextTwoWeeks,
    })
    expect(JSON.stringify(withForecast(forecast))).not.toContain('DEMO-SECRET')
    expect(
      withForecast({ ...forecast, finishCurrentWork: null })?.context.forecast,
    ).toMatchObject({ finishCurrentWork: null })
    expect(
      withForecast({ unavailable: 'Only 4 items were completed.' })?.context
        .forecast,
    ).toEqual({ unavailable: 'Only 4 items were completed.' })

    const invalid = [
      { unavailable: 'x'.repeat(241) },
      { ...forecast, basis: { ...forecast.basis, sampleStart: '2026-13-01' } },
      {
        ...forecast,
        basis: { ...forecast.basis, sampleEndExclusive: '2026-07-01' },
      },
      { ...forecast, basis: { ...forecast.basis, sampledDays: 1e9 } },
      { ...forecast, basis: { ...forecast.basis, completedItems: 2.5 } },
      { ...forecast, nextTwoWeeks: { atLeastItemsP85: 9, itemsP50: 8 } },
      {
        ...forecast,
        finishCurrentWork: { ...forecast.finishCurrentWork, p70: '2026-09-01' },
      },
      {
        ...forecast,
        finishCurrentWork: { ...forecast.finishCurrentWork, beyondYear: false },
      },
      {
        ...forecast,
        finishCurrentWork: { ...forecast.finishCurrentWork, p50: 'soon' },
      },
      'next week',
    ]
    invalid.forEach((value) => expect(withForecast(value)).toBeNull())
  })

  it('accepts a valid Jira scope and rejects unsafe scope values', () => {
    expect(
      parseAiChatRequest({
        ...validRequest,
        jiraScope: { connectionId: 'tracker-demo', projectKey: 'demo' },
      }),
    ).toMatchObject({
      jiraScope: { connectionId: 'tracker-demo', projectKey: 'DEMO' },
    })
    expect(
      parseAiChatRequest({
        ...validRequest,
        jiraScope: { connectionId: '../tracker', projectKey: 'DEMO' },
      }),
    ).toBeNull()
  })

  it('accepts only allowlisted agent approvals', () => {
    expect(
      parseAiChatRequest({
        ...validRequest,
        agentApproval: {
          allowJira: true,
          plan: {
            skillId: 'flow-diagnosis',
            jiraSelector: 'completed-outliers',
            jiraMode: 'overview',
            jql: 'must be dropped',
          },
        },
      }),
    ).toMatchObject({
      agentApproval: {
        allowJira: true,
        plan: {
          skillId: 'flow-diagnosis',
          jiraSelector: 'completed-outliers',
          jiraMode: 'overview',
        },
      },
    })
    expect(
      parseAiChatRequest({
        ...validRequest,
        agentApproval: {
          allowJira: true,
          plan: {
            skillId: 'write-to-jira',
            jiraSelector: 'all-tickets',
            jiraMode: 'detail',
          },
        },
      }),
    ).toBeNull()
  })

  it('rejects oversized conversations and requests not ending with a user', () => {
    expect(
      parseAiChatRequest({
        ...validRequest,
        messages: Array.from({ length: 41 }, () => ({
          role: 'user',
          content: 'Question',
        })),
      }),
    ).toBeNull()
    expect(
      parseAiChatRequest({
        ...validRequest,
        messages: [{ role: 'assistant', content: 'Answer' }],
      }),
    ).toBeNull()
  })

  it('accepts bounded conversation memory and Jira access only as typed values', () => {
    expect(
      parseAiChatRequest({
        ...validRequest,
        allowJiraForConversation: true,
        conversationSummary: 'User previously asked about delayed work.',
      }),
    ).toMatchObject({
      allowJiraForConversation: true,
      conversationSummary: 'User previously asked about delayed work.',
    })
    expect(
      parseAiChatRequest({
        ...validRequest,
        allowJiraForConversation: 'yes',
      }),
    ).toBeNull()
  })

  it('preserves a substantial assistant reply for a valid follow-up', () => {
    const assistantReply = 'Evidence-backed explanation. '.repeat(320)
    const parsed = parseAiChatRequest({
      ...validRequest,
      messages: [
        { role: 'user', content: 'Explain the current flow.' },
        { role: 'assistant', content: assistantReply },
        {
          role: 'user',
          content: 'What should I do with the lower-priority tickets?',
        },
      ],
    })

    expect(assistantReply.length).toBeGreaterThan(4_000)
    expect(parsed?.messages).toHaveLength(3)
    expect(parsed?.messages[1]?.content).toBe(assistantReply.trim())
  })

  it('keeps role-specific bounds on conversation messages', () => {
    expect(
      parseAiChatRequest({
        ...validRequest,
        messages: [
          {
            role: 'user',
            content: 'U'.repeat(AI_USER_MESSAGE_CHAR_LIMIT + 1),
          },
        ],
      }),
    ).toBeNull()
    expect(
      parseAiChatRequest({
        ...validRequest,
        messages: [
          {
            role: 'assistant',
            content: 'A'.repeat(AI_ASSISTANT_MESSAGE_CHAR_LIMIT + 1),
          },
          { role: 'user', content: 'Follow up' },
        ],
      }),
    ).toBeNull()
  })

  it('accepts where work sits now and rejects a malformed stage list', () => {
    const withStages = (workInProgressByStage: unknown) =>
      parseAiChatRequest({
        ...validRequest,
        context: { ...validRequest.context, workInProgressByStage },
      })
    expect(
      withStages([
        {
          stage: 'Review',
          count: 6,
          items: [{ key: 'DEMO-7', ageDays: 9, daysInStage: 4 }],
        },
      ])?.context.workInProgressByStage,
    ).toEqual([
      {
        stage: 'Review',
        count: 6,
        items: [{ key: 'DEMO-7', ageDays: 9, daysInStage: 4 }],
      },
    ])
    expect(withStages([{ stage: 'Review', count: -1, items: [] }])).toBeNull()
    expect(withStages('Review')).toBeNull()
  })

  it('carries the data-check verdict the person sees, and rejects an unknown one', () => {
    const withChecks = (dataChecks: unknown) =>
      parseAiChatRequest({
        ...validRequest,
        context: { ...validRequest.context, dataChecks },
      })
    const dataChecks = {
      verdict: 'directional',
      summary: 'Directional: based on 12 finished items.',
      findings: ['Many items moved at once: 13 items changed status together.'],
    }
    expect(withChecks(dataChecks)?.context.dataChecks).toEqual(dataChecks)
    expect(withChecks({ ...dataChecks, verdict: 'perfect' })).toBeNull()
  })

  it('passes short team notes and every signal a briefing can show', () => {
    const signal = {
      severity: 'warning',
      title: 'Work piles on one person',
      evidence: 'Dana holds 5 of 8 active items (63%).',
      suggestedTeamPrompt: 'Spread the load.',
    }
    const parsed = parseAiChatRequest({
      ...validRequest,
      context: {
        ...validRequest.context,
        teamNotes: ' We do not run stand-ups. ',
        focusSignals: Array(8).fill(signal),
      },
    })
    expect(parsed?.context.teamNotes).toBe('We do not run stand-ups.')
    expect(parsed?.context.focusSignals).toHaveLength(8)
    expect(
      parseAiChatRequest({
        ...validRequest,
        context: { ...validRequest.context, teamNotes: '  ' },
      })?.context,
    ).not.toHaveProperty('teamNotes')
    expect(
      parseAiChatRequest({
        ...validRequest,
        context: { ...validRequest.context, teamNotes: 'x'.repeat(601) },
      }),
    ).toBeNull()
  })
})

function periodSummary(start: string, endExclusive: string, completed: number) {
  return {
    start,
    endExclusive,
    completedObservations: completed,
    medianCycleTimeDays: 5,
    percentile85CycleTimeDays: 9,
    exitThroughputPerWeek: 1.2,
    delayedWorkInProgress: 2,
    reenteredWorkInProgress: 1,
    historyCoverage: 'complete',
  }
}
