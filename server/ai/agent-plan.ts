import type {
  AiAgentPlan,
  AiJiraSelector,
  AiSkillId,
} from '../../src/lib/ai/agent'
import { isAiJiraSelector, isAiSkillId } from '../../src/lib/ai/agent'
import {
  resolveAiJiraLookup,
  type AiJiraLookup,
  type AiJiraLookupContext,
  type AiJiraLookupMessage,
} from '../../src/lib/ai/jira-evidence'

const dependencyPattern =
  /\b(?:dependenc|dependent|blocker|blocked|blocking|linked?|parent|subtask)\w*\b/i
const ownershipPattern =
  /\b(?:assignee|assigned|owner|ownership|responsible|unassigned|who owns|who has)\b/i
const stalenessPattern =
  /\b(?:stale|staleness|quiet|inactive|last update|latest update|not updated|oldest update)\b/i
const qualityPattern =
  /\b(?:accurate|accuracy|trust|reliable|quality|calculated|calculation|cohort|sample|missing history)\b/i
const ticketInvestigationPattern =
  /\b[A-Z][A-Z0-9_]{1,29}-\d+\b|\b(?:comment|changelog|ticket history)\b|\bwhat(?:'s| is) (?:\S+ ){0,3}about\b/i
const jiraInvestigationIntentPattern =
  /\b(?:jira|tickets?|issues?|owners?|assignees?|assigned|blocked?|blockers?|dependencies|dependency|comments?|history|changelog|stale|inactive|updated?|why|cause|investigat\w*|inspect\w*|check\w*|look\s+(?:at|into)|these|those|them|their)\b/i

export function shouldPlanJiraLookup(question: string): boolean {
  return jiraInvestigationIntentPattern.test(question)
}

export function chooseAiSkill(question: string): AiSkillId {
  if (qualityPattern.test(question)) return 'data-check'
  if (
    dependencyPattern.test(question) ||
    ownershipPattern.test(question) ||
    stalenessPattern.test(question) ||
    ticketInvestigationPattern.test(question)
  )
    return 'item-investigation'
  return 'flow-diagnosis'
}

export function fallbackAiAgentPlan(question: string): AiAgentPlan {
  return {
    skillId: chooseAiSkill(question),
    jiraSelector: 'none',
    jiraMode: 'overview',
  }
}

export function parseAiAgentPlan(
  content: string,
  question: string,
): AiAgentPlan {
  const fallback = fallbackAiAgentPlan(question)
  const objectText = jsonObjectText(content)
  if (!objectText) return fallback

  let value: unknown
  try {
    value = JSON.parse(objectText) as unknown
  } catch {
    return fallback
  }
  if (!isRecord(value)) return fallback

  const skillId = isAiSkillId(value.skillId) ? value.skillId : fallback.skillId
  const jiraSelector = isAiJiraSelector(value.jiraSelector)
    ? value.jiraSelector
    : 'none'
  const jiraMode = value.jiraMode === 'detail' ? 'detail' : 'overview'
  const stage =
    typeof value.stage === 'string' && value.stage.trim()
      ? value.stage.trim().slice(0, 160)
      : undefined
  if (jiraSelector === 'stage' && !stage)
    return { skillId, jiraSelector: 'none', jiraMode }
  return { skillId, jiraSelector, jiraMode, ...(stage ? { stage } : {}) }
}

export function resolveAgentPlanLookup(
  context: AiJiraLookupContext,
  messages: AiJiraLookupMessage[],
  projectKey: string,
  plan: AiAgentPlan,
): AiJiraLookup | null {
  if (plan.jiraSelector === 'none') return null
  if (plan.jiraSelector === 'stage' && !plan.stage) return null
  const phrase =
    plan.jiraSelector === 'stage'
      ? `work waiting in ${plan.stage}`
      : selectorPhrase(plan.jiraSelector)
  const evidenceIntent =
    plan.jiraMode === 'detail'
      ? 'comments history dependencies description'
      : 'assignee status update date'
  return resolveAiJiraLookup(
    context,
    [
      ...messages.slice(0, -1),
      { role: 'user', content: `${phrase} ${evidenceIntent}` },
    ],
    projectKey,
  )
}

function selectorPhrase(
  selector: Exclude<AiJiraSelector, 'none' | 'stage'>,
): string {
  if (selector === 'completed-outliers') return 'completed outliers'
  if (selector === 'delayed-wip') return 'delayed WIP'
  return 're-entered tickets'
}

function jsonObjectText(content: string): string {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start || end - start > 2_000) return ''
  return content.slice(start, end + 1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
