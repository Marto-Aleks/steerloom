export const chartPalette = {
  grid: 'var(--chart-grid)',
  label: 'var(--chart-label)',
  primary: 'var(--chart-primary)',
  primaryStrong: 'var(--chart-primary-strong)',
  distribution: 'var(--chart-secondary)',
  percentile: 'var(--chart-purple)',
  /** Past the usual limit: the aging colour, never decorative. */
  late: 'var(--chart-orange)',
  surface: 'var(--chart-tooltip)',
} as const

export const tooltipStyle = {
  border: `1px solid ${chartPalette.grid}`,
  borderRadius: 'var(--radius-control)',
  padding: 'var(--space-3) var(--space-4)',
  background: chartPalette.surface,
  boxShadow: 'var(--shadow-level-2)',
  color: 'var(--text-primary)',
  fontSize: '12px',
}
