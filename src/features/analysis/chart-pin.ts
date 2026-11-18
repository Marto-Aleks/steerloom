/* Freezing a chart's hover tooltip where it was drawn: shared by the charts. */

/** A frozen tooltip: which bar, and where the hover tooltip was drawn. */
export interface Pin {
  key: string
  x: number
  y: number
}

/**
 * Where to freeze the tooltip: exactly where Recharts drew the hover one,
 * read from its wrapper; or, without one (keyboard), beside the click.
 */
export function pinAt(
  key: string,
  plot: HTMLDivElement | null,
  event: unknown,
): Pin {
  const wrapper = plot?.querySelector<HTMLElement>('.recharts-tooltip-wrapper')
  const match = /translate(?:3d)?\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(
    wrapper?.style.transform ?? '',
  )
  if (match && wrapper?.style.visibility !== 'hidden')
    return { key, x: Number(match[1]), y: Number(match[2]) }
  const box = plot?.getBoundingClientRect()
  const at = (event ?? {}) as { clientX?: number; clientY?: number }
  return {
    key,
    x: Math.max(0, (at.clientX ?? 0) - (box?.left ?? 0) + 12),
    y: Math.max(0, (at.clientY ?? 0) - (box?.top ?? 0) - 12),
  }
}

/** Which column a chart click landed in, or -1 outside the columns. */
export function columnIndex(state: {
  isTooltipActive: boolean
  activeTooltipIndex: number | string | null | undefined
}): number {
  if (
    !state.isTooltipActive ||
    state.activeTooltipIndex === undefined ||
    state.activeTooltipIndex === null
  )
    return -1
  const index = Number(state.activeTooltipIndex)
  return Number.isInteger(index) ? index : -1
}
