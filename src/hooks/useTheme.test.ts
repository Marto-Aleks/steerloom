import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useTheme } from './useTheme'

afterEach(() => {
  cleanup()
  localStorage.removeItem('flowlens-ui-theme')
})

it('starts each visit light despite a previously saved dark preference, and allows toggling', () => {
  localStorage.setItem('flowlens-ui-theme', 'dark')
  const first = renderHook(useTheme)
  expect(first.result.current.theme).toBe('light')
  expect(document.documentElement.dataset.theme).toBe('light')
  act(() => first.result.current.toggleTheme())
  expect(document.documentElement.dataset.theme).toBe('dark')
  first.unmount()
  const next = renderHook(useTheme)
  expect(next.result.current.theme).toBe('light')
  expect(document.documentElement.style.colorScheme).toBe('light')
})
