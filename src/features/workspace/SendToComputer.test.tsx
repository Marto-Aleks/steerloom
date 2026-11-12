import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SendToComputer } from './SendToComputer'

const PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'share')
})

it('shows nothing on a computer, where the install command is the next step', () => {
  render(<SendToComputer />)
  expect(screen.queryByRole('heading', { name: 'On your phone?' })).toBeNull()
})

it('on a phone, shares the local setup page through the phone’s own share sheet', () => {
  vi.stubGlobal('navigator', { userAgent: PHONE, share: vi.fn() })
  const share = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { share })
  render(<SendToComputer />)
  fireEvent.click(screen.getByRole('button', { name: 'Send to my computer' }))
  expect(share).toHaveBeenCalledWith(
    expect.objectContaining({
      url: `${window.location.origin}/?hosted=1&page=local`,
    }),
  )
})

it('offers an email and a link to copy where the browser cannot share', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { userAgent: PHONE, clipboard: { writeText } })
  render(<SendToComputer />)
  expect(
    screen
      .getByRole('link', { name: 'Email it to myself' })
      .getAttribute('href'),
  ).toContain(encodeURIComponent('/?hosted=1&page=local'))
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
  expect(writeText).toHaveBeenCalledWith(
    `${window.location.origin}/?hosted=1&page=local`,
  )
  expect(
    await screen.findByRole('button', { name: 'Copied' }),
  ).toBeInTheDocument()
})
