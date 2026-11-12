import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForecastPanel } from './ForecastPanel'

const basis = {
  sampleStart: '2026-05-01',
  sampleEndExclusive: '2026-06-01',
  sampledDays: 31,
  completedItems: 20,
}

describe('ForecastPanel', () => {
  afterEach(cleanup)

  it('leads with the 85% date and lists every confidence level', () => {
    const onAsk = vi.fn()
    render(
      <ForecastPanel
        onAsk={onAsk}
        result={{
          simulatedDays: 1,
          forecast: {
            basis,
            finishCurrentWork: {
              items: 5,
              p50: '2026-06-05',
              p70: '2026-06-07',
              p85: '2026-06-09',
              p95: '2026-06-12',
              beyondYear: false,
              withinTwoWeeksPercent: 62,
            },
            nextTwoWeeks: { atLeastItemsP85: 4, itemsP50: 6 },
          },
        }}
      />,
    )
    expect(screen.getByText(/85% likely by/)).toHaveTextContent(
      /\b9\b.*Jun|Jun.*\b9\b/,
    )
    expect(
      screen.getByRole('list', { name: 'Finish dates by confidence' }).children,
    ).toHaveLength(4)
    expect(screen.getByText(/at least 4 items finish/)).toBeInTheDocument()
    expect(
      screen.getByText(/chance all 5 active items finish/),
    ).toHaveTextContent('62%')
    fireEvent.click(
      screen.getByRole('button', { name: 'Ask AI what could change this' }),
    )
    expect(onAsk).toHaveBeenCalledTimes(1)
  })

  it('renders as the briefing hero with the final confidence when motion cannot run', () => {
    render(
      <ForecastPanel
        hero
        onAsk={vi.fn()}
        result={{
          simulatedDays: 1,
          forecast: {
            basis,
            finishCurrentWork: {
              items: 2,
              p50: '2026-06-03',
              p70: '2026-06-04',
              p85: '2026-06-05',
              p95: '2026-06-08',
              beyondYear: false,
              withinTwoWeeksPercent: 90,
            },
            nextTwoWeeks: { atLeastItemsP85: 2, itemsP50: 3 },
          },
        }}
      />,
    )
    const region = screen.getByRole('region', {
      name: 'When current work could finish',
    })
    expect(region).toHaveAttribute('data-variant', 'hero')
    expect(region).toHaveClass('briefing-hero')
    expect(screen.getByText(/85% likely by/)).toBeInTheDocument()
  })

  it('explains why no forecast is shown', () => {
    render(
      <ForecastPanel
        onAsk={vi.fn()}
        result={{ unavailable: 'fewer than 10 finished items', basis: null }}
      />,
    )
    expect(
      screen.getByText('No forecast yet: fewer than 10 finished items'),
    ).toBeInTheDocument()
  })
})
