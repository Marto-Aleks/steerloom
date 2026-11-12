import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReportMenu } from './ReportMenu'

afterEach(cleanup)

it('keeps report actions behind one button and closes after a choice', () => {
  const refresh = vi.fn()
  render(
    <ReportMenu
      items={[
        { label: 'Refresh board', onSelect: refresh },
        { label: 'Adjust report', onSelect: vi.fn(), disabled: true },
      ]}
    />,
  )
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Report options' }))
  expect(
    screen.getByRole('menuitem', { name: 'Adjust report' }),
  ).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh board' }))
  expect(refresh).toHaveBeenCalledOnce()
  expect(screen.queryByRole('menu')).toBeNull()
})

it('closes on Escape and returns focus to the button', () => {
  render(<ReportMenu items={[{ label: 'Refresh board', onSelect: vi.fn() }]} />)
  const button = screen.getByRole('button', { name: 'Report options' })
  fireEvent.click(button)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(button)
})
