interface IssueIdentity {
  id: string
  key: string
}

export function uniqueIssuesByIdentity<T extends IssueIdentity>(
  issues: T[],
): T[] {
  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()

  return issues.filter((issue) => {
    const id = issue.id.trim()
    const key = normaliseIssueKey(issue.key)
    const duplicate = seenIds.has(id) || seenKeys.has(key)
    seenIds.add(id)
    seenKeys.add(key)
    return !duplicate
  })
}

export function duplicateIssueIdentityCount(issues: IssueIdentity[]): number {
  return issues.length - uniqueIssuesByIdentity(issues).length
}

function normaliseIssueKey(value: string): string {
  return value.trim().toUpperCase()
}
