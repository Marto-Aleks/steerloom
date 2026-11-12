import type { ProgressEvent } from '../progress'

/**
 * Steps users see while a board loads. The server reports them (ids and
 * labels) and the browser lists them, so both read from here. Events carry
 * counts and stage names only, never credentials or item text.
 */
export const BOARD_PROGRESS = {
  board: { step: 'board', label: 'Reading board settings' },
  items: { step: 'items', label: 'Finding items on the board' },
  history: { step: 'history', label: 'Reading status history' },
  done: { step: 'done', label: 'Preparing your briefing' },
} as const

export const BOARD_PROGRESS_STEPS = [
  BOARD_PROGRESS.board,
  BOARD_PROGRESS.items,
  BOARD_PROGRESS.history,
  BOARD_PROGRESS.done,
] as const

export const LARGE_BOARD_DETAIL =
  'Large board: loading items active in the last 12 months'

const format = (value: number) => value.toLocaleString('en')

/** "1,240 found" */
export const foundDetail = (count: number) => `${format(count)} found`

/** "120 of 340 items" */
export const historyDetail = (done: number, total: number) =>
  `${format(done)} of ${format(total)} items`

/**
 * How many items to read between two history updates: at most ~40 updates
 * per board, never more often than every 25 items.
 */
export const progressInterval = (total: number) =>
  Math.max(25, Math.ceil(total / 40))

/** One or more boards loading at once, with the latest event for each. */
export interface BoardLoad {
  /** Where the load started: a saved dashboard or the board picker. */
  source: 'open' | 'select'
  boards: Array<{ name: string; event: ProgressEvent | null; done: boolean }>
}

export function startBoardLoad(
  source: BoardLoad['source'],
  names: string[],
): BoardLoad {
  return {
    source,
    boards: names.map((name) => ({ name, event: null, done: false })),
  }
}

/** Returns a copy with board `index` updated. */
export function updateBoardLoad(
  load: BoardLoad | null,
  index: number,
  change: { event?: ProgressEvent; done?: boolean },
): BoardLoad | null {
  if (!load || !load.boards[index]) return load
  return {
    ...load,
    boards: load.boards.map((board, position) =>
      position === index ? { ...board, ...change } : board,
    ),
  }
}
