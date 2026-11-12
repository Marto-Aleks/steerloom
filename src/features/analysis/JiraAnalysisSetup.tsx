import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import {
  calculateBoardMetrics,
  summarizeBoardSelection,
} from '../../lib/statistics'
import {
  GlassButton,
  GlassInput,
  GlassPanel,
  StatusBadge,
  StatusMessage,
} from '../../components/ui'
import {
  availableSnapshotIssueTypes,
  filterBoardSnapshot,
} from '../../lib/statistics/snapshot-filter'
import { assessDataQuality } from '../../lib/statistics/data-quality'
import { analysisScopeLabel } from '../../lib/statistics/filter'
import type { AnalysisFilters, FlowBoardSnapshot } from '../../types'
import { StagePipeline } from './BoardColumnSelector'
import { DataQualityPanel } from './DataQualityPanel'
import { ExitWindowField } from './ExitWindowField'
import { IssueTypePicker } from './IssueTypePicker'
import { countItemsByColumn, describeMeasuredStages } from './report-options'

interface JiraAnalysisSetupProps {
  snapshot: FlowBoardSnapshot
  filters: AnalysisFilters
  onFiltersChange: (filters: AnalysisFilters) => void
  onBack: () => void
  onContinue: () => void
  canContinue?: boolean
  /** Shown after the stages: how the briefing will be used. */
  briefing?: ReactNode
  /** Extra optional settings, shown inside "More options". */
  moreOptions?: ReactNode
}

export function JiraAnalysisSetup({
  snapshot,
  filters,
  onFiltersChange,
  onBack,
  onContinue,
  canContinue = true,
  briefing,
  moreOptions,
}: JiraAnalysisSetupProps) {
  const providerName = {
    'jira-data-center': 'Jira Data Center',
    'jira-cloud': 'Jira Cloud',
    trello: 'Trello',
    'azure-devops': 'Azure Boards',
    demo: 'Fictional demo',
    'local-transition-csv': 'CSV',
  }[snapshot.source.kind]
  const ticketTypes = useMemo(
    () => availableSnapshotIssueTypes(snapshot),
    [snapshot],
  )
  // Everything below depends only on the board and the scope, so typing in a
  // name or a service expectation must not recompute it.
  const { ticketTypes: scopeTypes, windowDays, selectedColumnIds } = filters
  const derived = useMemo(() => {
    const scope = { ticketTypes: scopeTypes, windowDays, selectedColumnIds }
    const loadedAt = new Date(snapshot.loadedAt)
    const asOf = Number.isFinite(loadedAt.getTime()) ? loadedAt : new Date()
    const typeScopedSnapshot = filterBoardSnapshot(
      snapshot,
      { ...scope, windowDays: null },
      asOf,
    )
    const scopedSnapshot = filterBoardSnapshot(snapshot, scope, asOf)
    const metrics = calculateBoardMetrics(scopedSnapshot, selectedColumnIds)
    return {
      typeScopedSnapshot,
      scopedSnapshot,
      metrics,
      selectionSummary: summarizeBoardSelection(
        typeScopedSnapshot,
        selectedColumnIds,
      ),
      itemCounts: countItemsByColumn(typeScopedSnapshot),
      dataQuality: assessDataQuality(snapshot, scope, asOf, new Date()),
    }
  }, [snapshot, scopeTypes, windowDays, selectedColumnIds])
  const {
    typeScopedSnapshot,
    scopedSnapshot,
    metrics,
    selectionSummary,
    itemCounts,
    dataQuality,
  } = derived
  const issueCount = scopedSnapshot.issues.length
  const completedExitCount = metrics?.workItemCount ?? 0
  const selectedColumnCount = filters.selectedColumnIds.length
  const measuring = describeMeasuredStages(
    snapshot.board.columns,
    filters.selectedColumnIds,
  )
  const scopeLabel = analysisScopeLabel(filters)
  const ready =
    filters.selectedColumnIds.length > 0 &&
    typeScopedSnapshot.issues.length > 0 &&
    dataQuality.status !== 'blocked'
  const periodLabel = filters.windowDays
    ? `Finished in the last ${filters.windowDays} days`
    : 'Finished, all time'

  return (
    <section
      aria-labelledby="mapping-title"
      className="screen-stack setup-flow"
    >
      {snapshot.historyWarnings?.map((warning) => (
        <StatusMessage variant="warning" key={warning}>
          {warning}
        </StatusMessage>
      ))}

      <GlassPanel
        className="setup-stage-panel su-enter"
        elevation="raised"
        aria-labelledby="mapping-title"
      >
        <header className="setup-stage-panel__heading">
          <div className="setup-stage-panel__copy">
            <p className="setup-eyebrow setup-step">
              Step 2 of 3 · Choose what to measure
            </p>
            <h1 id="mapping-title" className="page-title setup-title">
              Which stages count as “in progress”?
            </h1>
            <p id="stage-explanation" className="page-subtitle setup-subtitle">
              Pick every stage from started to done, waiting ones like Review
              too. Steerloom times each item inside them and counts it finished
              when it leaves.
            </p>
          </div>
          <div className="setup-stage-panel__source">
            <span className="metadata-copy">
              {snapshot.board.name} · {snapshot.issues.length.toLocaleString()}{' '}
              {snapshot.issues.length === 1 ? 'item' : 'items'} ·{' '}
              {snapshot.transitions.length.toLocaleString()}{' '}
              {snapshot.transitions.length === 1 ? 'move' : 'moves'}
              {snapshot.source.projectKey && ` · ${snapshot.source.projectKey}`}
              {!snapshot.source.projectKey &&
                snapshot.source.kind !== 'demo' &&
                ` · ${providerName}`}
            </span>
          </div>
        </header>

        <StagePipeline
          board={snapshot.board}
          selectedColumnIds={filters.selectedColumnIds}
          itemCounts={itemCounts}
          describedBy="stage-explanation"
          onChange={(selectedColumnIds) =>
            onFiltersChange({ ...filters, selectedColumnIds })
          }
        />

        <div className="setup-types">
          <div className="setup-types__copy">
            <p className="field-label">Which items count?</p>
            <p className="field-description">
              All types, or only the ones this briefing is about. With none
              chosen, sub-tasks and epics are left out.
            </p>
          </div>
          <IssueTypePicker
            label="Item types"
            availableTypes={ticketTypes}
            selectedTypes={filters.ticketTypes}
            onChange={(ticketTypes) =>
              onFiltersChange({ ...filters, ticketTypes })
            }
          />
        </div>

        <dl
          aria-live="polite"
          aria-atomic="false"
          className="measure-tiles"
          aria-label="Live preview"
        >
          <div className="measure-tile measure-tile--span" data-tone="blue">
            <dt>You are measuring</dt>
            <dd>
              <output
                aria-label="Measured stages"
                className="measure-tile__text"
              >
                {measuring}
              </output>
            </dd>
            <span>
              <StatusBadge tone="info">
                {selectedColumnCount} of {snapshot.board.columns.length} stages
                measured
              </StatusBadge>
            </span>
          </div>
          <MeasureTile
            tone="teal"
            label={periodLabel}
            ariaLabel="Finished in this period"
            value={issueCount}
            detail={`${typeScopedSnapshot.issues.length.toLocaleString()} ${typeScopedSnapshot.issues.length === 1 ? 'item matches' : 'items match'} the item types`}
          />
          <MeasureTile
            tone="violet"
            label="Active right now"
            ariaLabel="Active right now"
            value={selectionSummary.workInProgressItemCount}
            detail={
              <>
                <output aria-label="Reached these stages">
                  {selectionSummary.enteredItemCount.toLocaleString()}
                </output>{' '}
                reached these stages in total
              </>
            }
          />
          <MeasureTile
            tone="blue"
            label="Median cycle time"
            ariaLabel="Median cycle time"
            value={formatDays(metrics?.medianCycleTime)}
            detail={
              <>
                from{' '}
                <output aria-label="Finished journeys">
                  {completedExitCount.toLocaleString()}
                </output>{' '}
                {completedExitCount === 1
                  ? 'finished journey'
                  : 'finished journeys'}
              </>
            }
          />
        </dl>

        {!ready && (
          <StatusMessage variant="warning" className="setup-check">
            {dataQuality.status === 'blocked' && completedExitCount > 0
              ? 'Data checks blocked this briefing. Open the data checks below to see what to fix.'
              : filters.selectedColumnIds.length === 0
                ? 'Pick at least one stage where work happens.'
                : snapshot.issues.length === 0
                  ? 'This board has no items with usable history yet. Add or move work on the board, or choose another board, then refresh.'
                  : typeScopedSnapshot.issues.length === 0
                    ? 'No items match the selected item types.'
                    : issueCount === 0
                      ? `${selectionSummary.enteredItemCount.toLocaleString()} ${selectionSummary.enteredItemCount === 1 ? 'item has' : 'items have'} reached the selected stages, but none finished in this period. Choose a longer period under More options below.`
                      : selectionSummary.enteredItemCount === 0
                        ? `${issueCount.toLocaleString()} ${issueCount === 1 ? 'item matches' : 'items match'} this scope, but none has reached the selected stages.`
                        : `${selectionSummary.enteredItemCount.toLocaleString()} ${selectionSummary.enteredItemCount === 1 ? 'item has' : 'items have'} reached the selection, but none has finished it yet. ${selectionSummary.workInProgressItemCount.toLocaleString()} ${selectionSummary.workInProgressItemCount === 1 ? 'is' : 'are'} inside now.`}
          </StatusMessage>
        )}

        <DataQualityPanel
          report={dataQuality}
          fixes={['window']}
          onFix={(fix) => {
            if (fix.kind === 'window')
              onFiltersChange({ ...filters, windowDays: fix.days })
          }}
        />
      </GlassPanel>

      {briefing}

      <details className="workspace-disclosure setup-more">
        <summary>
          <span className="setup-more__label">More options</span>
          <span className="setup-more__hint">
            Period, target time, dashboard name and metrics
          </span>
          <UiIcon icon={ChevronDown} className="setup-more__chevron" />
        </summary>
        <GlassPanel
          className="setup-refine-panel"
          aria-labelledby="refine-title"
        >
          <div className="setup-refine-panel__heading">
            <div>
              <h2 id="refine-title" className="section-title">
                Fine-tune the briefing
              </h2>
              <p className="metadata-copy mt-1">{scopeLabel}</p>
            </div>
          </div>
          <div className="refine-grid">
            <div className="field-group">
              <div>
                <p className="field-label">Finished within</p>
                <p className="field-description">
                  Which finished work the briefing looks at.
                </p>
              </div>
              <ExitWindowField
                value={filters.windowDays}
                onChange={(windowDays) =>
                  onFiltersChange({ ...filters, windowDays })
                }
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="service-expectation-days">
                Target time in days
              </label>
              <p className="field-description" id="service-expectation-help">
                Your team’s agreed limit for how long an item should take. Leave
                empty if you don’t have one.
              </p>
              <GlassInput
                id="service-expectation-days"
                type="number"
                min="1"
                max="3650"
                step="any"
                aria-describedby="service-expectation-help"
                placeholder="Not configured"
                value={filters.serviceExpectation?.days ?? ''}
                onChange={(event) => {
                  const days = event.target.valueAsNumber
                  const { serviceExpectation: previous, ...rest } = filters
                  onFiltersChange(
                    Number.isFinite(days) && days > 0 && days <= 3650
                      ? {
                          ...rest,
                          serviceExpectation: {
                            days,
                            targetPercent: previous?.targetPercent ?? 85,
                          },
                        }
                      : rest,
                  )
                }}
              />
              {filters.serviceExpectation && (
                <>
                  <label
                    className="field-label"
                    htmlFor="service-expectation-percent"
                  >
                    Share of items that should meet it (%)
                  </label>
                  <GlassInput
                    id="service-expectation-percent"
                    type="number"
                    min="1"
                    max="100"
                    step="any"
                    value={filters.serviceExpectation.targetPercent}
                    onChange={(event) => {
                      const targetPercent = event.target.valueAsNumber
                      if (
                        Number.isFinite(targetPercent) &&
                        targetPercent > 0 &&
                        targetPercent <= 100 &&
                        filters.serviceExpectation
                      )
                        onFiltersChange({
                          ...filters,
                          serviceExpectation: {
                            ...filters.serviceExpectation,
                            targetPercent,
                          },
                        })
                    }}
                  />
                </>
              )}
            </div>
          </div>
          {moreOptions}
        </GlassPanel>
      </details>

      <div className="screen-actions setup-actions">
        <p className="setup-progress">
          <span className="setup-progress__track" aria-hidden="true">
            <span data-state="done" />
            <span data-state="current" />
            <span />
          </span>
          <span>
            <strong>Step 2 of 3</strong>
            <span className="setup-progress__detail">
              {' '}
              · {selectedColumnCount} of {snapshot.board.columns.length} stages
              measured
            </span>
          </span>
        </p>
        <div className="setup-actions__buttons">
          <GlassButton variant="secondary" onClick={onBack}>
            Choose another board
          </GlassButton>
          <GlassButton
            variant="primary"
            disabled={!ready || !canContinue}
            onClick={onContinue}
          >
            Build my briefing
          </GlassButton>
        </div>
      </div>
    </section>
  )
}

function MeasureTile({
  label,
  ariaLabel,
  value,
  detail,
  tone,
}: {
  label: string
  ariaLabel: string
  value: number | string
  detail?: ReactNode
  tone: 'blue' | 'teal' | 'violet'
}) {
  const text = typeof value === 'number' ? value.toLocaleString() : value
  return (
    <div className="measure-tile" data-tone={tone}>
      <dt>{label}</dt>
      <dd>
        <output aria-label={ariaLabel} className="measure-tile__value">
          {text}
        </output>
      </dd>
      {detail && <span>{detail}</span>}
    </div>
  )
}

function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1)
  return `${formatted} ${value === 1 ? 'day' : 'days'}`
}
