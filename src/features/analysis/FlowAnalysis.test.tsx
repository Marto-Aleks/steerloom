import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { demoSnapshot } from '../../lib/workspace/demo'
import { FlowAnalysis } from './FlowAnalysis'

HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '')
}
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open')
}

afterEach(cleanup)

it('shows every key number with its trend, and the way to the late work, on any board', async () => {
  render(
    <FlowAnalysis
      snapshot={demoSnapshot('demo-product')}
      filters={{
        ticketTypes: [],
        windowDays: 30,
        selectedColumnIds: ['stage-1', 'stage-2'],
      }}
      aiChat={false}
    />,
  )
  // No setting hides a number: throughput, cycle time and the usual limit
  // are always there.
  const measures = await screen.findByLabelText('Key measures')
  for (const name of ['Throughput', 'Cycle time', 'Usual limit (P85)'])
    expect(within(measures).getByText(name)).toBeInTheDocument()
  // The header leads to the items that are late.
  expect(screen.getByRole('button', { name: /^Show / })).toBeInTheDocument()
})
