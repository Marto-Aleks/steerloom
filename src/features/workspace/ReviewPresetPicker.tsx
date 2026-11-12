import { Check } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import { reviewPresets, type ReviewMode } from '../../lib/workspace/model'

export function ReviewPresetPicker({
  value,
  onChange,
}: {
  value: ReviewMode
  onChange: (value: 'daily' | 'weekly') => void
}) {
  return (
    <fieldset className="review-presets">
      <legend className="review-presets__legend">
        <span className="review-presets__title">
          How often will you read it?
        </span>
        <span className="review-presets__lead">
          This sets what the briefing shows.
        </span>
      </legend>
      <div className="review-presets__options">
        {reviewPresets.map((preset) => (
          <button
            type="button"
            key={preset.id}
            aria-pressed={value === preset.id}
            className="review-preset"
            onClick={() => onChange(preset.id)}
          >
            <strong className="review-preset__name">{preset.name}</strong>
            <span className="review-preset__description">
              {preset.description}
            </span>
            <small className="review-preset__meta">{preset.focus}</small>
            <span aria-hidden="true" className="review-preset__check">
              <UiIcon icon={Check} size={16} />
            </span>
          </button>
        ))}
      </div>
      <p className="metadata-copy review-presets__status" role="status">
        {value === 'custom'
          ? 'Not sure? Leave it: you get the full briefing. Change it any time.'
          : `${value === 'daily' ? 'Daily' : 'Weekly'} review selected.`}
      </p>
    </fieldset>
  )
}
