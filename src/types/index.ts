export type DataRow = Record<string, string>

export interface ImportedDataset {
  filename: string
  rows: DataRow[]
  columns: string[]
  delimiter: string
  importedAt: string
}

export interface FlowColumnMapping {
  itemId: string
  itemType: string
  createdDate: string
  status: string
  transitionDate: string
}

export interface ServiceExpectation {
  days: number
  targetPercent: number
}

export interface AnalysisFilters {
  serviceExpectation?: ServiceExpectation
  ticketTypes: string[]
  windowDays: number | null
  selectedColumnIds: string[]
}

export type FlowSourceKind =
  | 'local-transition-csv'
  | 'jira-data-center'
  | 'jira-cloud'
  | 'trello'
  | 'azure-devops'
  | 'demo'

export interface FlowSourceDescriptor {
  kind: FlowSourceKind
  label: string
  connectionId?: string
  projectKey?: string
}

export interface FlowStatus {
  id: string
  name: string
  /** The provider's own category, when it has one (Jira status categories). */
  category?: 'todo' | 'in-progress' | 'done'
}

export interface FlowBoardColumn {
  id: string
  name: string
  statusIds: string[]
}

export interface FlowBoard {
  id: string
  name: string
  columns: FlowBoardColumn[]
  statuses: FlowStatus[]
}

export interface FlowIssue {
  id: string
  key: string
  issueTypeId: string
  issueTypeName: string
  createdAt: string
  browseUrl?: string
  /** The item's summary or card name, shown on hover; never sent to the AI. */
  title?: string
  /**
   * Who holds the item now (Jira assignee, first Trello member, Azure DevOps
   * Assigned To). Absent when nobody does; ownerKnown tells the two apart.
   */
  assignee?: string
  /** The source reports ownership for this item, so a missing assignee means unowned. */
  ownerKnown?: boolean
  archived?: boolean
  /** Jira resolution name, such as "Done" or "Won't Do" (Azure Boards: "Removed"). */
  resolution?: string
  /** Set for items that are parts or containers of other work. */
  hierarchy?: 'subtask' | 'epic'
}

export interface FlowTransition {
  issueId: string
  statusId: string
  enteredAt: string
}

export interface FlowBoardSnapshot {
  source: FlowSourceDescriptor
  board: FlowBoard
  issues: FlowIssue[]
  transitions: FlowTransition[]
  loadedAt: string
  historyWarnings?: string[]
}

export interface JiraBoardOption {
  id: string
  name: string
  type: string
}

export interface ThroughputPoint {
  week: string
  items: number
}

export interface CycleTimePoint {
  item: string
  browseUrl?: string
  title?: string
  cycleTime: number
  sequence: number
  cycleStart: string
  cycleEnd: string
  completedLabel: string
}

export interface CycleTimeTrendPoint {
  week: string
  completedItemCount: number
  rollingItemCount: number
  rollingMedianCycleTime: number | null
  rollingPercentile85CycleTime: number | null
}

export interface WorkInProgressAgePoint {
  item: string
  browseUrl?: string
  title?: string
  ageInSelectedColumns: number
  currentStatus: string
  /** A longer explanation of the status, shown on hover (from GitHub). */
  statusDetail?: string
}

export interface DistributionPoint {
  range: string
  items: number
  share: number
  cumulativeShare: number
  containsPercentile85: boolean
}

export interface FlowMetrics {
  uniqueItemCount: number
  validTransitionCount: number
  workItemCount: number
  cycleTimeItemCount: number
  medianCycleTime: number | null
  percentile85CycleTime: number | null
  weeklyThroughput: ThroughputPoint[]
  cycleTimes: CycleTimePoint[]
  distribution: DistributionPoint[]
  explanation: string
}

export interface BoardSelectionSummary {
  enteredItemCount: number
  workInProgressItemCount: number
  selectedTransitionCount: number
}
