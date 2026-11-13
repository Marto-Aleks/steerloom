import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { AskAiTag } from '../../components/AskAiTag'
import { UiIcon } from '../../components/UiIcon'
import { externalHttpUrl } from './format'

/** One item in a group: its key, where to open it, and the full sentence. */
export interface CodeReviewItem {
  key: string
  detail: string
  browseUrl?: string
  /** Colours this item's chip by its own state instead of its group's. */
  tone?: 'alive' | 'quiet' | 'waiting'
  /** The board and the code disagree about this item: the chip is ringed. */
  mismatch?: boolean
}

/** What GitHub says about the items sitting in a review stage today. */
export interface CodeReviewGroup {
  id:
    | 'moving'
    | 'unreviewed'
    | 'quiet'
    | 'done'
    | 'none'
    | 'nocode'
    | 'coding'
    | 'review'
    | 'approved'
    | 'merged'
  label: string
  items: CodeReviewItem[]
}

/** The question the assistant gets for one group, ready to send. */
function groupQuestion(group: CodeReviewGroup, stage: string): string {
  const keys = group.items.map((item) => item.key).join(', ')
  return group.id === 'none' || group.id === 'nocode'
    ? `${keys} sit in ${stage} without a linked pull request. What could they be waiting for, and what should I ask the team?`
    : `${keys}: their pull requests are ${group.label}. Why, and what should happen next?`
}

/**
 * Code review, from GitHub: what the review stage is holding today, grouped
 * by where each item's pull request stands, and one sentence on how long
 * review itself takes once there is a pull request. A group opens to name
 * its items. Problems are warm, healthy work is blue, and items GitHub
 * cannot see stay grey: unknown, not bad.
 */
export function CodeReviewPanel({
  stage,
  groups,
  readyToMergedDays,
  finishedLinked,
  onAsk,
  title = 'Code review',
  headline: headlineText,
  sub,
  legend,
  hint,
}: {
  stage: string
  title?: string
  /** Overrides the computed headline. */
  headline?: string
  /** Overrides the line under the headline. */
  sub?: string
  /** A key for chip colours, shown under the groups. */
  legend?: Array<{ tone: 'alive' | 'quiet' | 'waiting'; label: string }>
  groups: CodeReviewGroup[]
  /** A typical finished item's time from ready for review to merged. */
  readyToMergedDays?: number
  finishedLinked?: number
  onAsk?: (question: string) => void
  /** A closing line, such as where a demo's code view can be had for real. */
  hint?: ReactNode
}) {
  const [openId, setOpenId] = useState<CodeReviewGroup['id'] | 'mismatch'>()
  const listId = useId()
  const shown = groups.filter((group) => group.items.length)
  const total = shown.reduce((sum, group) => sum + group.items.length, 0)
  if (!total) return null
  const count = (id: CodeReviewGroup['id']) =>
    groups.find((group) => group.id === id)?.items.length ?? 0
  const none = count('none')
  const stuck = count('unreviewed') + count('quiet')
  const headline =
    headlineText ??
    (none / total > 0.5
      ? `Most of ${stage} has no pull request`
      : stuck
        ? `${stuck} of ${total - none} pull requests ${stuck === 1 ? 'is' : 'are'} waiting`
        : 'Review is moving')
  // Where the board and the code disagree: one list behind one link, not a
  // mark on every chip.
  const disagree = shown.flatMap((group) =>
    group.items.filter((item) => item.mismatch),
  )
  const open =
    openId === 'mismatch'
      ? {
          id: 'mismatch' as const,
          label: 'board and code disagree',
          items: disagree,
        }
      : shown.find((group) => group.id === openId)
  // Chips get thinner as the biggest group grows, so it stays on a line or
  // two: about 30 chips fit one line at any density but the last.
  const largest = Math.max(...shown.map((group) => group.items.length))
  const [chipWidth, chipGap, chipHeight] =
    largest <= 12
      ? [10, 4, 24]
      : largest <= 24
        ? [7, 3, 22]
        : largest <= 48
          ? [5, 2, 20]
          : [3, 1, 18]
  return (
    <section
      className="work-stages code-review"
      aria-labelledby="code-review-title"
      style={
        {
          '--chip-width': `${chipWidth}px`,
          '--chip-gap': `${chipGap}px`,
          '--chip-height': `${chipHeight}px`,
        } as CSSProperties
      }
    >
      <div className="work-stages__header">
        <h2 id="code-review-title" className="work-stages__title">
          {title}
        </h2>
        <span className="work-stages__total">from GitHub</span>
      </div>
      <p className="code-review__headline">{headline}</p>
      <p className="code-review__sub">
        {sub ??
          `${total} ${total === 1 ? 'item' : 'items'} in ${stage} today. Choose a group to see which.`}
        {disagree.length > 0 && (
          <>
            {' '}
            <button
              type="button"
              className="briefing-link code-review__disagree"
              aria-expanded={openId === 'mismatch'}
              aria-controls={listId}
              onClick={() =>
                setOpenId(openId === 'mismatch' ? undefined : 'mismatch')
              }
            >
              {openId === 'mismatch'
                ? 'Hide them'
                : `Show the ${disagree.length === 1 ? 'one' : disagree.length}`}{' '}
              <span aria-hidden="true">→</span>
            </button>
          </>
        )}
      </p>
      {/* Groups, not steps: one chip per item, a gap between groups. */}
      <ul className="code-review__groups">
        {shown.map((group, groupIndex) => (
          <li key={group.id} data-group={group.id}>
            <button
              type="button"
              className="code-review__group"
              aria-expanded={openId === group.id}
              aria-controls={listId}
              data-open={openId === group.id ? 'true' : undefined}
              onClick={() =>
                setOpenId(openId === group.id ? undefined : group.id)
              }
            >
              <span className="code-review__chips" aria-hidden="true">
                {group.items.map((item, index) => (
                  <span
                    key={item.key}
                    data-tone={item.tone}
                    className="code-review__chip sl-grow-y"
                    style={{
                      animationDelay: `${120 + groupIndex * 80 + index * 20}ms`,
                    }}
                  />
                ))}
              </span>
              <span className="code-review__label">
                <strong>{group.items.length}</strong> {group.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {legend && (
        <ul className="code-review__key" aria-label="Key">
          {legend.map((entry) => (
            <li key={entry.tone}>
              <span
                className="code-review__chip"
                data-tone={entry.tone}
                aria-hidden="true"
              />
              {entry.label}
            </li>
          ))}
        </ul>
      )}
      <div id={listId} className="code-review__open" hidden={!open}>
        {open && (
          <>
            <ul className="code-review__items" data-group={open.id}>
              {open.items.map((item) => (
                <li key={item.key}>
                  <span
                    className="code-review__chip"
                    data-tone={item.tone}
                    aria-hidden="true"
                  />
                  {externalHttpUrl(item.browseUrl) ? (
                    <a
                      href={externalHttpUrl(item.browseUrl) ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.key}
                      <UiIcon icon={ExternalLink} size={12} />
                    </a>
                  ) : (
                    <strong>{item.key}</strong>
                  )}
                  <span>{item.detail}</span>
                </li>
              ))}
            </ul>
            {onAsk && (
              <button
                type="button"
                className="briefing-link code-review__ask"
                onClick={() =>
                  onAsk(
                    open.id === 'mismatch'
                      ? `${open.items.map((item) => item.key).join(', ')}: the board and the code disagree about where these items are. What does each mean, and what should happen next?`
                      : groupQuestion(open, stage),
                  )
                }
              >
                <AskAiTag /> about{' '}
                {open.items.length === 1 ? 'it' : `these ${open.items.length}`}{' '}
                <span aria-hidden="true">→</span>
              </button>
            )}
          </>
        )}
      </div>
      {readyToMergedDays !== undefined && finishedLinked ? (
        <p className="code-review__note">
          When there is a pull request, review is{' '}
          {readyToMergedDays < 2 ? 'quick' : 'part of the wait'}: ready to
          merged in <strong>{readyToMergedDays} days</strong>, typical of{' '}
          {finishedLinked} finished items.
        </p>
      ) : null}
      {hint && <p className="code-review__hint">{hint}</p>}
    </section>
  )
}
