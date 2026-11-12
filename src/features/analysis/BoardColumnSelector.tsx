import { Check } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import type { CSSProperties } from 'react'
import { GlassPanel, StatusBadge } from '../../components/ui'
import type { FlowBoard } from '../../types'

export type StageProvenance = 'inferred' | 'jira' | 'trello' | 'demo'

interface StagePipelineProps {
  board: FlowBoard
  selectedColumnIds: string[]
  /** Live items currently in each column, keyed by column id. */
  itemCounts?: Record<string, number>
  onChange: (columnIds: string[]) => void
  describedBy?: string
}

/**
 * The board's columns as a clickable pipeline. Each stage is a toggle button;
 * the connector between two consecutive selected stages lights up so the
 * measured span reads as one continuous flow.
 */
export function StagePipeline({
  board,
  selectedColumnIds,
  itemCounts,
  onChange,
  describedBy,
}: StagePipelineProps) {
  const toggleColumn = (columnId: string) => {
    const selected = selectedColumnIds.includes(columnId)
      ? selectedColumnIds.filter((value) => value !== columnId)
      : [...selectedColumnIds, columnId]
    onChange(selected)
  }
  const last = board.columns.length - 1

  return (
    <ol
      aria-label="Board columns in workflow order"
      aria-describedby={describedBy}
      className="stage-pipeline"
    >
      {board.columns.map((column, index) => {
        const selected = selectedColumnIds.includes(column.id)
        const nextSelected =
          index < last &&
          selectedColumnIds.includes(board.columns[index + 1]!.id)
        const count = itemCounts?.[column.id]
        return (
          <li
            key={column.id}
            className="stage-pipeline__item"
            style={{ '--su-i': Math.min(index, 8) } as CSSProperties}
          >
            <button
              type="button"
              aria-pressed={selected}
              className="stage-card su-enter"
              onClick={() => toggleColumn(column.id)}
            >
              <span className="stage-card__tag">
                {selected ? 'Measured' : 'Not measured'}
              </span>
              <strong className="stage-card__name">{column.name}</strong>
              {count !== undefined && (
                <span className="stage-card__meta">
                  {count.toLocaleString()} {count === 1 ? 'item' : 'items'} now
                </span>
              )}
              <span aria-hidden="true" className="stage-card__check">
                <UiIcon icon={Check} size={16} />
              </span>
            </button>
            {index < last && (
              <span
                aria-hidden="true"
                className="stage-link"
                data-on={selected && nextSelected}
              >
                {selected && nextSelected && <span className="sl-packet" />}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

interface BoardColumnSelectorProps {
  board: FlowBoard
  selectedColumnIds: string[]
  provenance: StageProvenance
  itemCounts?: Record<string, number>
  onChange: (columnIds: string[]) => void
}

/** Framed variant with its own heading, used by the CSV mapping step. */
export function BoardColumnSelector({
  board,
  selectedColumnIds,
  provenance,
  itemCounts,
  onChange,
}: BoardColumnSelectorProps) {
  return (
    <GlassPanel
      className="board-selector"
      elevation="raised"
      aria-labelledby="board-column-title"
    >
      <div className="panel-heading">
        <div>
          <h2 id="board-column-title" className="section-title">
            Which stages count as “in progress”?
          </h2>
        </div>
        <StatusBadge tone="info">
          {
            {
              jira: 'From Jira board',
              trello: 'From Trello lists',
              demo: 'Fictional workflow',
              inferred: 'Inferred from CSV',
            }[provenance]
          }
        </StatusBadge>
      </div>
      <div className="panel-body">
        <p id="board-column-explanation" className="body-copy max-w-3xl">
          Pick every stage from started to done, waiting ones like Review too.
          Steerloom times each item inside them and counts it finished when it
          moves past the last one. A stage you skip in between, such as Blocked,
          pauses the clock; moving back to an earlier stage is not finished.
        </p>
        <StagePipeline
          board={board}
          selectedColumnIds={selectedColumnIds}
          itemCounts={itemCounts}
          onChange={onChange}
          describedBy="board-column-explanation"
        />
        <div className="selection-definition surface-inset">
          <p>
            <strong>Cycle time:</strong> total time spent in the selected
            stages, including re-entry.
          </p>
          <p>
            <strong>Throughput:</strong> each item is counted once, when it most
            recently moved past the selected stages. Items closed as Won’t Do or
            Duplicate are not counted.
          </p>
        </div>
      </div>
    </GlassPanel>
  )
}
