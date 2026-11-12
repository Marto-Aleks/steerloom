import { SpotIcon } from '../../components/SpotIcon'
import type { ProviderId } from '../../lib/workspace/model'

/**
 * Provider identity on a glass tile. Jira, Trello and Azure DevOps keep their
 * official brand marks; the demo board uses the soft board spot icon.
 */
export function ProviderIcon({
  provider,
  small = false,
}: {
  provider: ProviderId
  small?: boolean
}) {
  const size = small ? 32 : 40
  if (provider === 'demo')
    return (
      <span
        className="provider-tile provider-tile--demo"
        data-size={small ? 'small' : 'regular'}
        aria-hidden="true"
      >
        <SpotIcon name="board" variant="soft" size={small ? 32 : 40} />
      </span>
    )
  return (
    <span
      className="provider-tile"
      data-provider={provider}
      data-size={small ? 'small' : 'regular'}
    >
      <img
        className="provider-tile__mark"
        src={`${import.meta.env.BASE_URL}brands/${provider}.svg`}
        alt={
          provider === 'jira'
            ? 'Jira'
            : provider === 'azure-devops'
              ? 'Azure DevOps'
              : 'Trello'
        }
        width={size}
        height={size}
      />
    </span>
  )
}
