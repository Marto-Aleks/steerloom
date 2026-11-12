import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { MessageSquareText, X } from 'lucide-react'
import { track } from '../lib/usage/track'
import { onFeedbackAsk, type FeedbackTopic } from './feedback-nudge'
import { Loomy, type LoomyFace } from './Loomy'
import { UiIcon } from './UiIcon'
import {
  GlassButton,
  GlassInput,
  GlassModal,
  SegmentedControl,
  StatusMessage,
} from './ui'

/*
 * "Feedback" on every hosted page: a small pill in the corner that opens a
 * short form. Signed-in testers get their account email attached on the
 * server; visitors (the demo) may add one. Sent to the operator by email.
 *
 * Loomy peeks over the pill and looks at the pointer when it comes near.
 * Once, after a first briefing, she hops up and asks whether it was useful
 * (on the demo: whether it looks useful for the team): one click answers,
 * and a note is optional.
 */

type Kind = 'idea' | 'problem' | 'liked'
const KINDS = [
  { value: 'idea', label: 'Idea' },
  { value: 'problem', label: 'Problem' },
  { value: 'liked', label: 'I liked' },
] as const satisfies ReadonlyArray<{ value: Kind; label: string }>

type Nudge = 'ask' | 'useful' | 'not-useful'
const NUDGE_TEXT: Record<FeedbackTopic, Record<Nudge, string>> = {
  briefing: {
    ask: 'Was this briefing useful?',
    useful: 'Glad it helped. What worked well?',
    'not-useful': 'Thanks for saying so. What was missing?',
  },
  demo: {
    ask: 'Does this look useful for your team?',
    useful: 'Good to hear. What stood out?',
    'not-useful': 'Thanks for saying so. What was missing?',
  },
}
const NUDGE_FACE: Record<Nudge, LoomyFace> = {
  ask: 'curious',
  useful: 'delighted',
  'not-useful': 'reading',
}
/** How long the thank-you stays when nobody touches it. */
const THANKS_MS = 12_000
/** Loomy's eyes follow a pointer closer than this, in px. */
const LOOK_RADIUS = 320

/** Where Loomy looks: at a nearby pointer, or wherever her face looks. */
function usePointerLook(target: RefObject<HTMLElement | null>) {
  const [look, setLook] = useState<{ x: number; y: number }>()
  useEffect(() => {
    if (!window.matchMedia?.('(pointer: fine)').matches) return
    let frame = 0
    const follow = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = target.current?.getBoundingClientRect()
        if (!box) return
        const dx = event.clientX - (box.left + box.width / 2)
        const dy = event.clientY - (box.top + box.height / 2)
        const distance = Math.hypot(dx, dy)
        if (distance > LOOK_RADIUS) {
          setLook((current) => (current ? undefined : current))
          return
        }
        const reach = Math.min(1, distance / 120) / Math.max(1, distance)
        const next = {
          x: Math.round(dx * reach * 10) / 10,
          y: Math.round(dy * reach * 10) / 10,
        }
        setLook((current) =>
          current?.x === next.x && current.y === next.y ? current : next,
        )
      })
    }
    window.addEventListener('pointermove', follow, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', follow)
    }
  }, [target])
  return look
}

const PROMPT: Record<Kind, string> = {
  idea: 'What would make Steerloom more useful for you?',
  problem: 'What happened, and what did you expect?',
  liked: 'What worked well for you?',
}

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('idea')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')
  const [nudge, setNudge] = useState<Nudge | null>(null)
  const [topic, setTopic] = useState<FeedbackTopic>('briefing')
  const [hovered, setHovered] = useState(false)
  const messageId = useId()
  const emailId = useId()
  const loomy = useRef<HTMLSpanElement>(null)
  const look = usePointerLook(loomy)

  useEffect(
    () =>
      onFeedbackAsk((about) => {
        setTopic(about)
        setNudge('ask')
      }),
    [],
  )
  useEffect(() => {
    if (nudge !== 'useful' && nudge !== 'not-useful') return
    const timer = window.setTimeout(() => setNudge(null), THANKS_MS)
    return () => window.clearTimeout(timer)
  }, [nudge])

  const answer = (useful: boolean) => {
    track(
      topic === 'demo'
        ? useful
          ? 'demo_useful'
          : 'demo_not_useful'
        : useful
          ? 'briefing_useful'
          : 'briefing_not_useful',
    )
    setNudge(useful ? 'useful' : 'not-useful')
  }
  const openForm = (startWith?: Kind) => {
    if (startWith) setKind(startWith)
    setNudge(null)
    setOpen(true)
  }
  const face: LoomyFace = nudge
    ? NUDGE_FACE[nudge]
    : state === 'sent'
      ? 'delighted'
      : hovered
        ? 'curious'
        : 'calm'

  const close = () => {
    setOpen(false)
    if (state === 'sent') {
      setState('idle')
      setMessage('')
    }
    setError('')
  }

  const send = async () => {
    setState('sending')
    setError('')
    try {
      const response = await fetch('/api/hosted/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          kind,
          message,
          email,
          page: `${window.location.pathname}${window.location.search}`,
        }),
      })
      const value = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok)
        throw new Error(value.error ?? 'Feedback could not be sent.')
      setState('sent')
    } catch (caught) {
      setState('idle')
      setError(
        caught instanceof Error
          ? caught.message
          : 'Feedback could not be sent.',
      )
    }
  }

  return (
    <>
      <div
        className="feedback-corner"
        data-loomy={nudge ? 'up' : hovered ? 'near' : 'peek'}
      >
        <span className="feedback-loomy" ref={loomy} aria-hidden="true">
          <Loomy
            face={face}
            size={44}
            look={nudge || !look ? undefined : look}
          />
        </span>
        <button
          type="button"
          className="feedback-pill"
          aria-label="Feedback"
          onClick={() => openForm()}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
        >
          <UiIcon icon={MessageSquareText} size={16} />
          <span className="feedback-pill__label">Feedback</span>
        </button>
        {nudge && (
          <div className="feedback-nudge" role="group" aria-label="Feedback">
            <p className="feedback-nudge__text" role="status">
              {NUDGE_TEXT[topic][nudge]}
            </p>
            <div className="feedback-nudge__actions">
              {nudge === 'ask' ? (
                <>
                  {/* Equal weight: neither answer is the suggested one. */}
                  <GlassButton size="compact" onClick={() => answer(true)}>
                    Yes
                  </GlassButton>
                  <GlassButton size="compact" onClick={() => answer(false)}>
                    Not really
                  </GlassButton>
                </>
              ) : (
                <GlassButton
                  size="compact"
                  onClick={() =>
                    openForm(nudge === 'useful' ? 'liked' : 'idea')
                  }
                >
                  Add a note
                </GlassButton>
              )}
            </div>
            <button
              type="button"
              className="feedback-nudge__close"
              aria-label="Close"
              onClick={() => setNudge(null)}
            >
              <UiIcon icon={X} size={14} />
            </button>
          </div>
        )}
      </div>
      <GlassModal
        open={open}
        title={state === 'sent' ? 'Thank you' : 'Send feedback'}
        description={
          state === 'sent'
            ? 'It went straight to the people building Steerloom.'
            : 'Steerloom is in early testing. Every note is read.'
        }
        className="feedback-modal"
        onClose={close}
      >
        {state === 'sent' ? (
          <div className="feedback-form__actions">
            <GlassButton variant="primary" onClick={close}>
              Close
            </GlassButton>
          </div>
        ) : (
          <form
            className="feedback-form"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <SegmentedControl
              label="Kind of feedback"
              options={KINDS}
              value={kind}
              onChange={setKind}
            />
            <div className="feedback-form__field">
              <label htmlFor={messageId}>{PROMPT[kind]}</label>
              <textarea
                id={messageId}
                className="glass-input feedback-form__message"
                rows={5}
                maxLength={4000}
                required
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <small>Leave out customer names and ticket contents.</small>
            </div>
            <div className="feedback-form__field">
              <label htmlFor={emailId}>Email for a reply (optional)</label>
              <GlassInput
                id={emailId}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <small>If you are signed in, we use your account email.</small>
            </div>
            {error && <StatusMessage variant="error">{error}</StatusMessage>}
            <div className="feedback-form__actions">
              <GlassButton onClick={close}>Cancel</GlassButton>
              <GlassButton
                type="submit"
                variant="primary"
                disabled={state === 'sending' || message.trim().length < 3}
              >
                {state === 'sending' ? 'Sending…' : 'Send feedback'}
              </GlassButton>
            </div>
          </form>
        )}
      </GlassModal>
    </>
  )
}
