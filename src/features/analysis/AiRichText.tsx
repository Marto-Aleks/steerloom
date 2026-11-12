import type { ReactNode } from 'react'
import { ItemKey } from './ItemKey'

const ticketKeyPattern = /\b[A-Z][A-Z0-9_]{1,29}-\d{1,7}\b/g
const ticketOrAzurePattern = /\b[A-Z][A-Z0-9_]{1,29}-\d{1,7}\b|#\d{1,9}\b/g

/** **Bold** in an answer, with item keys still linked inside it. */
export function RichText(props: {
  text: string
  links?: (key: string) => string | undefined
  titles?: (key: string) => string | undefined
  azureKeys?: boolean
}) {
  const parts = props.text.split(/\*\*(.+?)\*\*/g)
  if (parts.length === 1) return <TicketText {...props} />
  return (
    <>
      {parts.map((part, index) =>
        index % 2 ? (
          <strong key={index}>
            <TicketText {...props} text={part} />
          </strong>
        ) : (
          part && (
            <TicketText
              key={index}
              {...props}
              text={part.replace(/\*\*/g, '')}
            />
          )
        ),
      )}
    </>
  )
}

/**
 * Item keys in an answer, the same as everywhere else in the app (ItemKey):
 * a link to the item when there is one, with its title on hover.
 */
function TicketText({
  text,
  links,
  titles,
  azureKeys,
}: {
  text: string
  links?: (key: string) => string | undefined
  titles?: (key: string) => string | undefined
  azureKeys?: boolean
}) {
  const parts: ReactNode[] = []
  let last = 0
  const pattern = azureKeys ? ticketOrAzurePattern : ticketKeyPattern
  for (const match of text.matchAll(pattern)) {
    const key = match[0]
    const start = match.index
    const href = links?.(key)
    const title = titles?.(key)
    // "#2" in prose is only a key when the board knows it.
    if (key.startsWith('#') && !href && !title) continue
    if (start > last) parts.push(text.slice(last, start))
    parts.push(
      <ItemKey
        key={`${start}-${key}`}
        itemKey={key}
        title={title}
        browseUrl={href}
        className="ai-chat__ticket"
      />,
    )
    last = start + key.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
