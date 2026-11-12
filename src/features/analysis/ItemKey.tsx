import type { ReactNode } from 'react'
import { Tooltip } from '../../components/ui/Tooltip'
import { externalHttpUrl } from './format'

/**
 * An item's key as it appears in lists: a link to the item in its source
 * when there is one, with the title on hover or keyboard focus, so a row of
 * keys is never just numbers. Used wherever a key is shown, so every list
 * behaves the same.
 */
export function ItemKey({
  itemKey,
  title,
  browseUrl,
  className = '',
  children,
}: {
  itemKey: string
  title?: string
  browseUrl?: string
  className?: string
  /** Shown after the key inside the same link, such as a value or an icon. */
  children?: ReactNode
}) {
  const href = externalHttpUrl(browseUrl)
  const label = title ? `${itemKey}: ${title}` : itemKey
  const key = href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`item-key ${className}`.trim()}
      aria-label={`${label} (opens in a new tab)`}
    >
      {itemKey}
      {children}
    </a>
  ) : (
    <span className={`item-key ${className}`.trim()} tabIndex={title ? 0 : -1}>
      {itemKey}
      {children}
    </span>
  )
  return title ? (
    <Tooltip content={title} placement="top">
      {key}
    </Tooltip>
  ) : (
    key
  )
}
