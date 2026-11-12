import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { demoSnapshot } from '../../lib/workspace/demo'
import { MeasureScope } from './MeasureScope'

// jsdom has no <dialog> methods; the sheet only needs them to exist.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '')
}
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open')
}

afterEach(cleanup)

const filters = {
  ticketTypes: [] as string[],
  windowDays: 30,
  selectedColumnIds: ['stage-1', 'stage-2'],
}

it('says what the briefing measures in one line', () => {
  render(
    <MeasureScope snapshot={demoSnapshot('demo-product')} filters={filters} />,
  )
  // Every item type is the default, so the line does not say it.
  expect(screen.getByText(/Measuring/).closest('p')?.textContent).toBe(
    'Measuring In progress → Review · last 30 days',
  )
  // Members get the line only.
  expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
})

it('lets owners change the scope in a sheet and saves only on Update', () => {
  const onChange = vi.fn()
  render(
    <MeasureScope
      snapshot={demoSnapshot('demo-product')}
      filters={filters}
      onChange={onChange}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Change' }))
  const sheet = screen.getByRole('dialog')
  expect(sheet).toHaveTextContent('What this briefing measures')
  const update = screen.getByRole('button', { name: 'Update briefing' })
  // Nothing changed yet: nothing to save.
  expect(update).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /Review/ }))
  expect(update).toBeEnabled()
  fireEvent.click(update)
  expect(onChange).toHaveBeenCalledWith({
    ...filters,
    selectedColumnIds: ['stage-1'],
  })
})
