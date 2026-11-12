import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FeedbackButton } from './FeedbackButton'
import { askForFeedbackOnce, askForFeedbackSoon } from './feedback-nudge'

// The test browser has no dialogs of its own.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '')
}
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open')
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.head.querySelector('meta[name="steerloom-mode"]')?.remove()
})

it('asks once whether the briefing was useful, and takes a one-click answer', () => {
  render(<FeedbackButton />)
  expect(screen.queryByText('Was this briefing useful?')).toBeNull()

  act(() => askForFeedbackOnce())
  expect(screen.getByText('Was this briefing useful?')).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Not really' }))
  expect(
    screen.getByText('Thanks for saying so. What was missing?'),
  ).toBeVisible()

  // A note is optional; it opens the form on the matching kind.
  fireEvent.click(screen.getByRole('button', { name: 'Add a note' }))
  expect(screen.queryByText(/What was missing/)).toBeNull()
  expect(
    screen.getByLabelText('What would make Steerloom more useful for you?'),
  ).toBeVisible()
})

it('does not ask the same browser twice', () => {
  render(<FeedbackButton />)
  act(() => askForFeedbackOnce())
  const question = within(screen.getByRole('group', { name: 'Feedback' }))
  fireEvent.click(question.getByRole('button', { name: 'Close' }))
  expect(screen.queryByText('Was this briefing useful?')).toBeNull()

  act(() => askForFeedbackOnce())
  expect(screen.queryByText('Was this briefing useful?')).toBeNull()
})

it('counts the answer on the hosted site, as a step with no text', () => {
  const meta = document.createElement('meta')
  meta.name = 'steerloom-mode'
  meta.content = 'hosted'
  document.head.append(meta)
  const sent = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  )
  vi.stubGlobal('fetch', sent)
  render(<FeedbackButton />)
  act(() => askForFeedbackOnce())
  fireEvent.click(screen.getByRole('button', { name: 'Yes' }))

  expect(sent).toHaveBeenCalledTimes(1)
  expect(sent.mock.calls[0]![0]).toBe('/api/hosted/event')
  expect(JSON.parse(String(sent.mock.calls[0]![1]?.body))).toEqual({
    step: 'briefing_useful',
  })
  expect(screen.getByText('Glad it helped. What worked well?')).toBeVisible()
})

it('waits 20 seconds on a briefing, and longer while a dialog is open', () => {
  vi.useFakeTimers()
  render(<FeedbackButton />)
  const dialog = document.createElement('dialog')
  dialog.setAttribute('open', '')
  document.body.append(dialog)

  const callOff = askForFeedbackSoon()
  act(() => void vi.advanceTimersByTime(19_000))
  expect(screen.queryByText('Was this briefing useful?')).toBeNull()
  act(() => void vi.advanceTimersByTime(1_000))
  expect(screen.queryByText('Was this briefing useful?')).toBeNull()

  dialog.remove()
  act(() => void vi.advanceTimersByTime(10_000))
  expect(screen.getByText('Was this briefing useful?')).toBeVisible()
  callOff()
})

it('stays quiet where there is no feedback button, and asks later', () => {
  askForFeedbackOnce()
  render(<FeedbackButton />)
  expect(screen.queryByText('Was this briefing useful?')).toBeNull()
  act(() => askForFeedbackOnce())
  expect(screen.getByText('Was this briefing useful?')).toBeVisible()
})

it('asks its own question on the demo, once, and counts it apart', () => {
  const meta = document.createElement('meta')
  meta.name = 'steerloom-mode'
  meta.content = 'hosted'
  document.head.append(meta)
  const sent = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  )
  vi.stubGlobal('fetch', sent)
  render(<FeedbackButton />)

  act(() => askForFeedbackOnce('demo'))
  expect(screen.getByText('Does this look useful for your team?')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Not really' }))
  expect(JSON.parse(String(sent.mock.calls[0]![1]?.body))).toEqual({
    step: 'demo_not_useful',
  })
  const question = within(screen.getByRole('group', { name: 'Feedback' }))
  fireEvent.click(question.getByRole('button', { name: 'Close' }))

  // The demo question does not repeat; a real briefing still gets its own.
  act(() => askForFeedbackOnce('demo'))
  expect(screen.queryByText('Does this look useful for your team?')).toBeNull()
  act(() => askForFeedbackOnce('briefing'))
  expect(screen.getByText('Was this briefing useful?')).toBeVisible()
})
