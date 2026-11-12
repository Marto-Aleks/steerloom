import type { ReactNode } from 'react'
import { draftCard } from '../../lib/ai/answer-card'
import { RichText } from './AiRichText'

/** Closes a **bold** that is still being written, so no stray "**" shows. */
const closed = (text: string) =>
  (text.match(/\*\*/g)?.length ?? 0) % 2 ? `${text}**` : text

/**
 * The answer while the AI writes it. Plain answers appear as they are
 * typed. A card shows its verdict and next step as soon as they exist; the
 * reasons and options wait until Steerloom has checked them.
 */
export function StreamingAnswer({
  text,
  plain,
  links,
  titles,
  azureKeys = false,
}: {
  text: string
  /** How the chat draws a plain answer, given its text so far. */
  plain: (text: string) => ReactNode
  links?: (key: string) => string | undefined
  titles?: (key: string) => string | undefined
  azureKeys?: boolean
}) {
  const trimmed = text.trimStart()
  const card = trimmed.startsWith('{') || trimmed.startsWith('```')
  if (!card)
    return (
      <article
        className="ai-chat__message ai-chat__message--streaming"
        data-role="assistant"
        aria-busy="true"
      >
        <p className="ai-chat__message-role">Steerloom AI</p>
        {plain(closed(trimmed))}
      </article>
    )
  const draft = draftCard(trimmed)
  if (!draft.verdict) return null
  const rich = (value: string) => (
    <RichText
      text={closed(value)}
      links={links}
      titles={titles}
      azureKeys={azureKeys}
    />
  )
  return (
    <article
      className="ai-chat__message ai-chat__message--streaming"
      data-role="assistant"
      aria-busy="true"
    >
      <p className="ai-chat__message-role">Steerloom AI</p>
      <div className="answer reasoning">
        <div className="answer__head">
          <p className="answer__claim">{rich(draft.verdict)}</p>
        </div>
        {draft.next && (
          <div className="answer__move">
            <p className="answer__label">Next step</p>
            <p>{rich(draft.next)}</p>
          </div>
        )}
        <p className="answer__dropped">
          Writing the reasons and options; Steerloom checks them before they
          show.
        </p>
      </div>
    </article>
  )
}
