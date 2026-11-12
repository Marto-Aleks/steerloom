import { Fragment } from 'react'
import { SpotIcon } from '../../../components/SpotIcon'
import type { SpotName } from '../../../components/spot-icons'
import { stagger } from './stagger'

export interface FlowStep {
  icon: SpotName
  label: string
}

/*
 * Three nodes joined by two wires with travelling packets. Decorative: the
 * surrounding card copy states the same flow in words, and the whole diagram
 * sits inside a button, so it must not add to the button's name.
 */
export function FlowDiagram({
  tone,
  steps,
}: {
  tone: 'hosted' | 'local'
  steps: readonly [FlowStep, FlowStep, FlowStep]
}) {
  return (
    <span className="entry-flow" data-tone={tone} aria-hidden="true">
      {steps.map((step, index) => (
        <Fragment key={step.label}>
          {index > 0 && (
            <span className="entry-flow__wire">
              <span className="sl-packet" style={stagger((index - 1) * 1400)} />
            </span>
          )}
          <span className="entry-flow__node">
            <SpotIcon
              name={step.icon}
              size={56}
              animate
              className="entry-flow__icon"
              style={stagger(index * 160)}
            />
            <span className="entry-flow__label">{step.label}</span>
          </span>
        </Fragment>
      ))}
    </span>
  )
}
