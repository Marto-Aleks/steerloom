import type { AnalysisFilters } from '../../types'
import { isServiceExpectation } from '../statistics/service-expectation'

export type ProviderId = 'jira' | 'trello' | 'azure-devops' | 'demo'
export const metricCatalog = [
  {
    id: 'completed-observations',
    name: 'Completed work',
    description: 'Items that exited your measured workflow.',
  },
  {
    id: 'median-cycle-time',
    name: 'Cycle time',
    description: 'Median time in your selected workflow stages.',
  },
  {
    id: 'percentile-85',
    name: 'Historical P85',
    description: 'Time within which 85% of observations completed.',
  },
  {
    id: 'exit-throughput',
    name: 'Throughput',
    description: 'Completed work per week and weekly volume.',
  },
  {
    id: 'aging-wip',
    name: 'Aging work',
    description: 'Current work and items older than the completed P85.',
  },
  {
    id: 'cycle-trend',
    name: 'Delivery trends',
    description: 'Rolling cycle time and period comparisons.',
  },
] as const
export type DashboardMetric = (typeof metricCatalog)[number]['id']
export type ReviewMode = 'daily' | 'weekly' | 'custom'
export const reviewPresets = [
  {
    id: 'daily',
    name: 'Daily review',
    description: 'What’s late or stuck today, and who to talk to.',
    focus: 'Aging work · pace',
    windowDays: 90,
    metrics: ['aging-wip', 'percentile-85', 'exit-throughput'],
  },
  {
    id: 'weekly',
    name: 'Weekly review',
    description: 'How delivery is trending, week on week.',
    focus: 'Trends · cycle time',
    windowDays: 90,
    metrics: [
      'completed-observations',
      'median-cycle-time',
      'percentile-85',
      'exit-throughput',
      'cycle-trend',
    ],
  },
] as const satisfies ReadonlyArray<{
  id: ReviewMode
  name: string
  description: string
  /** What the card says it shows; both reviews read the same history. */
  focus: string
  windowDays: number
  metrics: readonly DashboardMetric[]
}>

export function applyReviewPreset(
  dashboard: SavedDashboard,
  presetId: 'daily' | 'weekly',
): SavedDashboard {
  const preset = reviewPresets.find((item) => item.id === presetId)!
  return {
    ...dashboard,
    reviewMode: preset.id,
    metrics: [...preset.metrics],
    filters: { ...dashboard.filters, windowDays: preset.windowDays },
  }
}
export const defaultMetrics: DashboardMetric[] = metricCatalog.map(
  (metric) => metric.id,
)

export interface WorkspaceConnection {
  jiraEdition?: 'cloud' | 'data-center'
  id: string
  name: string
  provider: Exclude<ProviderId, 'demo'>
  projectKey?: string
}
export interface WorkspaceBoard {
  shortLink?: string
  id: string
  name: string
}
export interface SavedDashboard {
  id: string
  name: string
  connectionId: string
  provider: ProviderId
  boardId: string
  projectKey?: string
  filters: AnalysisFilters
  metrics: DashboardMetric[]
  reviewMode?: ReviewMode
  /** Facts the team wrote for Steerloom AI, added to every answer for this board. */
  teamNotes?: string
  /** Figma file keys whose branches and links name this board's items. */
  figmaFiles?: string[]
}

/** At most this many Figma files per dashboard. */
export const FIGMA_FILE_LIMIT = 10
const FIGMA_FILE_KEY = /^[A-Za-z0-9]{10,64}$/

export function isFigmaFileKey(value: unknown): value is string {
  return typeof value === 'string' && FIGMA_FILE_KEY.test(value)
}

/**
 * Figma links or bare file keys, as pasted; a branch link names its main
 * file. Anything else is dropped.
 */
export function parseFigmaFiles(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((entry) => {
          const link =
            /figma\.com\/(?:file|design|proto|board|slides)\/([A-Za-z0-9]+)/i.exec(
              entry,
            )
          return link ? link[1]! : entry.trim()
        })
        .filter(isFigmaFileKey),
    ),
  ].slice(0, FIGMA_FILE_LIMIT)
}

/** At most this many repositories per workspace GitHub connection. */
export const REPOSITORY_LIMIT = 10
const REPOSITORY = /^[\w.-]{1,100}\/[\w.-]{1,100}$/

/**
 * "acme/web, acme/api", one per line, or pasted links, as typed. Entries
 * that are not "owner/name" come back in `invalid`, so they can be named.
 */
export function readRepositoryList(text: string): {
  repositories: string[]
  invalid: string[]
} {
  const entries = text
    .split(/[\s,]+/)
    .map((entry) =>
      entry
        .trim()
        .replace(/^https?:\/\/[^/]+\//i, '')
        .replace(/\.git$|\/+$/g, '')
        // A link may continue past the repository: /pulls, /tree/main …
        .replace(/^([\w.-]+\/[\w.-]+)\/.*$/, '$1'),
    )
    .filter(Boolean)
  return {
    repositories: [
      ...new Set(entries.filter((entry) => REPOSITORY.test(entry))),
    ],
    invalid: entries.filter((entry) => !REPOSITORY.test(entry)),
  }
}

/** Team notes stay short: a few facts, not a document. */
export const TEAM_NOTES_LIMIT = 600
export type AiProvider = 'anthropic' | 'openai' | 'custom'

/** Public description of the workspace AI key; the key itself never leaves the server. */
export interface WorkspaceAiSettings {
  provider: AiProvider
  model: string
  /** Host of a custom endpoint, shown so owners can recognise it. */
  endpointHost?: string
}

/** Where the team's GitHub is; the token stays on the server. */
/** What the last save found in one repository. */
export interface GithubRepositoryCheck {
  name: string
  /** Pull requests updated in the last year. */
  read: number
  /** Of those, how many name an item key in their title or branch. */
  linked: number
}

export interface WorkspaceGithubSettings {
  host: string
  /** "owner/name", as GitHub spells them. Every dashboard reads these. */
  repositories: string[]
  /** When the repositories were last checked, and what was found. */
  checkedAt?: string
  checks?: GithubRepositoryCheck[]
  /** A classic token (full repo access on GitHub's side; Steerloom only reads). */
  classic?: boolean
  /** When the token stops working, as an ISO date. */
  expiresAt?: string
}

/** Figma is connected; the token stays on the server. */
export interface WorkspaceFigmaSettings {
  connected: true
}

export interface WorkspaceSession {
  workspaceId?: string
  workspaceRole?: 'owner' | 'admin' | 'member'
  user: {
    id: string
    username: string
    googleLinked?: boolean
    googleEmail?: string
  }
  needsWorkspaceName?: boolean
  workspaceName: string
  connections: WorkspaceConnection[]
  dashboards: SavedDashboard[]
  ai?: WorkspaceAiSettings
  github?: WorkspaceGithubSettings
  figma?: WorkspaceFigmaSettings
}

export function readDashboard(value: unknown): SavedDashboard {
  if (!value || typeof value !== 'object') throw new Error('Invalid dashboard.')
  const item = value as Record<string, unknown>
  const filters = item.filters as Record<string, unknown> | undefined
  const strings = (input: unknown): input is string[] =>
    Array.isArray(input) &&
    input.length <= 100 &&
    input.every((entry) => typeof entry === 'string' && entry.length <= 200)
  if (
    typeof item.id !== 'string' ||
    !/^[\w:-]{1,150}$/.test(item.id) ||
    typeof item.name !== 'string' ||
    !item.name.trim() ||
    item.name.length > 150 ||
    (item.reviewMode !== undefined &&
      !['daily', 'weekly', 'custom'].includes(String(item.reviewMode))) ||
    (item.teamNotes !== undefined &&
      (typeof item.teamNotes !== 'string' ||
        item.teamNotes.length > TEAM_NOTES_LIMIT)) ||
    (item.figmaFiles !== undefined &&
      (!Array.isArray(item.figmaFiles) ||
        item.figmaFiles.length > FIGMA_FILE_LIMIT ||
        !item.figmaFiles.every(isFigmaFileKey))) ||
    !['jira', 'trello', 'azure-devops', 'demo'].includes(
      String(item.provider),
    ) ||
    typeof item.connectionId !== 'string' ||
    item.connectionId.length > 100 ||
    typeof item.boardId !== 'string' ||
    !/^[\w:-]{1,150}$/.test(item.boardId) ||
    (item.projectKey !== undefined &&
      (typeof item.projectKey !== 'string' ||
        !/^[A-Z][A-Z0-9_]{1,29}$/.test(item.projectKey))) ||
    !filters ||
    (filters.serviceExpectation !== undefined &&
      !isServiceExpectation(filters.serviceExpectation)) ||
    !strings(filters.ticketTypes) ||
    !strings(filters.selectedColumnIds) ||
    !(
      filters.windowDays === null ||
      (typeof filters.windowDays === 'number' &&
        Number.isInteger(filters.windowDays) &&
        filters.windowDays > 0 &&
        filters.windowDays <= 3650)
    ) ||
    !Array.isArray(item.metrics) ||
    item.metrics.length === 0 ||
    !item.metrics.every((id) =>
      metricCatalog.some((metric) => metric.id === id),
    )
  ) {
    throw new Error('Check the dashboard name, workflow, period, and metrics.')
  }
  return {
    id: item.id,
    name: item.name.trim(),
    connectionId: item.connectionId,
    provider: item.provider as ProviderId,
    boardId: item.boardId,
    ...(item.projectKey ? { projectKey: item.projectKey as string } : {}),
    filters: {
      ...(isServiceExpectation(filters.serviceExpectation)
        ? {
            serviceExpectation: {
              days: filters.serviceExpectation.days,
              targetPercent: filters.serviceExpectation.targetPercent,
            },
          }
        : {}),
      ticketTypes: [...filters.ticketTypes],
      selectedColumnIds: [...filters.selectedColumnIds],
      windowDays: filters.windowDays as number | null,
    },
    metrics: [...new Set(item.metrics)] as DashboardMetric[],
    ...(item.reviewMode ? { reviewMode: item.reviewMode as ReviewMode } : {}),
    ...(typeof item.teamNotes === 'string' && item.teamNotes.trim()
      ? { teamNotes: item.teamNotes.trim() }
      : {}),
    ...(Array.isArray(item.figmaFiles) && item.figmaFiles.length
      ? { figmaFiles: [...(item.figmaFiles as string[])] }
      : {}),
  }
}
