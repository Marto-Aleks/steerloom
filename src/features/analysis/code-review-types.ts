/* The code view's groups, shared by the panel and dashboard-evidence.ts. */

/** One item in a group: its key, where to open it, and the full sentence. */
export interface CodeReviewItem {
  key: string
  detail: string
  browseUrl?: string
  /** Colours this item's chip by its own state instead of its group's. */
  tone?: 'alive' | 'quiet' | 'waiting'
  /** The board and the code disagree about this item: the chip is ringed. */
  mismatch?: boolean
}

/** What GitHub says about the items sitting in a review stage today. */
export interface CodeReviewGroup {
  id:
    | 'moving'
    | 'unreviewed'
    | 'quiet'
    | 'done'
    | 'none'
    | 'nocode'
    | 'coding'
    | 'review'
    | 'approved'
    | 'merged'
  label: string
  items: CodeReviewItem[]
}
