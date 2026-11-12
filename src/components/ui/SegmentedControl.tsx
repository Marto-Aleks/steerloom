interface SegmentOption<Value extends string> {
  value: Value
  label: string
}

interface SegmentedControlProps<Value extends string> {
  label: string
  options: ReadonlyArray<SegmentOption<Value>>
  value: Value
  onChange: (value: Value) => void
  className?: string
}

export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
  className = '',
}: SegmentedControlProps<Value>) {
  return (
    <div
      className={`glass-segmented-control ${className}`.trim()}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
