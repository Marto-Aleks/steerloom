import type { CSSProperties } from 'react'

export interface BoardViewColumn {
  id: string
  name: string
  /** Short note under the name, such as "2 reviewers". */
  meta?: string
  /** Cards not shown, summarised as "+N more". */
  hiddenCount?: number
}

export type BoardItemState = 'calm' | 'aging' | 'risk'

export interface BoardViewItem {
  key: string
  title: string
  column: string
  owner: string
  /** Days in the measured stages; omitted for work not started or finished. */
  ageDays?: number
  state?: BoardItemState
  /** A status badge on the card, such as "At risk" or "Rework". */
  badge?: { label: string; tone: 'warn' | 'risk' }
}

export interface BoardViewProps {
  columns: BoardViewColumn[]
  items: BoardViewItem[]
  /** A column that glows (the agent is looking at it). */
  litColumn?: string
  /** Items raised above the board, with their age shown. */
  liftedItems?: string[]
  /** Items brightened briefly by a passing scan. */
  brightItems?: string[]
  /** 0–1: how far the board recedes (dims) behind other content. */
  recede?: number
  /** Per-item inline styles, for motion overlays (offsets, scale). */
  itemStyles?: Record<string, CSSProperties>
  /** Per-column inline styles (clip, glow), keyed by column id. */
  columnStyles?: Record<string, CSSProperties>
  style?: CSSProperties
  className?: string
}

/**
 * A team board as Steerloom reads it: columns in order, one card per item
 * with its owner and age. Purely presentational; colour carries status
 * (orange aging, red at risk) and every state also has a text label.
 * Elements carry data-board-column / data-board-item for overlays such as
 * the Steerloom agent.
 */
export function BoardView({
  columns,
  items,
  litColumn,
  liftedItems = [],
  brightItems = [],
  recede = 0,
  itemStyles = {},
  columnStyles = {},
  style,
  className,
}: BoardViewProps) {
  return (
    <div
      className={`board-view${className ? ` ${className}` : ''}`}
      style={{ ...style, '--board-recede': recede } as CSSProperties}
    >
      {columns.map((column) => {
        const cards = items.filter((item) => item.column === column.id)
        return (
          <section
            key={column.id}
            className="board-view__column"
            data-board-column={column.id}
            data-lit={litColumn === column.id ? 'true' : undefined}
            style={columnStyles[column.id]}
            aria-label={`${column.name}: ${cards.length + (column.hiddenCount ?? 0)} items`}
          >
            <header className="board-view__head">
              <h3>{column.name}</h3>
              <span className="board-view__count">
                {cards.length + (column.hiddenCount ?? 0)}
              </span>
              {column.meta && (
                <span className="board-view__meta">{column.meta}</span>
              )}
            </header>
            <ul className="board-view__cards">
              {cards.map((item) => (
                <li
                  key={item.key}
                  className="board-card"
                  data-board-item={item.key}
                  data-state={item.state ?? 'calm'}
                  data-lifted={
                    liftedItems.includes(item.key) ? 'true' : undefined
                  }
                  data-bright={
                    brightItems.includes(item.key) ? 'true' : undefined
                  }
                  style={itemStyles[item.key]}
                >
                  <span className="board-card__top">
                    <span className="board-card__owner" aria-label="Owner">
                      {item.owner}
                    </span>
                    <span className="board-card__key">{item.key}</span>
                    {item.badge && (
                      <span
                        className="board-card__badge"
                        data-tone={item.badge.tone}
                      >
                        {item.badge.label}
                      </span>
                    )}
                    {item.ageDays !== undefined && (
                      <span className="board-card__age">
                        {item.ageDays}d
                        <span className="sr-only"> in progress</span>
                      </span>
                    )}
                  </span>
                  <span className="board-card__title">{item.title}</span>
                </li>
              ))}
              {column.hiddenCount ? (
                <li className="board-view__more">+{column.hiddenCount} more</li>
              ) : null}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
