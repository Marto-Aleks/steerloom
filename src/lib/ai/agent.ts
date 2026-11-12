import type { AiJiraLookup, AiJiraLookupMode } from './jira-evidence'

export const AI_SKILL_IDS = [
  'flow-diagnosis',
  'item-investigation',
  'data-check',
] as const

export type AiSkillId = (typeof AI_SKILL_IDS)[number]

export type AiJiraSelector =
  | 'none'
  | 'completed-outliers'
  | 'delayed-wip'
  | 'reentered'
  | 'stage'

export interface AiAgentPlan {
  skillId: AiSkillId
  jiraSelector: AiJiraSelector
  jiraMode: AiJiraLookupMode
  /** With jiraSelector "stage": the stage (board column) whose current work to read */
  stage?: string
}

export interface AiAgentApproval {
  plan: AiAgentPlan
  allowJira: boolean
}

export interface AiAgentSkillTrace {
  id: AiSkillId
  name: string
}

/**
 * A question for the person before the board is read. The planner (for
 * gateways without tools) proposes a plan and a lookup; the agent lists the
 * reads it wants to make.
 */
export interface AiAgentConfirmation {
  skill: AiAgentSkillTrace
  plan?: AiAgentPlan
  lookup?: AiJiraLookup
  /** The agent's first reads, in words. */
  requests?: string[]
  /** "Jira", "Trello" or "Azure DevOps". */
  board?: string
}

export function isAiSkillId(value: unknown): value is AiSkillId {
  return typeof value === 'string' && AI_SKILL_IDS.includes(value as AiSkillId)
}

export function isAiJiraSelector(value: unknown): value is AiJiraSelector {
  return [
    'none',
    'completed-outliers',
    'delayed-wip',
    'reentered',
    'stage',
  ].includes(String(value))
}
