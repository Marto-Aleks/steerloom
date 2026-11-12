import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisFilters, FlowBoardSnapshot } from '../../types'
import { JiraAnalysisSetup } from './JiraAnalysisSetup'

const snapshot: FlowBoardSnapshot = {
  source: {
    kind: 'jira-data-center',
    label: 'Fictional board',
    projectKey: 'DEMO',
  },
  board: {
    id: 'board-1',
    name: 'Fictional board',
    statuses: [
      { id: 'progress', name: 'In Progress' },
      { id: 'done', name: 'Done' },
    ],
    columns: [
      {
        id: 'progress-column',
        name: 'In Progress',
        statusIds: ['progress'],
      },
      { id: 'done-column', name: 'Done', statusIds: ['done'] },
    ],
  },
  issues: [
    {
      id: 'story-recent',
      key: 'DEMO-1',
      issueTypeId: 'story',
      issueTypeName: 'User Story',
      createdAt: '2026-07-01T09:00:00Z',
    },
    {
      id: 'story-old',
      key: 'DEMO-2',
      issueTypeId: 'story',
      issueTypeName: 'User Story',
      createdAt: '2026-01-01T09:00:00Z',
    },
    {
      id: 'bug-recent',
      key: 'DEMO-3',
      issueTypeId: 'bug',
      issueTypeName: 'Bug',
      createdAt: '2026-07-10T09:00:00Z',
    },
  ],
  transitions: [
    {
      issueId: 'story-recent',
      statusId: 'progress',
      enteredAt: '2026-07-02T09:00:00Z',
    },
    {
      issueId: 'story-recent',
      statusId: 'done',
      enteredAt: '2026-07-04T09:00:00Z',
    },
    {
      issueId: 'story-old',
      statusId: 'progress',
      enteredAt: '2026-01-02T09:00:00Z',
    },
    {
      issueId: 'story-old',
      statusId: 'done',
      enteredAt: '2026-01-04T09:00:00Z',
    },
    {
      issueId: 'bug-recent',
      statusId: 'progress',
      enteredAt: '2026-07-11T09:00:00Z',
    },
    {
      issueId: 'bug-recent',
      statusId: 'done',
      enteredAt: '2026-07-13T09:00:00Z',
    },
  ],
  loadedAt: '2026-07-24T10:00:00Z',
}

const initialFilters: AnalysisFilters = {
  ticketTypes: [],
  windowDays: null,
  selectedColumnIds: ['progress-column'],
}

function SetupHarness({ board = snapshot }: { board?: FlowBoardSnapshot }) {
  const [filters, setFilters] = useState(initialFilters)
  return (
    <JiraAnalysisSetup
      snapshot={board}
      filters={filters}
      onFiltersChange={setFilters}
      onBack={() => undefined}
      onContinue={() => undefined}
    />
  )
}

describe('Jira report setup filters', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-24T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('updates the live cohort, column, and exit counts immediately', () => {
    render(<SetupHarness />)

    const matchingTickets = screen.getByLabelText('Finished in this period')
    const enteredSelection = screen.getByLabelText('Reached these stages')
    const completedExits = screen.getByLabelText('Finished journeys')
    const medianCycleTime = screen.getByLabelText('Median cycle time')

    expect(
      screen.getByRole('region', { name: 'Data checks' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Items on the board')).toHaveTextContent('3')
    // Three finished items: too few to rely on, said in plain words.
    expect(screen.getByText('Weak data')).toBeInTheDocument()
    expect(screen.getByText('Few finished items')).toBeInTheDocument()
    expect(matchingTickets).toHaveTextContent('3')
    expect(enteredSelection).toHaveTextContent('3')
    expect(completedExits).toHaveTextContent('3')
    expect(medianCycleTime).toHaveTextContent('2 days')

    fireEvent.change(screen.getByLabelText('Exited within'), {
      target: { value: '60' },
    })
    expect(matchingTickets).toHaveTextContent('2')
    expect(enteredSelection).toHaveTextContent('3')
    expect(completedExits).toHaveTextContent('2')

    fireEvent.click(screen.getByLabelText('User Story'))
    expect(matchingTickets).toHaveTextContent('1')
    expect(enteredSelection).toHaveTextContent('2')
    expect(completedExits).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: /In Progress/ }))
    expect(matchingTickets).toHaveTextContent('0')
    expect(enteredSelection).toHaveTextContent('0')
    expect(completedExits).toHaveTextContent('0')
    expect(medianCycleTime).toHaveTextContent('—')
    expect(screen.getByText('0 of 2 stages measured')).toBeInTheDocument()
  })

  it('explains an empty board instead of blaming the issue-type filter', () => {
    render(
      <SetupHarness board={{ ...snapshot, issues: [], transitions: [] }} />,
    )

    expect(
      screen.getByText(/This board has no items with usable history yet/),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('No items match the selected item types.'),
    ).not.toBeInTheDocument()
  })
})
