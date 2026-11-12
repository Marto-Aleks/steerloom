import { useEffect, useState } from 'react'
import { workspaceRequest } from '../../lib/workspace/api'

export type ReachResult =
  | 'checking'
  | 'reachable'
  | 'company-network'
  | 'unknown'

/**
 * On the hosted site, checks whether a pasted company-hosted address (Jira
 * Data Center, Azure DevOps Server) can be reached from steerloom.app, before
 * anyone looks for a token. Cloud addresses always can, so they are never
 * checked; nor is anything on a local install, which runs inside the network.
 */
export function useHostedReach(
  target: string | null,
  product: 'jira' | 'azure-devops',
  hosted: boolean,
) {
  const [state, setState] = useState<{
    target: string
    result: ReachResult
  } | null>(null)
  const [override, setOverride] = useState('')
  useEffect(() => {
    if (!hosted || !target) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setState({ target, result: 'checking' })
      workspaceRequest<{ reach?: unknown }>(
        '/api/workspace/reach',
        'POST',
        { link: target, product },
        controller.signal,
      )
        .then(({ reach }) =>
          setState({
            target,
            result:
              reach === 'reachable' || reach === 'company-network'
                ? reach
                : 'unknown',
          }),
        )
        .catch(() => {
          if (!controller.signal.aborted)
            setState({ target, result: 'unknown' })
        })
    }, 400)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [target, product, hosted])
  const checked = hosted && target ? state : null
  // Until this address has an answer, it is being checked.
  const result: ReachResult | null =
    hosted && target
      ? checked?.target === target
        ? checked.result
        : 'checking'
      : null
  return {
    result,
    /**
     * Hold the credential fields back while checking (under a second), and
     * keep them hidden when only the local version can reach the board.
     */
    blocked:
      result === 'checking' ||
      (result === 'company-network' && override !== target),
    connectAnyway: () => setOverride(target ?? ''),
  }
}
