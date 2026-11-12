import { Lock } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import { FlowDiagram, type FlowStep } from './entry/FlowDiagram'

const HOSTED_FLOW: readonly [FlowStep, FlowStep, FlowStep] = [
  { icon: 'board', label: 'Your board' },
  { icon: 'cloud', label: 'Steerloom online' },
  { icon: 'team', label: 'Your team' },
]

const LOCAL_FLOW: readonly [FlowStep, FlowStep, FlowStep] = [
  { icon: 'board', label: 'Company board' },
  { icon: 'runs-anywhere', label: 'Your computer' },
  { icon: 'briefing', label: 'Your reports' },
]

function ReadOnlyBadge() {
  return (
    <span className="entry-path__badge">
      <UiIcon icon={Lock} size={16} />
      Read-only
    </span>
  )
}

export function WorkLocationChoice({
  onChoose,
}: {
  onChoose: (destination: 'hosted' | 'local') => void
}) {
  return (
    <>
      <section className="entry-choice__hero" aria-labelledby="entry-title">
        <h1 id="entry-title" className="entry-choice__title">
          Same briefing.{' '}
          <span className="entry-hero__accent">You choose where it runs.</span>
        </h1>
        <p className="entry-choice__lead">
          Pick the setup that fits your organisation’s data policy. Both read
          your board and never change it. Hosted and local accounts are
          separate, and you can use both.
        </p>
      </section>
      <section
        className="entry-choice__paths"
        aria-label="Choose where to work"
      >
        <button
          className="entry-path glass-card"
          data-tone="hosted"
          type="button"
          onClick={() => onChoose('hosted')}
        >
          <span className="entry-path__top">
            <strong className="entry-path__title">Hosted workspace</strong>
            <ReadOnlyBadge />
          </span>
          <span className="entry-path__body">
            Sign in from any browser and share briefings with your team. Connect
            a board with one read-only approval.
          </span>
          <FlowDiagram tone="hosted" steps={HOSTED_FLOW} />
          <span className="entry-path__cta">Open hosted workspace</span>
        </button>
        <button
          className="entry-path glass-card"
          data-tone="local"
          type="button"
          onClick={() => onChoose('local')}
        >
          <span className="entry-path__top">
            <strong className="entry-path__title">Local workspace</strong>
            <ReadOnlyBadge />
          </span>
          <span className="entry-path__body">
            Run Steerloom on a computer that can reach your company’s private
            board. Board data stays on that computer.
          </span>
          <FlowDiagram tone="local" steps={LOCAL_FLOW} />
          <span className="entry-path__cta">Set up local workspace</span>
        </button>
      </section>
    </>
  )
}
