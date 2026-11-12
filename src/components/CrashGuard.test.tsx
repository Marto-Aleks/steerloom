import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { CrashGuard } from './CrashGuard'

function Broken(): never {
  throw new Error('Cannot read properties of undefined (reading "name")')
}

it('shows what happened and a way back instead of a blank page', () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  render(
    <CrashGuard>
      <Broken />
    </CrashGuard>,
  )
  quiet.mockRestore()
  expect(
    screen.getByRole('heading', { name: 'This screen couldn’t open' }),
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Back to your workspace' }),
  ).toBeVisible()
  expect(screen.getByText(/reading "name"/)).toBeInTheDocument()
})
