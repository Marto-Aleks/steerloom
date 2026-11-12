import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReviewPresetPicker } from './ReviewPresetPicker'

afterEach(cleanup)

it('says what each review shows, not how much history it reads', () => {
  const onChange = vi.fn()
  render(<ReviewPresetPicker value="custom" onChange={onChange} />)
  expect(screen.getByText('This sets what the briefing shows.')).toBeTruthy()
  const daily = screen.getByRole('button', { name: /Daily review/ })
  expect(daily).toHaveTextContent('Aging work · pace')
  expect(
    screen.getByRole('button', { name: /Weekly review/ }),
  ).toHaveTextContent('Trends · cycle time')
  expect(screen.queryByText(/Last \d+ days/)).toBeNull()
  fireEvent.click(daily)
  expect(onChange).toHaveBeenCalledWith('daily')
})
