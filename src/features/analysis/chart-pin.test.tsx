import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { cycleTimeRange, weekStart } from '../../lib/statistics'
import { PinnedTooltip } from './chart-parts'

afterEach(cleanup)

const point = (item: string, cycleTime: number, browseUrl?: string) => ({
  item,
  cycleTime,
  sequence: 1,
  cycleStart: '2026-09-20T00:00:00Z',
  cycleEnd: '2026-10-07T00:00:00Z',
  completedLabel: 'Oct 7',
  ...(browseUrl ? { browseUrl } : {}),
})

it('groups completions the way the charts label them', () => {
  expect(weekStart('2026-10-07T15:00:00Z')).toBe('2026-10-05')
  expect(weekStart('2026-10-11T23:59:00Z')).toBe('2026-10-05')
  expect(cycleTimeRange(7.9)).toBe('0–7d')
  expect(cycleTimeRange(8)).toBe('8–14d')
  expect(cycleTimeRange(400)).toBe('366d+')
  expect(cycleTimeRange(-1)).toBeNull()
})

it('keeps the tooltip facts and opens the items in Jira from the count', () => {
  const onClose = vi.fn()
  render(
    <PinnedTooltip
      x={40}
      y={20}
      title="Week of 5 Oct"
      count={2}
      countLabel="finished"
      details={[<p key="d">Partial week</p>]}
      items={[
        point('ABC-1', 12, 'https://jira.example.invalid/tracker/browse/ABC-1'),
        point('ABC-2', 3, 'https://jira.example.invalid/tracker/browse/ABC-2'),
      ]}
      onClose={onClose}
    />,
  )
  const pinned = screen.getByRole('dialog', { name: 'Week of 5 Oct, pinned' })
  expect(pinned).toHaveStyle({ left: '40px', top: '20px' })
  expect(pinned).toHaveTextContent('Partial week')
  const link = screen.getByRole('link', {
    name: 'Open the 2 items in Jira (opens in a new tab)',
  })
  expect(link.getAttribute('href')).toBe(
    `https://jira.example.invalid/tracker/issues/?jql=${encodeURIComponent('key in ("ABC-1", "ABC-2")')}`,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Unpin' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('falls back to the keys themselves when the tracker has no search link', () => {
  render(
    <PinnedTooltip
      x={0}
      y={0}
      title="0–7d"
      count={2}
      countLabel="(90%)"
      details={[]}
      items={[
        point('CARD-1', 2, 'https://trello.com/c/abc123'),
        point('CARD-2', 5, 'https://trello.com/c/def456'),
      ]}
      onClose={vi.fn()}
    />,
  )
  expect(screen.queryByRole('link', { name: /Open the/ })).toBeNull()
  expect(screen.getByRole('link', { name: /CARD-1/ })).toHaveAttribute(
    'href',
    'https://trello.com/c/abc123',
  )
})
