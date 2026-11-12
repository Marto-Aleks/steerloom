import { useState } from 'react'
import {
  Check,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Layers,
  X,
} from 'lucide-react'
import { Wordmark } from '../components/Wordmark'
import { UiIcon } from '../components/UiIcon'
import { StatusBadge } from '../components/ui'
import { AgentActivity } from '../features/analysis/AgentActivity'
import './review.css'

/*
 * Development-only mock: answers that steer a decision. The verdict and the
 * next step stay short; the reasoning (what supports it, what was ruled out,
 * the options weighed) opens on demand. Steerloom checks the answer before it
 * is drawn: sources, confidence, options. Fictional board and people.
 */

type Source = 'Jira' | 'GitHub' | 'Board'

interface Reason {
  fact: string
  source: Source
  keys: string[]
  /** supports the verdict, rules an explanation out, or was never read. */
  kind: 'supports' | 'rules-out' | 'unchecked'
}

interface Option {
  what: string
  tradeOff: string
  checkpoint: string
}

interface Reasoned {
  question: string
  verdict: string
  /** Set by Steerloom from the sources, not by the model. */
  confidence: 'likely' | 'possible'
  basis: string
  /** Lines shown under the verdict, for list answers (stand-up). */
  list?: Array<{ keys: string[]; text: string }>
  reasons: Reason[]
  options?: Option[]
  /** Which option, and why that one. */
  chosen?: { option: string; why: string }
  next: string
  checkpoint: string
  removed?: string
}

const why101: Reasoned = {
  question: 'Why is EVAL-101 late?',
  verdict: 'Rework that went quiet, not a slow review.',
  confidence: 'likely',
  basis: 'Jira and GitHub agree',
  reasons: [
    {
      kind: 'supports',
      source: 'GitHub',
      keys: [],
      fact: 'Changes were requested on acme/web#301; nothing has happened since, 16 days.',
    },
    {
      kind: 'supports',
      source: 'Jira',
      keys: [],
      fact: 'Reopened from Done 30 days ago: “the retry fires twice on a timeout”.',
    },
    {
      kind: 'rules-out',
      source: 'GitHub',
      keys: [],
      fact: 'Not waiting for reviewers: the first look came within hours.',
    },
    {
      kind: 'rules-out',
      source: 'Jira',
      keys: [],
      fact: 'Not blocked: no blocking links, no comment about waiting on anyone.',
    },
  ],
  options: [
    {
      what: 'Ask Ana Ruiz whether the requested changes still apply.',
      tradeOff: 'Cheap; enough if the fix is small.',
      checkpoint: '#301 has new commits by the next refresh.',
    },
    {
      what: 'Split the timeout fix into its own item; finish EVAL-101 without it.',
      tradeOff: 'The board shows the real state; one more item to track.',
      checkpoint: 'EVAL-101 merged within a week.',
    },
    {
      what: 'Close the pull request and descope the retry.',
      tradeOff: 'Only if the retry is no longer needed.',
      checkpoint: 'EVAL-101 leaves the board.',
    },
  ],
  chosen: {
    option: 'A',
    why: 'the reviewer already said what to change, so this is likely a small fix.',
  },
  next: 'Ask Ana Ruiz today whether the requested changes on #301 still apply.',
  checkpoint:
    '#301 has new commits, or a split is agreed, by the next refresh.',
}

const starting: Reasoned = {
  question:
    'We started 31 items and finished 20 in two weeks. What should we do?',
  verdict:
    'Review is the queue: new work keeps starting while three pull requests wait.',
  confidence: 'likely',
  basis: 'The board and GitHub agree',
  reasons: [
    {
      kind: 'supports',
      source: 'Board',
      keys: [],
      fact: 'Code Review holds 5 of 10 active items; three have waited 7 to 12 days.',
    },
    {
      kind: 'supports',
      source: 'GitHub',
      keys: ['EVAL-103', 'EVAL-108', 'EVAL-104'],
      fact: 'No first look for 9 and 7 days; one approved 6 days ago, not merged.',
    },
    {
      kind: 'supports',
      source: 'Jira',
      keys: ['EVAL-107'],
      fact: 'Scope was added twice since it started: weekend slots, bank holidays.',
    },
    {
      kind: 'rules-out',
      source: 'GitHub',
      keys: [],
      fact: 'Reviewers are not slow in general: finished items got a first look within a day.',
    },
    {
      kind: 'unchecked',
      source: 'Jira',
      keys: ['EVAL-140'],
      fact: 'An incident may have pulled people off review.',
    },
  ],
  options: [
    {
      what: 'Limit Code Review to 4 items: when it is full, review before starting.',
      tradeOff: 'Fewer starts for a week; the queue clears.',
      checkpoint:
        'Code Review at 4 or fewer, #310 and #312 reviewed by Friday.',
    },
    {
      what: 'Split EVAL-107: finish the day picker and cut-off, move the additions to new items.',
      tradeOff: 'Two new items; one finishes now.',
      checkpoint: 'EVAL-107 done within a week.',
    },
  ],
  chosen: {
    option: 'A and B',
    why: 'two separate causes: the review queue and one item that keeps growing.',
  },
  next: 'At today’s stand-up, agree a limit of 4 in Code Review, and split EVAL-107 with the product owner.',
  checkpoint:
    'Over the next two weeks, finished keeps up with started and Code Review stays at 4 or fewer.',
  removed:
    'Removed 1 option, “Improve team communication”: it named no item and no checkpoint.',
}

const standup: Reasoned = {
  question: 'What should we raise at stand-up today?',
  verdict: 'Three things, each with one question.',
  confidence: 'likely',
  basis: 'Read from Jira and GitHub just now',
  list: [
    {
      keys: ['EVAL-106'],
      text: 'Merged 5 days ago, still In Progress. Can Chen Li move it to Done?',
    },
    {
      keys: ['EVAL-102'],
      text: 'Blocked by Logistics (EVAL-150) for 20 days. Who escalates, and by when?',
    },
    {
      keys: ['EVAL-103', 'EVAL-108'],
      text: 'Two pull requests with no first look. Who reviews them today?',
    },
  ],
  reasons: [
    {
      kind: 'supports',
      source: 'GitHub',
      keys: ['EVAL-106'],
      fact: 'Merged: the cheapest win on the board, one click.',
    },
    {
      kind: 'supports',
      source: 'Jira',
      keys: ['EVAL-102'],
      fact: 'Two comments asking Logistics for a date; no answer.',
    },
    {
      kind: 'rules-out',
      source: 'Jira',
      keys: ['EVAL-107'],
      fact: 'Left out: needs a scope decision with the product owner, not stand-up.',
    },
    {
      kind: 'rules-out',
      source: 'Jira',
      keys: ['EVAL-109'],
      fact: 'Left out: nothing on the board says why it waits; ask its owner directly.',
    },
  ],
  next: 'Raise the three in this order: the quick win first, the blocker second, reviews last.',
  checkpoint:
    'EVAL-106 in Done today; EVAL-102 has an escalation date; #310 and #312 reviewed by tomorrow.',
}

const sourceIcon = { supports: Check, 'rules-out': X, unchecked: CircleHelp }
const kindLabel = {
  supports: 'Supports',
  'rules-out': 'Ruled out',
  unchecked: 'Not checked',
}

export function ReasoningPreview() {
  return (
    <main className="review-index" id="main-content">
      <header className="review-index__head">
        <Wordmark />
        <h1>Answers that steer a decision</h1>
        <p>
          Fictional board. The verdict and the next step stay short. The
          reasoning, what supports it, what was ruled out and which options were
          weighed, opens on demand. Steerloom checks every answer before it is
          drawn.
        </p>
      </header>
      <div className="review-signals report">
        <h2>1. One item: why is it late?</h2>
        <p className="review-signals__note">
          Closed, it reads in five seconds. Open, a lead can check the logic and
          disagree with a line.
        </p>
        <div className="cards-single reasoning-single">
          <Chat answer={why101} open />
        </div>

        <h2>2. A pattern: starting more than finishing</h2>
        <p className="review-signals__note">
          Two separate causes, two options chosen. One reason was never read on
          the board, so Steerloom shows it as “not checked”, and an option with
          no item or checkpoint was removed.
        </p>
        <div className="cards-single reasoning-single">
          <Chat answer={starting} />
        </div>

        <h2>3. What to raise at stand-up</h2>
        <p className="review-signals__note">
          A list answer: the reasoning says why these three, and what was left
          out and why.
        </p>
        <div className="cards-single reasoning-single">
          <Chat answer={standup} />
        </div>

        <h2>While it works</h2>
        <p className="review-signals__note">
          A running log, like a terminal: one short line per read, then what it
          is doing now.
        </p>
        <div className="cards-single reasoning-single">
          <div className="cards-chat">
            <AgentActivity
              event={{
                type: 'progress',
                step: 'plan',
                label: 'Thinking',
                detail: '1 item · 1 code trail',
              }}
              history={[
                {
                  type: 'progress',
                  step: 'note',
                  label: 'I will read EVAL-101 first, then its code trail.',
                },
                {
                  type: 'progress',
                  step: 'jira',
                  label:
                    'Read EVAL-101 in detail: description, comments, history and links',
                  detail: 'Read-only · Jira',
                },
                {
                  type: 'progress',
                  step: 'jira',
                  label:
                    'Read the code trail of EVAL-101: branch, pull requests and review timing',
                  detail: 'Read-only · GitHub, already loaded',
                },
              ]}
            />
          </div>
        </div>

        <h2>4. What Steerloom checks before you see it</h2>
        <dl className="cards-schema">
          <div>
            <dt>Every reason has a source</dt>
            <dd>
              A line about an item the AI did not read shows as “not checked”.
            </dd>
          </div>
          <div>
            <dt>Confidence is Steerloom’s</dt>
            <dd>
              “Likely” only when two sources agree; otherwise “possible”,
              whatever the AI claimed.
            </dd>
          </div>
          <div>
            <dt>Numbers match the data</dt>
            <dd>A day count or date not in what was read is flagged.</dd>
          </div>
          <div>
            <dt>Options are concrete</dt>
            <dd>
              Each names an item and a checkpoint, or it is removed. At most
              three.
            </dd>
          </div>
          <div>
            <dt>Tested before release</dt>
            <dd>
              12 questions on a fictional board with known answers run before
              every change to the AI.
            </dd>
          </div>
        </dl>
      </div>
    </main>
  )
}

function Chat({ answer, open }: { answer: Reasoned; open?: boolean }) {
  return (
    <div className="cards-chat">
      <article className="ai-chat__message" data-role="user">
        <p className="ai-chat__message-role">You</p>
        <p className="ai-chat__message-content">{answer.question}</p>
      </article>
      <ReasonedCard answer={answer} startOpen={open} />
    </div>
  )
}

function ItemKey({ id }: { id: string }) {
  return (
    <a className="answer__key" href="#" onClick={(e) => e.preventDefault()}>
      {id}
      <UiIcon icon={ExternalLink} size={12} />
    </a>
  )
}

function ReasonedCard({
  answer,
  startOpen = false,
}: {
  answer: Reasoned
  startOpen?: boolean
}) {
  const [open, setOpen] = useState(startOpen)
  const [deeper, setDeeper] = useState(false)
  const ruledOut = answer.reasons.filter((r) => r.kind === 'rules-out').length
  const summary = [
    `${answer.reasons.length - ruledOut} reasons`,
    ruledOut ? `${ruledOut} ruled out` : '',
    answer.options ? `${answer.options.length} options weighed` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const letters = 'ABC'
  return (
    <article className="answer reasoning" data-confidence={answer.confidence}>
      <div className="answer__head">
        <p className="answer__claim">{answer.verdict}</p>
        <StatusBadge
          tone={answer.confidence === 'likely' ? 'warning' : 'neutral'}
          showDot
        >
          {answer.confidence === 'likely' ? 'Likely' : 'Possible'}
        </StatusBadge>
      </div>
      <p className="reasoning__basis">{answer.basis}.</p>

      {answer.list && (
        <ol className="reasoning__list">
          {answer.list.map((line) => (
            <li key={line.text}>
              <span className="reasoning__keys">
                {line.keys.map((key) => (
                  <ItemKey key={key} id={key} />
                ))}
              </span>
              <span>{line.text}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="answer__move">
        <p className="answer__label">Next step</p>
        <p>
          {answer.next}{' '}
          <span className="answer__change">Check: {answer.checkpoint}</span>
        </p>
      </div>

      <button
        type="button"
        className="answer__more reasoning__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide reasoning' : `Show reasoning · ${summary}`}
        <UiIcon icon={ChevronDown} size={14} />
      </button>

      {open && (
        <div className="reasoning__body sl-rise">
          <p className="answer__label">Why</p>
          <ul className="reasoning__reasons">
            {answer.reasons.map((reason) => (
              <li key={reason.fact} data-kind={reason.kind}>
                <UiIcon
                  icon={sourceIcon[reason.kind]}
                  size={14}
                  className="reasoning__mark"
                  aria-label={kindLabel[reason.kind]}
                />
                <span className="reasoning__fact">
                  {reason.keys.map((key) => (
                    <ItemKey key={key} id={key} />
                  ))}{' '}
                  {reason.fact}
                  {reason.kind === 'unchecked' && (
                    <span className="reasoning__flag">
                      {' '}
                      Not checked: Steerloom did not read{' '}
                      {reason.keys.join(', ')}.
                    </span>
                  )}
                </span>
                <span className="reasoning__source">{reason.source}</span>
              </li>
            ))}
          </ul>

          {answer.options && (
            <>
              <p className="answer__label">Options</p>
              <ol className="reasoning__options">
                {answer.options.map((option, index) => (
                  <li
                    key={option.what}
                    data-chosen={
                      answer.chosen?.option.includes(letters[index] ?? '')
                        ? 'true'
                        : undefined
                    }
                  >
                    <span className="reasoning__letter">{letters[index]}</span>
                    <span>
                      <strong>{option.what}</strong>{' '}
                      <span className="answer__wait">{option.tradeOff}</span>
                      <span className="reasoning__check">
                        Check: {option.checkpoint}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
              {answer.chosen && (
                <p className="reasoning__chosen">
                  <strong>Recommended: {answer.chosen.option}</strong>,{' '}
                  {answer.chosen.why}
                </p>
              )}
            </>
          )}
          {answer.removed && (
            <p className="answer__dropped">{answer.removed}</p>
          )}
        </div>
      )}

      <div className="answer__actions">
        <button
          type="button"
          className="ai-chat__action answer__action"
          onClick={() => setDeeper(true)}
          disabled={deeper}
        >
          <UiIcon icon={Layers} size={14} />
          Go deeper
        </button>
      </div>
      {deeper && (
        <p className="answer__dropped sl-rise">
          Go deeper reads every related item in detail, up to 20 steps instead
          of 8, and takes 1 to 3 minutes. The answer streams in as it is
          written.
        </p>
      )}
    </article>
  )
}
