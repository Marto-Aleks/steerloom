import { useState } from 'react'
import { Check, ChevronDown, Copy, ExternalLink } from 'lucide-react'
import { Wordmark } from '../components/Wordmark'
import { UiIcon } from '../components/UiIcon'
import { StatusBadge } from '../components/ui'
import './review.css'

/*
 * Development-only mock: answer cards. The assistant fills a fixed shape
 * (claim, evidence, one move) and Steerloom draws it, so length is capped by
 * the format instead of by a request in the prompt. Fictional data throughout.
 */

type Confidence = 'confirmed' | 'likely' | 'possible'

interface Evidence {
  key: string
  owner?: string
  waitingOn: string
}

interface Move {
  who: string
  what: string
  expectedChange: string
}

interface Cause {
  claim: string
  confidence: Confidence
  evidence: Evidence[]
  move: Move | 'nothing-yet'
  askTeam?: string
  dropped?: string[]
}

const confidenceTone = {
  confirmed: 'success',
  likely: 'warning',
  possible: 'neutral',
} as const

const confidenceLabel = {
  confirmed: 'Confirmed',
  likely: 'Likely',
  possible: 'Possible',
} as const

const reviewCause: Cause = {
  claim: 'Review is the constraint, not development.',
  confidence: 'likely',
  evidence: [
    {
      key: 'FLOW-112',
      owner: 'Dana',
      waitingOn: 'PR open since Oct 21, no reviewer comment',
    },
    {
      key: 'FLOW-119',
      owner: 'Dana',
      waitingOn: 'PR open since Oct 24, no reviewer comment',
    },
    {
      key: 'FLOW-131',
      owner: 'Priya',
      waitingOn: 'waiting on the API team since Oct 18',
    },
    {
      key: 'FLOW-127',
      owner: 'Dana',
      waitingOn: 'PR open since Oct 27',
    },
    {
      key: 'FLOW-140',
      owner: 'Sam',
      waitingOn: 'reviewer asked for changes Oct 26, no reply',
    },
  ],
  move: {
    who: 'The team',
    what: 'takes one review each before starting new work.',
    expectedChange:
      'Items in Review should drop from 6 to 3 by the next refresh.',
  },
  askTeam: 'Who can take a review today?',
}

const thinCause: Cause = {
  claim: 'FLOW-131 may be waiting on a decision, not on work.',
  confidence: 'possible',
  evidence: [
    {
      key: 'FLOW-131',
      owner: 'Priya',
      waitingOn: 'last comment Oct 18: “need product to confirm scope”',
    },
  ],
  move: 'nothing-yet',
  dropped: ['FLOW-99'],
}

const todayProse = `Looking at the board, the main issue is that work is piling up in Review. Finished items spent 58% of their time in Review, and 6 of 12 active items are sitting there right now, which suggests that Review has become the bottleneck for the team rather than development itself.

Why: Review appears to be the likely constraint. Several items have open pull requests without any reviewer activity.
- FLOW-112 (Dana): PR open since 21 Oct, no reviewer comment
- FLOW-119 (Dana), FLOW-127 (Dana): PRs open since 24 Oct and 27 Oct
- FLOW-131 (Priya): waiting on the API team since 18 Oct
- FLOW-140 (Sam): changes requested 26 Oct, no reply yet

Who: Dana currently holds three of the six items in Review. This is a load problem rather than a performance one: too much work sits on one desk and nobody seems free to review it.

This week: the team could agree that everyone picks up one review before starting new work, and that FLOW-131 is escalated to the API team if it has not moved. By the next refresh the number of items in Review should come down.

Ask the team: who can take a review today?`

const draftText = `Six items are waiting in Review, the oldest since Oct 21 (FLOW-112). Can everyone take one review before picking up new work today?`

const words = (text: string) => text.split(/\s+/).filter(Boolean).length

export function CardsPreview() {
  return (
    <main className="review-index" id="main-content">
      <header className="review-index__head">
        <Wordmark />
        <h1>Answer cards</h1>
        <p>
          Fictional data. The assistant fills a fixed shape and Steerloom draws
          it: one claim, evidence you can open, one move. The format caps the
          length, not the prompt.
        </p>
      </header>
      <div className="review-signals report">
        <h2>1. Same question, today vs. with cards</h2>
        <p className="review-signals__note">
          “Why is Review stuck?” on a board where 6 of 12 active items sit in
          Review.
        </p>
        <div className="cards-compare">
          <section className="cards-compare__col" aria-label="Today">
            <p className="cards-compare__label">
              Today · {words(todayProse)} words
            </p>
            <ChatColumn question="Why is Review stuck?">
              <article className="ai-chat__message cards-prose">
                <p className="ai-chat__message-role">Steerloom AI</p>
                <p className="ai-chat__message-content">{todayProse}</p>
              </article>
            </ChatColumn>
          </section>
          <section className="cards-compare__col" aria-label="With cards">
            <p className="cards-compare__label cards-compare__label--new">
              With cards · {causeWords(reviewCause)} words
            </p>
            <ChatColumn question="Why is Review stuck?">
              <CauseCard cause={reviewCause} />
            </ChatColumn>
          </section>
        </div>

        <h2>2. The four answer types</h2>
        <p className="review-signals__note">
          The kind of question picks the card. When it is unclear, the answer
          stays plain text.
        </p>
        <div className="cards-types">
          <TypeBlock
            name="Fact"
            when="Who holds it, what the last comment says, when it moved."
          >
            <ChatColumn question="Who holds FLOW-131?">
              <FactCard />
            </ChatColumn>
          </TypeBlock>
          <TypeBlock
            name="Draft"
            when="A message to send: to the team, a Jira comment, another team."
          >
            <ChatColumn question="Write the message to the API team about FLOW-131">
              <DraftCard
                target="Message to the API team"
                text="Hi, FLOW-131 has been waiting on your side since Oct 18. Can you confirm by Thursday whether the new endpoint ships this sprint? If not, we will take it out of scope."
              />
            </ChatColumn>
          </TypeBlock>
          <TypeBlock
            name="Plain text"
            when="Comparing, exploring, anything that needs nuance. Capped at 120 words."
          >
            <ChatColumn question="Is this sprint worse than last sprint?">
              <article className="ai-chat__message cards-prose">
                <p className="ai-chat__message-role">Steerloom AI</p>
                <p className="ai-chat__message-content">
                  Slower to finish, not busier. 20 items finished in the last 2
                  weeks against 23 before, while starts stayed at 21. The
                  difference is time in Review, up from 41% to 58%. Two
                  explanations fit: fewer reviewers this sprint, or bigger PRs.
                  The PR sizes on FLOW-112 and FLOW-119 would tell them apart.
                </p>
              </article>
            </ChatColumn>
          </TypeBlock>
        </div>

        <h2>3. When the evidence is thin</h2>
        <p className="review-signals__note">
          “Possible” reads quieter than “Likely”. “Nothing to do yet” is a real
          answer, so the model is never pushed to invent a move. Keys that are
          not on the board are removed before the card is drawn.
        </p>
        <div className="cards-single">
          <ChatColumn question="Why has FLOW-131 not moved?">
            <CauseCard cause={thinCause} />
          </ChatColumn>
        </div>

        <h2>4. The shape behind every cause card</h2>
        <dl className="cards-schema">
          <div>
            <dt>Claim</dt>
            <dd>One sentence, up to 140 characters. Required.</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>
              Confirmed, likely or possible. Only “confirmed” when a ticket says
              so.
            </dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>
              1 to 5 items, 3 shown. Each has a key that exists on the board.
            </dd>
          </div>
          <div>
            <dt>Move</dt>
            <dd>
              Who acts, what they do, which number should change by the next
              refresh. Or “nothing to do yet”.
            </dd>
          </div>
          <div>
            <dt>Ask the team</dt>
            <dd>Optional. One question, up to 100 characters.</dd>
          </div>
        </dl>
      </div>
    </main>
  )
}

function causeWords(cause: Cause): number {
  const shown = cause.evidence.slice(0, 3)
  const parts = [
    cause.claim,
    ...shown.map((e) => `${e.key} ${e.owner ?? ''} ${e.waitingOn}`),
    typeof cause.move === 'string'
      ? 'Nothing to do yet'
      : `${cause.move.who} ${cause.move.what} ${cause.move.expectedChange}`,
    cause.askTeam ?? '',
  ]
  return words(parts.join(' '))
}

function ChatColumn({
  question,
  children,
}: {
  question: string
  children: React.ReactNode
}) {
  return (
    <div className="cards-chat">
      <article className="ai-chat__message" data-role="user">
        <p className="ai-chat__message-role">You</p>
        <p className="ai-chat__message-content">{question}</p>
      </article>
      {children}
    </div>
  )
}

function TypeBlock({
  name,
  when,
  children,
}: {
  name: string
  when: string
  children: React.ReactNode
}) {
  return (
    <section className="cards-type" aria-label={name}>
      <p className="cards-type__name">{name}</p>
      <p className="cards-type__when">{when}</p>
      {children}
    </section>
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

function CopyButton({
  text,
  label = 'Copy',
}: {
  text: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="ai-chat__action answer__action"
      onClick={() => {
        void navigator.clipboard?.writeText(text)
        setCopied(true)
      }}
    >
      <UiIcon icon={copied ? Check : Copy} size={14} />
      {copied ? 'Copied' : label}
    </button>
  )
}

function CauseCard({ cause }: { cause: Cause }) {
  const [all, setAll] = useState(false)
  const [draft, setDraft] = useState(false)
  const shown = all ? cause.evidence : cause.evidence.slice(0, 3)
  const hidden = cause.evidence.length - 3
  return (
    <>
      <article className="answer" data-confidence={cause.confidence}>
        <div className="answer__head">
          <p className="answer__claim">{cause.claim}</p>
          <StatusBadge tone={confidenceTone[cause.confidence]} showDot>
            {confidenceLabel[cause.confidence]}
          </StatusBadge>
        </div>
        <ul className="answer__evidence">
          {shown.map((item) => (
            <li key={item.key}>
              <ItemKey id={item.key} />
              {item.owner && (
                <span className="answer__owner">{item.owner}</span>
              )}
              <span className="answer__wait">{item.waitingOn}</span>
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          <button
            type="button"
            className="answer__more"
            aria-expanded={all}
            onClick={() => setAll((value) => !value)}
          >
            {all ? 'Show fewer' : `${hidden} more`}
            <UiIcon icon={ChevronDown} size={14} />
          </button>
        )}
        {typeof cause.move === 'string' ? (
          <div className="answer__move answer__move--none">
            <p className="answer__label">Move</p>
            <p>
              Nothing to do yet. Ask Priya whether product has answered, then
              ask again.
            </p>
          </div>
        ) : (
          <div className="answer__move">
            <p className="answer__label">Move</p>
            <p>
              <strong>{cause.move.who}</strong> {cause.move.what}{' '}
              <span className="answer__change">
                {cause.move.expectedChange}
              </span>
            </p>
          </div>
        )}
        {cause.askTeam && (
          <p className="answer__ask">
            <span className="answer__label">Ask the team</span> {cause.askTeam}
          </p>
        )}
        {cause.dropped && (
          <p className="answer__dropped">
            Removed {cause.dropped.join(', ')}: not on this board.
          </p>
        )}
        <div className="answer__actions">
          {typeof cause.move !== 'string' && (
            <button
              type="button"
              className="ai-chat__action answer__action answer__action--primary"
              onClick={() => setDraft(true)}
              disabled={draft}
            >
              Draft what to raise today
            </button>
          )}
          <CopyButton text={cardText(cause)} />
        </div>
      </article>
      {draft && <DraftCard target="What to raise today" text={draftText} />}
    </>
  )
}

function cardText(cause: Cause): string {
  const move =
    typeof cause.move === 'string'
      ? 'Nothing to do yet.'
      : `${cause.move.who} ${cause.move.what} ${cause.move.expectedChange}`
  return [
    cause.claim,
    ...cause.evidence.map(
      (e) => `- ${e.key}${e.owner ? ` (${e.owner})` : ''}: ${e.waitingOn}`,
    ),
    `Move: ${move}`,
  ].join('\n')
}

function FactCard() {
  return (
    <article className="answer answer--fact">
      <p className="answer__claim">
        Priya, since Oct 9. In “Waiting for API” for 13 days.
      </p>
      <ul className="answer__evidence">
        <li>
          <ItemKey id="FLOW-131" />
          <span className="answer__wait">
            last comment Oct 18: “need product to confirm scope”
          </span>
        </li>
      </ul>
    </article>
  )
}

function DraftCard({ target, text }: { target: string; text: string }) {
  return (
    <article className="answer answer--draft sl-rise">
      <p className="answer__label">{target}</p>
      <p className="answer__draft">{text}</p>
      <div className="answer__actions">
        <CopyButton text={text} label="Copy message" />
      </div>
    </article>
  )
}
