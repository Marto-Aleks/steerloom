import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectAgingWork } from '../../lib/statistics/aging-work'
import { demoSnapshot } from '../../lib/workspace/demo'
import { AgingWorkPanel } from './AgingWorkPanel'

const items = collectAgingWork(
  demoSnapshot('sample', new Date('2026-10-13T12:00:00Z')),
  ['stage-1', 'stage-2'],
)
afterEach(cleanup)
describe('aging work review interactions', () => {
  it('keeps explicit selection across filters and drafts only the chosen evidence', () => {
    const onAsk = vi.fn()
    render(
      <AgingWorkPanel items={items} p85={7} sampleCount={20} onAsk={onAsk} />,
    )
    // Opened on request, so the whole review shows at once.
    expect(screen.getAllByRole('checkbox')).toHaveLength(7)
    fireEvent.click(
      screen.getByLabelText(`Select ${items[0]!.item} for review`),
    )
    fireEvent.change(screen.getByLabelText('Find an item'), {
      target: { value: 'no-match' },
    })
    expect(
      screen.getByText(/1 outside the visible results/),
    ).toBeInTheDocument()
    expect(onAsk).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Ask AI about selected work' }),
    )
    expect(onAsk).toHaveBeenCalledOnce()
    expect(onAsk.mock.calls[0]![0]).toContain(items[0]!.item)
    expect(onAsk.mock.calls[0]![0]).not.toContain(items[1]!.item)
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(
      screen.getByRole('button', { name: 'Ask AI about selected work' }),
    ).toBeDisabled()
  })
  it('limits a review to five items and shows active work without a completed baseline', () => {
    render(
      <AgingWorkPanel
        items={items}
        p85={null}
        sampleCount={0}
        onAsk={vi.fn()}
      />,
    )
    expect(screen.getAllByText('Baseline unavailable')).toHaveLength(7)
    for (const item of items.slice(0, 5))
      fireEvent.click(screen.getByLabelText(`Select ${item.item} for review`))
    expect(
      screen.getByLabelText(`Select ${items[5]!.item} for review`),
    ).toBeDisabled()
    fireEvent.click(
      screen.getByLabelText(`Select ${items[0]!.item} for review`),
    )
    expect(
      screen.getByLabelText(`Select ${items[5]!.item} for review`),
    ).not.toBeDisabled()
  })
})

describe('item keys', () => {
  it('links every key to its item and shows the title on hover', () => {
    const titled = items.map((item, index) => ({
      ...item,
      browseUrl: `https://jira.example.invalid/browse/${item.item}`,
      ...(index === 0 ? { title: 'Fictional checkout rewrite' } : {}),
    }))
    const { container } = render(
      <AgingWorkPanel
        items={titled}
        p85={7}
        sampleCount={20}
        onAsk={vi.fn()}
      />,
    )
    const links = container.querySelectorAll('a.item-key')
    expect(links).toHaveLength(7)
    links.forEach((link) => {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('href')).toMatch(
        /^https:\/\/jira\.example\.invalid\/browse\//,
      )
    })
    const first = titled[0]!
    expect(
      screen.getByRole('link', {
        name: `${first.item}: Fictional checkout rewrite (opens in a new tab)`,
      }),
    ).toBeInTheDocument()
    expect(
      screen
        .getAllByRole('tooltip')
        .some((tip) => tip.textContent === 'Fictional checkout rewrite'),
    ).toBe(true)
    // The title is searchable in the review list.
    fireEvent.change(screen.getByLabelText('Find an item'), {
      target: { value: 'checkout rewrite' },
    })
    expect(
      screen.getByText(/Showing 1 of 1 matching items/),
    ).toBeInTheDocument()
  })
})
