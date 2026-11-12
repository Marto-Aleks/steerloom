import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CodeReviewPanel, type CodeReviewGroup } from './CodeReviewPanel'

afterEach(cleanup)

const item = (key: string, detail: string) => ({
  key,
  detail,
  browseUrl: `https://jira.example.invalid/browse/${key}`,
})
const groups: CodeReviewGroup[] = [
  {
    id: 'unreviewed',
    label: 'not reviewed yet',
    items: [item('FLOW-1', 'No review yet; ready for 6 days.')],
  },
  { id: 'quiet', label: 'quiet for a week+', items: [] },
  { id: 'moving', label: 'moving', items: [item('FLOW-2', 'In review.')] },
  { id: 'done', label: 'approved or merged', items: [] },
  {
    id: 'none',
    label: 'no pull request',
    items: ['FLOW-3', 'FLOW-4', 'FLOW-5'].map((key) =>
      item(key, 'No pull request names this item.'),
    ),
  },
]

it('leads with what the stage holds and opens a group to name its items', () => {
  const onAsk = vi.fn()
  render(
    <CodeReviewPanel
      stage="Code Review"
      groups={groups}
      readyToMergedDays={0.9}
      finishedLinked={12}
      onAsk={onAsk}
    />,
  )
  expect(
    screen.getByText('Most of Code Review has no pull request'),
  ).toBeTruthy()
  expect(screen.queryByText('quiet for a week+')).toBeNull()
  const unreviewed = screen.getByRole('button', { name: /not reviewed yet/ })
  expect(unreviewed).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(unreviewed)
  expect(unreviewed).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('link', { name: /FLOW-1/ })).toHaveAttribute(
    'href',
    'https://jira.example.invalid/browse/FLOW-1',
  )
  expect(screen.getByText('No review yet; ready for 6 days.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Ask AI about/ }))
  expect(onAsk).toHaveBeenCalledWith(
    'FLOW-1: their pull requests are not reviewed yet. Why, and what should happen next?',
  )
  fireEvent.click(unreviewed)
  expect(screen.queryByText('No review yet; ready for 6 days.')).toBeNull()
})

it('says review is quick when it is', () => {
  render(
    <CodeReviewPanel
      stage="Review"
      groups={groups.slice(0, 3)}
      readyToMergedDays={0.9}
      finishedLinked={12}
    />,
  )
  expect(screen.getByText('1 of 2 pull requests is waiting')).toBeTruthy()
  expect(screen.getByText(/review is quick/)).toHaveTextContent(
    'ready to merged in 0.9 days, typical of 12 finished items.',
  )
})
