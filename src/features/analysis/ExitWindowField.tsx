import { GlassSelect } from '../../components/ui'
import { EXIT_WINDOW_OPTIONS } from './report-options'

interface ExitWindowFieldProps {
  value: number | null
  onChange: (windowDays: number | null) => void
}

export function ExitWindowField({ value, onChange }: ExitWindowFieldProps) {
  return (
    <GlassSelect
      aria-label="Exited within"
      value={value ?? ''}
      onChange={(event) =>
        onChange(event.target.value ? Number(event.target.value) : null)
      }
    >
      {EXIT_WINDOW_OPTIONS.map((option) => (
        <option key={option.label} value={option.value ?? ''}>
          {option.label}
        </option>
      ))}
    </GlassSelect>
  )
}
