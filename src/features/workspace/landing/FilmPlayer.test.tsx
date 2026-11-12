import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { LandingPage } from './LandingPage'

// jsdom has no media playback; the player only needs play/pause to exist.
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: () => Promise.resolve(),
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: () => undefined,
  })
})

afterEach(cleanup)

describe('the film in the hero', () => {
  it('opens the player from the film card, with captions, and closes on Escape', () => {
    render(<LandingPage productionHosted={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    const card = screen.getByRole('button', { name: /watch the film/i })
    fireEvent.click(card)
    const dialog = screen.getByRole('dialog', { name: /the film/i })
    const video = dialog.querySelector('video')
    expect(video).toHaveAttribute('controls')
    expect(video?.querySelector('track[kind="captions"]')).not.toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /close the film/i }),
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(card)
  })

  it('closes on a click outside the player', () => {
    render(<LandingPage productionHosted={false} />)
    fireEvent.click(screen.getByRole('button', { name: /watch the film/i }))
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
