import { ProgressStatus } from '../../components/ui'
import type { ProgressEvent } from '../../lib/progress'
import {
  BOARD_PROGRESS_STEPS,
  type BoardLoad,
} from '../../lib/workspace/board-progress'

/**
 * Shows the first board that is still loading, so parallel loads read as one
 * calm sequence: "Board 2 of 3 · Platform · 120 of 340 items".
 */
export function BoardLoadProgress({ load }: { load: BoardLoad }) {
  const count = load.boards.length
  const index = Math.max(
    0,
    load.boards.findIndex((board) => !board.done),
  )
  const current = load.boards[index]
  const prefix =
    count > 1 && current
      ? `Board ${index + 1} of ${count} · ${current.name}`
      : ''
  const event = current?.event ?? null
  const detail = [prefix, event?.detail].filter(Boolean).join(' · ')
  const shown: ProgressEvent | null = event
    ? { ...event, ...(detail ? { detail } : {}) }
    : detail
      ? {
          type: 'progress',
          ...BOARD_PROGRESS_STEPS[0],
          detail,
        }
      : null
  return (
    <ProgressStatus
      className="board-load-progress"
      steps={BOARD_PROGRESS_STEPS}
      event={shown}
    />
  )
}
