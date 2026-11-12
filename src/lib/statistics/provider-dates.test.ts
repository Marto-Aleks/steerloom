import { expect, it } from 'vitest'
import { isUsableDate } from '.'

it('treats a date in an unexpected shape as unusable, not as a crash', () => {
  expect(isUsableDate(1761376320000 as unknown as string)).toBe(false)
  expect(isUsableDate(undefined as unknown as string)).toBe(false)
  expect(isUsableDate('2026-10-25T07:12:00.000Z')).toBe(true)
})
