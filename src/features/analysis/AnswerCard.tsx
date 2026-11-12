import { Fragment, useId, useState } from 'react'
import { Check, ChevronDown, CircleHelp, X } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import { StatusBadge } from '../../components/ui'
import {
  confidenceLabel,
  type AnswerCard as Card,
  type AnswerReason,
} from '../../lib/ai/answer-card'
import { RichText } from './AiRichText'
import { ItemKey } from './ItemKey'

const markIcon = { supports: Check, 'rules-out': X, unchecked: CircleHelp }
const markLabel = {
  supports: 'Supports',
  'rules-out': 'Ruled out',
  unchecked: 'Not checked',
}
const letters = 'ABC'

/**
 * A why or what-to-do answer: the verdict and the next step on top, the
 * reasoning one click away. Steerloom has already checked it: the confidence
 * comes from the sources, unread claims say so, weak options are gone.
 */
export function AnswerCard({
  card,
  links,
  titles,
  azureKeys = false,
}: {
  card: Card
  links?: (key: string) => string | undefined
  titles?: (key: string) => string | undefined
  azureKeys?: boolean
}) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const text = (value: string) => (
    <RichText
      text={value}
      links={links}
      titles={titles}
      azureKeys={azureKeys}
    />
  )
  // Several items read as a list, never as one run-on key.
  const keys = (list: string[]) =>
    list.map((key, index) => (
      <Fragment key={key}>
        {index > 0 && ', '}
        <ItemKey
          itemKey={key}
          title={titles?.(key)}
          browseUrl={links?.(key)}
          className="ai-chat__ticket"
        />
      </Fragment>
    ))
  // One item, already named in the verdict: no chip on every reason.
  const only = [...new Set(card.reasons.flatMap((r) => r.keys))]
  const oneItem =
    only.length === 1 && only[0] !== undefined && card.verdict.includes(only[0])
  const reasonKeys = (reason: AnswerReason) =>
    oneItem ? [] : reason.keys.filter((key) => !reason.fact.includes(key))
  const ruledOut = card.reasons.filter((r) => r.kind === 'rules-out').length
  const summary = [
    `${card.reasons.length - ruledOut} ${card.reasons.length - ruledOut === 1 ? 'reason' : 'reasons'}`,
    ruledOut ? `${ruledOut} ruled out` : '',
    card.options?.length
      ? `${card.options.length} ${card.options.length === 1 ? 'option' : 'options'} weighed`
      : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const likely = card.confidence === 'likely'

  return (
    <div className="answer reasoning" data-confidence={card.confidence}>
      <div className="answer__head">
        <p className="answer__claim">{text(card.verdict)}</p>
        <StatusBadge
          tone={likely ? 'warning' : 'neutral'}
          showDot
          title={`${card.basis}.`}
          className="reasoning__confidence"
        >
          {confidenceLabel(card)}
        </StatusBadge>
      </div>

      {card.list && (
        <ol className="reasoning__list">
          {card.list.map((line) => (
            <li key={line.text}>
              {line.keys.some((key) => !line.text.includes(key)) && (
                <span className="reasoning__keys">
                  {keys(line.keys.filter((key) => !line.text.includes(key)))}
                </span>
              )}
              <span>{text(line.text)}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="answer__move">
        <p className="answer__label">Next step</p>
        <p>
          {text(card.next)}
          {card.checkpoint && (
            <span className="answer__change">
              {' '}
              Check: {text(card.checkpoint)}
            </span>
          )}
        </p>
      </div>
      {card.question && (
        <p className="reasoning__question">{text(card.question)}</p>
      )}

      {card.reasons.length > 0 && (
        <button
          type="button"
          className="answer__more reasoning__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide reasoning' : `Show reasoning · ${summary}`}
          <UiIcon icon={ChevronDown} size={14} />
        </button>
      )}

      <div id={bodyId} className="reasoning__body" hidden={!open}>
        {open && (
          <>
            <p className="answer__label">Why</p>
            <ul className="reasoning__reasons">
              {card.reasons.map((reason) => (
                <ReasonLine
                  key={reason.fact}
                  reason={reason}
                  shown={reasonKeys(reason)}
                  keys={keys}
                  text={text}
                />
              ))}
            </ul>
            {card.options && (
              <>
                <p className="answer__label">Options</p>
                <ol className="reasoning__options">
                  {card.options.map((option, index) => (
                    <li
                      key={option.what}
                      data-chosen={option.recommended ? 'true' : undefined}
                    >
                      <span className="reasoning__letter">
                        {letters[index]}
                      </span>
                      <span>
                        <strong>{text(option.what)}</strong>
                        {option.tradeOff && (
                          <span className="answer__wait">
                            {' '}
                            {text(option.tradeOff)}
                          </span>
                        )}
                        <span className="reasoning__check">
                          Check: {text(option.checkpoint)}
                          {option.recommended && (
                            <span className="sr-only"> (recommended)</span>
                          )}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
                {card.why && (
                  <p className="reasoning__chosen">
                    <strong>
                      Recommended:{' '}
                      {card.options
                        .flatMap((option, index) =>
                          option.recommended ? [letters[index]] : [],
                        )
                        .join(' and ')}
                    </strong>
                    , {text(card.why)}
                  </p>
                )}
              </>
            )}
            {card.removed && (
              <p className="answer__dropped">
                Steerloom removed {card.removed.join('; ')}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ReasonLine({
  reason,
  shown,
  keys,
  text,
}: {
  reason: AnswerReason
  /** The item chips to show: none when the verdict already names the item. */
  shown: string[]
  keys: (list: string[]) => React.ReactNode
  text: (value: string) => React.ReactNode
}) {
  return (
    <li data-kind={reason.kind}>
      <UiIcon
        icon={markIcon[reason.kind]}
        size={14}
        className="reasoning__mark"
        aria-label={markLabel[reason.kind]}
      />
      <span className="reasoning__fact">
        {keys(shown)} {text(reason.fact)}
        {reason.kind === 'unchecked' && (
          <span className="reasoning__flag">
            {' '}
            Not checked: Steerloom did not read{' '}
            {reason.keys.join(', ') || 'this'} for it.
          </span>
        )}
      </span>
      <span className="reasoning__source">{reason.source}</span>
    </li>
  )
}
