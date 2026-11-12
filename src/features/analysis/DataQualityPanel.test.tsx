import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { DataQualityReport } from '../../lib/statistics/data-quality'
import { DataQualityPanel } from './DataQualityPanel'

const report = {
  status: 'warning',
  verdict: {
    level: 'weak',
    sentence:
      'Weak: no work has finished in the last 30 days, so cycle time and the forecast can’t be calculated yet.',
  },
  findings: [
    {
      id: 'no-finished-work',
      severity: 'warning',
      title: 'Nothing has finished yet',
      detail: 'No work has left In Progress in the last 30 days.',
      affects: 'Cycle time, the usual limit (P85) and the forecast.',
      fix: { kind: 'window', days: 90, label: 'Measure the last 90 days' },
    },
  ],
  passed: ['stages chosen', 'no duplicate items'],
  passedCount: 2,
  checkCount: 3,
  uniqueIssueCount: 12,
  validTransitionCount: 24,
  invalidTransitionCount: 0,
  completedObservationCount: 0,
  exitedOutsideWindowCount: 0,
  workInProgressCount: 9,
  neverEnteredCount: 2,
  typeExcludedCount: 1,
} as unknown as DataQualityReport

it('leads with the verdict and offers only the fixes this screen can apply', () => {
  const onFix = vi.fn()
  const { rerender } = render(
    <DataQualityPanel report={report} onFix={onFix} fixes={['window']} />,
  )
  expect(screen.getByText('Weak data')).toBeVisible()
  expect(
    screen.getByText(/^no work has finished in the last 30 days/),
  ).toBeVisible()
  const finding = screen.getByRole('listitem')
  expect(within(finding).getByText('Nothing has finished yet')).toBeVisible()
  fireEvent.click(
    within(finding).getByRole('button', { name: 'Measure the last 90 days' }),
  )
  expect(onFix).toHaveBeenCalledWith(report.findings[0]!.fix)
  expect(screen.getByText(/2 checks found nothing to flag/)).toBeVisible()
  expect(
    screen.getByText('Stages chosen, no duplicate items.'),
  ).toBeInTheDocument()

  rerender(<DataQualityPanel report={report} onFix={onFix} fixes={[]} />)
  expect(screen.queryByRole('button', { name: /Measure/ })).toBeNull()
})
