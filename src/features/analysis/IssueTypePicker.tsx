import { ChevronDown } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
interface IssueTypePickerProps {
  label: string
  availableTypes: string[]
  selectedTypes: string[]
  onChange: (types: string[]) => void
}

export function IssueTypePicker({
  label,
  availableTypes,
  selectedTypes,
  onChange,
}: IssueTypePickerProps) {
  const toggleType = (ticketType: string) => {
    const nextTypes = selectedTypes.includes(ticketType)
      ? selectedTypes.filter((value) => value !== ticketType)
      : [...selectedTypes, ticketType]
    onChange(nextTypes)
  }

  const selectionLabel =
    selectedTypes.length === 0
      ? 'All issue types'
      : selectedTypes.length === 1
        ? selectedTypes[0]
        : `${selectedTypes.length} issue types`

  return (
    <details className="choice-popover">
      <summary
        className="glass-input choice-popover__trigger"
        aria-label={label}
      >
        <span className="truncate">{selectionLabel}</span>
        <UiIcon
          icon={ChevronDown}
          size={16}
          className="choice-popover__chevron"
        />
      </summary>
      <div className="choice-popover__menu surface-inset">
        <label className="choice-popover__option">
          <input
            type="checkbox"
            checked={selectedTypes.length === 0}
            onChange={() => onChange([])}
          />
          <span>All issue types</span>
        </label>
        {availableTypes.map((ticketType) => (
          <label key={ticketType} className="choice-popover__option">
            <input
              type="checkbox"
              checked={selectedTypes.includes(ticketType)}
              onChange={() => toggleType(ticketType)}
            />
            <span>{ticketType}</span>
          </label>
        ))}
      </div>
    </details>
  )
}
