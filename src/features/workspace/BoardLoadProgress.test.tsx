import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProgressStatus } from '../../components/ui'
import {
  BOARD_PROGRESS_STEPS,
  startBoardLoad,
  updateBoardLoad,
} from '../../lib/workspace/board-progress'
import { BoardLoadProgress } from './BoardLoadProgress'

afterEach(cleanup)

describe('ProgressStatus', () => {
  it('shows the current step, its detail and a bar when the total is known', () => {
    render(
      <ProgressStatus
        steps={BOARD_PROGRESS_STEPS}
        event={{
          type: 'progress',
          step: 'history',
          label: 'Reading status history',
          detail: '120 of 340 items',
          done: 120,
          total: 340,
        }}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reading status history',
    )
    expect(screen.getByText('120 of 340 items')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '120')
    expect(bar).toHaveAttribute('aria-valuemax', '340')
    expect(
      screen.getByText('Reading board settings').closest('li'),
    ).toHaveAttribute('data-state', 'done')
    expect(
      screen.getByText('Preparing your briefing').closest('li'),
    ).toHaveAttribute('data-state', 'next')
  })

  it('starts on the first step before any event arrives', () => {
    render(<ProgressStatus steps={BOARD_PROGRESS_STEPS} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute(
      'data-state',
      'current',
    )
  })
})

describe('BoardLoadProgress', () => {
  it('follows the first unfinished board and names it when several load', () => {
    let load = startBoardLoad('select', [
      'Fictional product',
      'Fictional platform',
      'Fictional data',
    ])
    load = updateBoardLoad(load, 0, { done: true })!
    load = updateBoardLoad(load, 1, {
      event: {
        type: 'progress',
        step: 'items',
        label: 'Finding items on the board',
        detail: '1,240 found',
      },
    })!
    render(<BoardLoadProgress load={load} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Finding items on the board',
    )
    expect(
      screen.getByText('Board 2 of 3 · Fictional platform · 1,240 found'),
    ).toBeInTheDocument()
  })
})
