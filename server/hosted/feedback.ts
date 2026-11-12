/*
 * Tester feedback from the hosted app: a kind, a message, where it was sent
 * from and, optionally, an address to reply to. It is emailed to the operator
 * through Resend's API when STEERLOOM_RESEND_API_KEY and
 * STEERLOOM_FEEDBACK_TO are set; otherwise it is written to the server log so
 * nothing is lost. Plain text only: nothing a tester types is rendered as HTML.
 */

export const FEEDBACK_KINDS = ['idea', 'problem', 'liked'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

export interface Feedback {
  kind: FeedbackKind
  message: string
  /** Path and query of the page it was sent from, e.g. "/?hosted=1" */
  page: string
  /** Address to reply to: the account's, or one the visitor typed */
  replyTo?: string
  /** Browser user agent, trimmed */
  agent?: string
}

const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[a-z]{2,24}$/i

/** Validates a feedback request body. Throws a message fit to show the tester. */
export function parseFeedback(
  body: Record<string, unknown>,
  accountEmail?: string,
): Omit<Feedback, 'agent'> {
  const kind = body.kind
  if (
    typeof kind !== 'string' ||
    !FEEDBACK_KINDS.includes(kind as FeedbackKind)
  )
    throw new Error('Choose what kind of feedback this is.')
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (message.length < 3) throw new Error('Write a few words of feedback.')
  if (message.length > 4000)
    throw new Error('Keep feedback under 4,000 characters.')
  const rawPage = typeof body.page === 'string' ? body.page : '/'
  const page = /^\/[^\s]{0,300}$/.test(rawPage) ? rawPage : '/'
  const typed = typeof body.email === 'string' ? body.email.trim() : ''
  if (typed && !EMAIL.test(typed))
    throw new Error('Check the email address, or leave it empty.')
  const replyTo = accountEmail || typed || undefined
  return {
    kind: kind as FeedbackKind,
    message,
    page,
    ...(replyTo ? { replyTo } : {}),
  }
}

const LABEL: Record<FeedbackKind, string> = {
  idea: 'Idea',
  problem: 'Problem',
  liked: 'Liked',
}

/** Subject line: kind and the first words, on one line. */
export function feedbackSubject(feedback: Feedback): string {
  const first = feedback.message.replace(/\s+/g, ' ').slice(0, 70)
  return `Steerloom feedback · ${LABEL[feedback.kind]} · ${first}${feedback.message.length > 70 ? '…' : ''}`
}

export function feedbackText(feedback: Feedback, origin: string): string {
  return [
    feedback.message,
    '',
    '—',
    `Kind: ${LABEL[feedback.kind]}`,
    `Page: ${origin}${feedback.page}`,
    `Reply to: ${feedback.replyTo ?? 'not given'}`,
    `Browser: ${feedback.agent ?? 'unknown'}`,
  ].join('\n')
}

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>

export interface FeedbackSender {
  send(feedback: Feedback): Promise<void>
  /** True when feedback is emailed, false when it only goes to the log */
  readonly emails: boolean
}

export function feedbackSender({
  apiKey,
  to,
  from = 'Steerloom feedback <noreply@steerloom.app>',
  origin,
  transport,
  log = (line: string) => console.info(line),
}: {
  apiKey?: string
  to?: string
  from?: string
  origin: string
  transport: Fetch
  log?: (line: string) => void
}): FeedbackSender {
  const emails = !!apiKey && !!to
  return {
    emails,
    async send(feedback) {
      if (!emails) {
        log(`[feedback] ${JSON.stringify(feedback)}`)
        return
      }
      const response = await transport('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: feedbackSubject(feedback),
          text: feedbackText(feedback, origin),
          ...(feedback.replyTo ? { reply_to: feedback.replyTo } : {}),
        }),
      })
      if (!response.ok) {
        // Keep the feedback even when the mail provider refuses it.
        log(
          `[feedback] email failed (${response.status}): ${JSON.stringify(feedback)}`,
        )
        throw new Error('Feedback could not be sent. Try again in a minute.')
      }
    },
  }
}
