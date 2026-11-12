import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FocusSignal } from '../../lib/statistics/focus-now'
import { HeroSignal, TodayPanel } from './TodayPanel'

const signals: FocusSignal[] = [
  {
    id: 'delayed-wip',
    severity: 'critical',
    title: '2 items past the usual 7 days',
    evidence:
      'Oldest: DEMO-1, 12 days in progress, 1.7× the usual. 85% of finished items were done within 7 days, so these are already late.',
    meta: 'DEMO-1, DEMO-2',
    action: 'Review the delayed items and agree what to unblock first.',
    jiraFilter: {
      label: 'Open the delayed items in Jira',
      href: 'https://jira.example.invalid/issues/?jql=key%20in%20(DEMO-1)',
    },
  },
  {
    id: 'wip-concentration',
    severity: 'warning',
    title: 'Work is piling up in “Review”',
    evidence: '4 of 5 active items (80%) sit in this stage.',
    action: 'Review capacity, handoffs, and pull policy at this workflow step.',
  },
  {
    id: 'active-reentry',
    severity: 'info',
    title: '1 active item re-entered the flow',
    evidence: '1 item came back after leaving the measured stages.',
    action: 'Review the re-entered items.',
  },
  {
    id: 'throughput-drop',
    severity: 'warning',
    title: 'Fewer items finished recently',
    evidence: '2 items finished in the last two complete weeks, down from 6.',
    action: 'Check whether growing WIP is slowing completion.',
  },
]

afterEach(cleanup)

describe('hero signal', () => {
  it('leads with the count past the usual limit and the oldest items', () => {
    const onAsk = vi.fn()
    const onShowAll = vi.fn()
    render(
      <HeroSignal
        signal={signals[0]!}
        items={[
          {
            item: 'DEMO-1',
            ageInSelectedColumns: 12,
            currentStatus: 'In progress',
          },
          {
            item: 'DEMO-2',
            ageInSelectedColumns: 9,
            currentStatus: 'Review',
          },
        ]}
        activeCount={5}
        limitDays={7}
        onAsk={onAsk}
        onShowAll={onShowAll}
      />,
    )
    expect(
      screen.getByRole('heading', {
        name: /2.*of 5 active items past the usual 7 days/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('At risk')).toBeInTheDocument()
    const oldest = screen.getByRole('list', {
      name: /^Oldest items past the usual limit; the line marks the usual 7 days/,
    })
    expect(oldest.children).toHaveLength(2)
    expect(oldest).toHaveTextContent('1.7× usual')
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Investigate aging items with Steerloom AI',
      }),
    )
    expect(onAsk).toHaveBeenCalledWith(
      expect.stringContaining('2 items past the usual 7 days'),
      signals[0]!.action,
    )
    // Every active item opens in place, not further down the page.
    fireEvent.click(
      screen.getByRole('button', { name: 'Review all 5 active items' }),
    )
    expect(onShowAll).toHaveBeenCalled()
  })
})

describe('needs-a-decision cards', () => {
  it('hands the signal evidence and fallback action to the AI investigation', () => {
    const onAsk = vi.fn()
    render(<TodayPanel signals={signals} onAsk={onAsk} />)
    expect(
      screen.getByRole('heading', { name: 'Needs a decision today' }),
    ).toBeInTheDocument()
    expect(screen.getByText('4 signals')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Investigate aging items with Steerloom AI',
      }),
    )
    expect(onAsk).toHaveBeenCalledOnce()
    const [prompt, fallback] = onAsk.mock.calls[0]!
    expect(prompt).toContain('2 items past the usual 7 days')
    expect(prompt).toContain('already late')
    expect(fallback).toBe(signals[0]!.action)
    expect(screen.getByText('DEMO-1, DEMO-2')).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Open the delayed items in Jira (opens in a new tab)',
      }),
    ).toHaveAttribute('href', signals[0]!.jiraFilter!.href)
  })

  it('counts the hero card in the badge without repeating it', () => {
    const [hero, ...rest] = signals
    render(<TodayPanel signals={rest} heroSignal={hero} onAsk={vi.fn()} />)
    expect(screen.getByText('4 signals')).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(
      screen.queryByText('2 items past the usual 7 days'),
    ).not.toBeInTheDocument()
  })

  it('labels each card with the shared status vocabulary', () => {
    render(<TodayPanel signals={signals} onAsk={vi.fn()} />)
    const statuses = screen
      .getAllByRole('article')
      .map((card) => card.getAttribute('data-status'))
    expect(statuses).toEqual(['risk', 'bottleneck', 'rework', 'info'])
    expect(screen.getByText('At risk')).toBeInTheDocument()
    expect(screen.getByText('Bottleneck')).toBeInTheDocument()
    expect(screen.getByText('Rework')).toBeInTheDocument()
  })

  it('caps the default view at three priorities and keeps the rest reachable', () => {
    render(<TodayPanel signals={signals} onAsk={vi.fn()} />)
    expect(screen.getAllByRole('article')).toHaveLength(4)
    const more = screen.getByText('1 lower-priority signal')
    expect(more.closest('details')).not.toHaveAttribute('open')
    expect(
      screen.getByRole('button', {
        name: 'Investigate throughput drop with Steerloom AI',
      }),
    ).toBeInTheDocument()
  })

  it('reports a clear flow without inventing risk', () => {
    render(
      <TodayPanel
        signals={[
          {
            id: 'healthy',
            severity: 'healthy',
            title: 'No immediate flow risk detected',
            evidence: 'No rule fired.',
            action: 'Keep the current flow policies.',
          },
        ]}
        onAsk={vi.fn()}
      />,
    )
    expect(screen.getByText('Flow clear')).toBeInTheDocument()
    expect(screen.getByText('On track')).toBeInTheDocument()
    expect(screen.getByRole('article')).toHaveAttribute(
      'data-severity',
      'healthy',
    )
  })
})
