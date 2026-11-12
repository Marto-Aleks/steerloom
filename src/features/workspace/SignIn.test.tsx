import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SignIn } from './SignIn'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

it('opens on creating a workspace by default', () => {
  render(<SignIn onSession={() => undefined} />)
  expect(screen.getByLabelText(/Workspace name/)).toBeInTheDocument()
})

it('opens on signing in when the address asks for it', () => {
  window.history.replaceState(null, '', '/?page=signin')
  render(<SignIn onSession={() => undefined} />)
  expect(screen.queryByLabelText(/Workspace name/)).toBeNull()
  expect(screen.getByLabelText(/Username/)).toBeInTheDocument()
})
