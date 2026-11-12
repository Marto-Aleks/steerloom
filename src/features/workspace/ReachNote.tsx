import { ArrowRight } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import type { ReachResult } from './use-hosted-reach'

export function ReachNote({
  result,
  blocked,
  product,
  localSetup,
  onConnectAnyway,
}: {
  result: ReachResult | null
  blocked: boolean
  /** "Jira", "Azure DevOps Server" */
  product: string
  localSetup: string
  onConnectAnyway: () => void
}) {
  if (!result) return null
  if (result === 'company-network' && blocked)
    return (
      <div className="home-form__reach" role="status">
        <p className="metadata-copy home-form__hint">
          This {product} only opens inside your company network or behind its
          sign-in, so steerloom.app can’t reach it. Steerloom on your computer
          can: it runs where your network already reaches it.
        </p>
        <a
          className="glass-button home-form__local"
          data-variant="secondary"
          href={localSetup}
        >
          Set up Steerloom on my computer
          <UiIcon icon={ArrowRight} size={16} />
        </a>
        <button
          type="button"
          className="home-link home-form__anyway"
          onClick={onConnectAnyway}
        >
          Try connecting from here anyway
        </button>
      </div>
    )
  // Reachable: nothing to say, the usual fields follow.
  if (result === 'reachable') return null
  if (result === 'checking')
    return (
      <p className="metadata-copy" role="status">
        Checking that steerloom.app can reach it…
      </p>
    )
  // The check could not decide, or the user chose to try anyway.
  return (
    <p className="metadata-copy home-form__hint" role="status">
      If this {product} only opens on your company network or VPN, steerloom.app
      can’t reach it. <a href={localSetup}>Use Steerloom on your computer</a>{' '}
      instead.
    </p>
  )
}
