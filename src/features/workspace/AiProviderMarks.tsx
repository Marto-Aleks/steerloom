import { AI_MARKS, type AiChoice } from '../../lib/workspace/ai-choices'

const brand = (file: string) => `${import.meta.env.BASE_URL}brands/${file}`

/**
 * The AI services a team can bring, as round marks in a small honeycomb,
 * like a watch's app grid. The service is theirs, so Steerloom's own mark is
 * not among them. With `onPick`, each mark starts connecting that service.
 */
export function AiProviderMarks({
  active,
  onPick,
  size = 'regular',
  disabled,
}: {
  active?: AiChoice
  onPick?: (choice: AiChoice) => void
  size?: 'regular' | 'large'
  disabled?: boolean
}) {
  return (
    <div
      className="ai-marks"
      data-size={size}
      role={onPick ? 'group' : undefined}
      aria-label={onPick ? 'Connect an AI service' : undefined}
      aria-hidden={onPick ? undefined : true}
    >
      {AI_MARKS.map((mark, index) => {
        const content = <img src={brand(mark.file)} alt="" />
        const props = {
          className: 'ai-marks__disc ai-marks__mark',
          'data-position': index,
          'data-brand': mark.choice,
          'data-active': active === mark.choice || undefined,
        }
        return onPick ? (
          <button
            {...props}
            key={mark.choice}
            type="button"
            aria-label={`Connect ${mark.name}`}
            title={mark.name}
            disabled={disabled}
            onClick={() => onPick(mark.choice)}
          >
            {content}
          </button>
        ) : (
          <span {...props} key={mark.choice} title={mark.name}>
            {content}
          </span>
        )
      })}
    </div>
  )
}
