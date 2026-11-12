import type {
  AiJiraEvidenceBundle,
  AiJiraIssueEvidence,
  AiJiraLookup,
} from '../../src/lib/ai/jira-evidence'

export const AI_AGENT_JIRA_TOOL_LIMIT = 3

export function jiraLookupFingerprint(lookup: AiJiraLookup): string {
  return `${lookup.mode}:${[...lookup.keys].sort().join(',')}`
}

export function mergeAiJiraEvidence(
  bundles: AiJiraEvidenceBundle[],
): AiJiraEvidenceBundle | undefined {
  if (!bundles.length) return undefined

  const issues = new Map<string, AiJiraIssueEvidence>()
  const requestedKeys = new Set<string>()
  const unavailableKeys = new Set<string>()
  const omittedBySource = new Map<string, number>()

  bundles.forEach((bundle) => {
    bundle.requestedKeys.forEach((key) => requestedKeys.add(key))
    bundle.unavailableKeys.forEach((key) => unavailableKeys.add(key))
    omittedBySource.set(
      bundle.source,
      Math.max(omittedBySource.get(bundle.source) ?? 0, bundle.omittedCount),
    )
    bundle.issues.forEach((issue) => {
      issues.set(issue.key, { ...issues.get(issue.key), ...issue })
      unavailableKeys.delete(issue.key)
    })
  })

  const sources = new Set(bundles.map(({ source }) => source))
  return {
    mode: bundles.some(({ mode }) => mode === 'detail') ? 'detail' : 'overview',
    source:
      sources.size === 1 ? bundles[0]!.source : 'agent-selected report tickets',
    requestedKeys: [...requestedKeys],
    issues: [...issues.values()],
    unavailableKeys: [...unavailableKeys],
    omittedCount: [...omittedBySource.values()].reduce(
      (total, count) => total + count,
      0,
    ),
  }
}
