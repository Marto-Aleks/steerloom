import { useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import { GlassButton, GlassModal } from '../../components/ui'
import {
  calculateBoardMetrics,
  summarizeBoardSelection,
} from '../../lib/statistics'
import {
  availableSnapshotIssueTypes,
  filterBoardSnapshot,
} from '../../lib/statistics/snapshot-filter'
import type { AnalysisFilters, FlowBoardSnapshot } from '../../types'
import { StagePipeline } from './BoardColumnSelector'
import { ExitWindowField } from './ExitWindowField'
import { IssueTypePicker } from './IssueTypePicker'
import { formatDays } from './format'
import { countItemsByColumn, describeMeasuredStages } from './report-options'

/** "In progress → Review · last 90 days · all item types" */
function measureScopeLabel(
  snapshot: FlowBoardSnapshot,
  filters: AnalysisFilters,
): { stages: string; period: string; types?: string } {
  return {
    stages: describeMeasuredStages(
      snapshot.board.columns,
      filters.selectedColumnIds,
    ),
    period:
      filters.windowDays === null
        ? 'all history'
        : `last ${filters.windowDays} days`,
    types:
      filters.ticketTypes.length === 0
        ? undefined
        : filters.ticketTypes.length <= 2
          ? filters.ticketTypes.join(' and ')
          : `${filters.ticketTypes.length} item types`,
  }
}

/**
 * What the briefing measures, in one line under the headline, so nobody has
 * to wonder what the numbers are based on. With `onChange`, the same choices
 * the setup screen offers open in a sheet over the briefing; the numbers
 * update in place when they are saved.
 */
export function MeasureScope({
  snapshot,
  filters,
  onChange,
  onMoreOptions,
}: {
  snapshot: FlowBoardSnapshot
  filters: AnalysisFilters
  /** Owners and admins: save a new scope. Members see the line only. */
  onChange?: (filters: AnalysisFilters) => void
  /** Opens the full setup screen (presets, target time). */
  onMoreOptions?: () => void
}) {
  const [open, setOpen] = useState(false)
  const label = measureScopeLabel(snapshot, filters)
  return (
    <>
      <p className="measure-scope">
        <UiIcon
          icon={SlidersHorizontal}
          size={16}
          className="measure-scope__icon"
        />
        <span>
          <span className="visually-hidden">Measuring </span>
          <strong>{label.stages}</strong> · {label.period}
          {label.types && ` · ${label.types}`}
        </span>
        {onChange && (
          <button
            type="button"
            className="home-link measure-scope__change"
            onClick={() => setOpen(true)}
          >
            Change
          </button>
        )}
      </p>
      {onChange && open && (
        <ScopeSheet
          snapshot={snapshot}
          filters={filters}
          onClose={() => setOpen(false)}
          onSave={(next) => {
            setOpen(false)
            onChange(next)
          }}
          onMoreOptions={onMoreOptions}
        />
      )}
    </>
  )
}

function ScopeSheet({
  snapshot,
  filters,
  onClose,
  onSave,
  onMoreOptions,
}: {
  snapshot: FlowBoardSnapshot
  filters: AnalysisFilters
  onClose: () => void
  onSave: (filters: AnalysisFilters) => void
  onMoreOptions?: () => void
}) {
  const [draft, setDraft] = useState(filters)
  const ticketTypes = useMemo(
    () => availableSnapshotIssueTypes(snapshot),
    [snapshot],
  )
  // The same live numbers as the setup screen, for the draft.
  const preview = useMemo(() => {
    const loadedAt = new Date(snapshot.loadedAt)
    const asOf = Number.isFinite(loadedAt.getTime()) ? loadedAt : new Date()
    const typeScoped = filterBoardSnapshot(
      snapshot,
      { ...draft, windowDays: null },
      asOf,
    )
    const scoped = filterBoardSnapshot(snapshot, draft, asOf)
    const metrics = calculateBoardMetrics(scoped, draft.selectedColumnIds)
    return {
      itemCounts: countItemsByColumn(typeScoped),
      finished: metrics?.workItemCount ?? 0,
      active: summarizeBoardSelection(typeScoped, draft.selectedColumnIds)
        .workInProgressItemCount,
      median: metrics?.medianCycleTime ?? null,
    }
  }, [snapshot, draft])
  const changed =
    draft.windowDays !== filters.windowDays ||
    draft.selectedColumnIds.join() !== filters.selectedColumnIds.join() ||
    draft.ticketTypes.join() !== filters.ticketTypes.join()
  return (
    <GlassModal
      open
      className="scope-sheet"
      title="What this briefing measures"
      description="The same choices as the setup screen. The numbers update when you save."
      onClose={onClose}
    >
      <div className="scope-sheet__body">
        <section className="scope-sheet__section" aria-label="Stages">
          <p className="field-label">Stages where work happens</p>
          <StagePipeline
            board={snapshot.board}
            selectedColumnIds={draft.selectedColumnIds}
            itemCounts={preview.itemCounts}
            onChange={(selectedColumnIds) =>
              setDraft({ ...draft, selectedColumnIds })
            }
          />
        </section>
        <section className="scope-sheet__section" aria-label="Item types">
          <p className="field-label">Which items count</p>
          <IssueTypePicker
            label="Item types"
            availableTypes={ticketTypes}
            selectedTypes={draft.ticketTypes}
            onChange={(types) => setDraft({ ...draft, ticketTypes: types })}
          />
        </section>
        <section className="scope-sheet__section" aria-label="Period">
          <p className="field-label">Finished within</p>
          <ExitWindowField
            value={draft.windowDays}
            onChange={(windowDays) => setDraft({ ...draft, windowDays })}
          />
        </section>
        <dl className="scope-sheet__numbers" aria-live="polite">
          <div>
            <dt>Finished</dt>
            <dd>{preview.finished.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Active now</dt>
            <dd>{preview.active.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Median cycle time</dt>
            <dd>
              {preview.median === null ? '—' : formatDays(preview.median)}
            </dd>
          </div>
        </dl>
        <div className="scope-sheet__actions">
          {onMoreOptions ? (
            <button
              type="button"
              className="home-link"
              onClick={() => {
                onClose()
                onMoreOptions()
              }}
            >
              Target time and presets
            </button>
          ) : (
            <span />
          )}
          <div className="scope-sheet__buttons">
            <GlassButton variant="quiet" onClick={onClose}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              disabled={!changed || draft.selectedColumnIds.length === 0}
              onClick={() => onSave(draft)}
            >
              Update briefing
            </GlassButton>
          </div>
        </div>
      </div>
    </GlassModal>
  )
}
