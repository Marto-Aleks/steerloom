import { describe, expect, it } from 'vitest'
import type { AiJiraLookupContext } from '../../src/lib/ai/jira-evidence'
import {
  chooseAiSkill,
  parseAiAgentPlan,
  resolveAgentPlanLookup,
  shouldPlanJiraLookup,
} from './agent-plan'

const context: AiJiraLookupContext = {
  ticketGroupTotals: {
    completedOutliers: 2,
    delayedWorkInProgress: 1,
    reenteredWorkInProgress: 1,
  },
  completedOutliers: [{ key: 'DEMO-1' }, { key: 'DEMO-2' }],
  delayedWorkInProgress: [{ key: 'DEMO-3' }],
  reenteredWorkInProgress: [{ key: 'DEMO-4' }],
  workInProgressByStage: [
    {
      stage: 'In Progress',
      count: 2,
      items: [{ key: 'DEMO-5' }, { key: 'DEMO-3' }],
    },
    {
      stage: 'Code Review',
      count: 6,
      items: [{ key: 'DEMO-7' }, { key: 'DEMO-8' }],
    },
  ],
}

describe('AI agent planning', () => {
  it('routes common analysis questions to focused skills', () => {
    expect(chooseAiSkill('Who owns these tickets?')).toBe('item-investigation')
    expect(chooseAiSkill('Is DEMO-1 blocked by anything?')).toBe(
      'item-investigation',
    )
    expect(chooseAiSkill('What has gone quiet?')).toBe('item-investigation')
    expect(chooseAiSkill('Can I trust this P85 calculation?')).toBe(
      'data-check',
    )
    // A broad coaching question is about flow, even with "about" far along.
    expect(
      chooseAiSkill(
        'What is really slowing this team down? Tell me what you would do about it.',
      ),
    ).toBe('flow-diagnosis')
    expect(chooseAiSkill('What is DEMO-4 about?')).toBe('item-investigation')
    expect(chooseAiSkill('Why is delivery slower this month?')).toBe(
      'flow-diagnosis',
    )
  })

  it('skips the Jira planner for report-only metric questions', () => {
    expect(
      shouldPlanJiraLookup(
        'What can you tell me about throughput and how can we improve it?',
      ),
    ).toBe(false)
    expect(
      shouldPlanJiraLookup('Inspect the unusually slow finished work.'),
    ).toBe(true)
    expect(shouldPlanJiraLookup('Why are those tickets blocked?')).toBe(true)
  })

  it('accepts only allowlisted planner fields and falls back safely', () => {
    expect(
      parseAiAgentPlan(
        '```json\n{"skillId":"item-investigation","jiraSelector":"delayed-wip","jiraMode":"detail","jql":"all issues"}\n```',
        'Find stale work',
      ),
    ).toEqual({
      skillId: 'item-investigation',
      jiraSelector: 'delayed-wip',
      jiraMode: 'detail',
    })
    // A stage selector without a stage reads nothing.
    expect(
      parseAiAgentPlan(
        '{"skillId":"flow-diagnosis","jiraSelector":"stage","jiraMode":"overview"}',
        'Why is review slow?',
      ).jiraSelector,
    ).toBe('none')
    expect(parseAiAgentPlan('not json', 'Who owns the work?')).toEqual({
      skillId: 'item-investigation',
      jiraSelector: 'none',
      jiraMode: 'overview',
    })
  })

  it('maps a semantic plan to exact report keys rather than model-provided JQL', () => {
    expect(
      resolveAgentPlanLookup(
        context,
        [
          {
            role: 'user',
            content: 'Look at the unusually slow finished work.',
          },
        ],
        'DEMO',
        {
          skillId: 'flow-diagnosis',
          jiraSelector: 'completed-outliers',
          jiraMode: 'overview',
        },
      ),
    ).toMatchObject({
      source: 'completed outliers above P85',
      keys: ['DEMO-1', 'DEMO-2'],
    })
  })

  it('reads the current work in a stage, named by the planner or in the question', () => {
    expect(
      resolveAgentPlanLookup(
        context,
        [{ role: 'user', content: 'Why is work slowing down?' }],
        'DEMO',
        {
          skillId: 'flow-diagnosis',
          jiraSelector: 'stage',
          jiraMode: 'detail',
          stage: 'Code Review',
        },
      ),
    ).toMatchObject({
      source: 'current work in a stage',
      mode: 'detail',
      keys: ['DEMO-7', 'DEMO-8'],
      availableCount: 6,
    })
  })
})
