// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  feedbackSender,
  feedbackSubject,
  feedbackText,
  parseFeedback,
} from './feedback'

describe('parseFeedback', () => {
  it('accepts a kind, a message and a page', () => {
    expect(
      parseFeedback({
        kind: 'idea',
        message: '  Show cycle time per person  ',
        page: '/?hosted=1',
      }),
    ).toEqual({
      kind: 'idea',
      message: 'Show cycle time per person',
      page: '/?hosted=1',
    })
  })

  it('prefers the account email over a typed one', () => {
    expect(
      parseFeedback(
        {
          kind: 'problem',
          message: 'Chart is empty',
          email: 'typed@example.invalid',
        },
        'account@example.invalid',
      ).replyTo,
    ).toBe('account@example.invalid')
    expect(
      parseFeedback({
        kind: 'liked',
        message: 'Love the briefing',
        email: 'typed@example.invalid',
      }).replyTo,
    ).toBe('typed@example.invalid')
  })

  it('rejects unknown kinds, empty or huge messages and bad emails', () => {
    expect(() =>
      parseFeedback({ kind: 'spam', message: 'hello there' }),
    ).toThrow(/kind/)
    expect(() => parseFeedback({ kind: 'idea', message: ' ' })).toThrow(
      /few words/,
    )
    expect(() =>
      parseFeedback({ kind: 'idea', message: 'x'.repeat(4001) }),
    ).toThrow(/4,000/)
    expect(() =>
      parseFeedback({ kind: 'idea', message: 'hello', email: 'not an email' }),
    ).toThrow(/email/)
  })

  it('ignores pages that are not same-site paths', () => {
    expect(
      parseFeedback({
        kind: 'idea',
        message: 'hello',
        page: 'https://evil.example/',
      }).page,
    ).toBe('/')
  })
})

describe('feedbackSender', () => {
  const feedback = {
    kind: 'problem' as const,
    message: 'The AI panel\ncuts off',
    page: '/?hosted=1',
    replyTo: 'person@example.invalid',
  }

  it('writes to the log when email is not configured', async () => {
    const log = vi.fn()
    const transport = vi.fn()
    const sender = feedbackSender({
      origin: 'https://steerloom.app',
      transport,
      log,
    })
    expect(sender.emails).toBe(false)
    await sender.send(feedback)
    expect(transport).not.toHaveBeenCalled()
    expect(log.mock.calls[0]![0]).toContain('The AI panel')
  })

  it('emails plain text through Resend with a reply-to', async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const sender = feedbackSender({
      apiKey: 're_fictional',
      to: 'owner@example.invalid',
      origin: 'https://steerloom.app',
      transport,
    })
    await sender.send(feedback)
    const [url, init] = transport.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers.Authorization).toBe('Bearer re_fictional')
    const sent = JSON.parse(init.body) as Record<string, unknown>
    expect(sent.to).toEqual(['owner@example.invalid'])
    expect(sent.reply_to).toBe('person@example.invalid')
    expect(sent.text).toContain('Page: https://steerloom.app/?hosted=1')
    expect(sent.html).toBeUndefined()
    expect(sent.subject).not.toContain('\n')
  })

  it('logs and reports when the provider refuses', async () => {
    const log = vi.fn()
    const transport = vi.fn().mockResolvedValue({ ok: false, status: 422 })
    const sender = feedbackSender({
      apiKey: 're_fictional',
      to: 'owner@example.invalid',
      origin: 'https://steerloom.app',
      transport,
      log,
    })
    await expect(sender.send(feedback)).rejects.toThrow(/could not be sent/)
    expect(log.mock.calls[0]![0]).toContain('422')
  })

  it('formats a one-line subject and a readable body', () => {
    expect(feedbackSubject(feedback)).toBe(
      'Steerloom feedback · Problem · The AI panel cuts off',
    )
    expect(feedbackText(feedback, 'https://steerloom.app')).toContain(
      'Reply to: person@example.invalid',
    )
  })
})
