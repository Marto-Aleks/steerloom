import { useEffect, useState } from 'react'
import { workspaceRequest } from '../../lib/workspace/api'
import type {
  BranchRecord,
  PullRequestRecord,
} from '../../lib/data-source/github'

const DAY = 86_400_000

/**
 * Pull requests from the workspace's repositories, read once per board load.
 * They stay in memory with the board; nothing is saved. A failure leaves
 * the briefing as it was and says why.
 */
export function usePullRequests({
  repositories,
  windowDays,
  loadedAt,
}: {
  /** Empty when GitHub is not connected or the dashboard names none. */
  repositories: string[]
  windowDays: number | null
  loadedAt: string | undefined
}): {
  pullRequests?: PullRequestRecord[]
  branches?: BranchRecord[]
  error?: string
  loading: boolean
} {
  const [result, setResult] = useState<{
    key: string
    pullRequests?: PullRequestRecord[]
    branches?: BranchRecord[]
    error?: string
  }>()
  const key = repositories.length
    ? `${repositories.join(',')}|${windowDays}|${loadedAt}`
    : ''
  useEffect(() => {
    if (!key || !loadedAt) return
    const controller = new AbortController()
    const end = Date.parse(loadedAt)
    // At least a year: the items that matter most are often old, and their
    // pull requests went quiet long ago. GitHub's 1,000 per repository caps it.
    const since = new Date(
      (Number.isFinite(end) ? end : Date.now()) -
        Math.max(windowDays ?? 365, 365) * DAY,
    ).toISOString()
    workspaceRequest<{
      pullRequests: PullRequestRecord[]
      branches?: BranchRecord[]
    }>(
      '/api/workspace/github/pull-requests',
      'POST',
      { since },
      controller.signal,
    )
      .then(({ pullRequests, branches }) =>
        setResult({ key, pullRequests, branches: branches ?? [] }),
      )
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setResult({
          key,
          error: `Pull requests could not be read: ${
            caught instanceof Error ? caught.message : 'GitHub did not answer.'
          }`,
        })
      })
    return () => controller.abort()
  }, [key, loadedAt, windowDays])
  return result?.key === key
    ? {
        pullRequests: result.pullRequests,
        branches: result.branches,
        error: result.error,
        loading: false,
      }
    : { loading: Boolean(key && loadedAt) }
}
