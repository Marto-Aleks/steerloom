import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamNotes } from './TeamNotes'

afterEach(cleanup)

describe('Team notes for Steerloom AI', () => {
  it('lets an owner add notes and saves them trimmed', () => {
    const onSave = vi.fn()
    render(<TeamNotes onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add team notes' }))
    fireEvent.change(screen.getByLabelText('Team notes'), {
      target: { value: '  We do not run stand-ups.  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save notes' }))
    expect(onSave).toHaveBeenCalledWith('We do not run stand-ups.')
  })

  it('cancels an edit without saving', () => {
    const onSave = vi.fn()
    render(<TeamNotes notes="Review limit is 4." onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Team notes'), {
      target: { value: 'Something else' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Review limit is 4.')).toBeTruthy()
  })

  it('shows members the notes without an edit button, and nothing when empty', () => {
    const { container, rerender } = render(
      <TeamNotes notes="Review limit is 4." />,
    )
    expect(screen.getByText('Review limit is 4.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<TeamNotes />)
    expect(container.textContent).toBe('')
  })
})
