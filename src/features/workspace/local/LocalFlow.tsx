import { Fragment, type CSSProperties } from 'react'
import { SpotIcon } from '../../../components/SpotIcon'

const delay = (ms: number) => ({ '--sl-delay': `${ms}ms` }) as CSSProperties

const nodes = [
  {
    kind: 'board',
    tone: 'jira',
    title: 'Company board',
    body: 'Stays on your network. Read with your own project-scoped, read-only token.',
  },
  {
    kind: 'runs-anywhere',
    tone: 'machine',
    title: 'Your computer',
    body: 'Steerloom runs here and calculates every metric in memory.',
  },
  {
    kind: 'briefing',
    tone: 'report',
    title: 'Your reports',
    body: 'Briefings, signals and review drafts open in your browser.',
  },
] as const

const wires = ['read-only token', 'calculated in memory']

const guarantees = [
  'Board token encrypted on this computer',
  'Board rows, responses and chats never saved or logged',
  'Your hosted sign-in does not unlock the local app or sync its data',
  'No telemetry. No write access to your board.',
]

/** Company board → Your computer → Your reports data path. */
export function LocalFlow() {
  return (
    <section
      className="lp-how lp-glass"
      id="local-how"
      aria-labelledby="local-how-title"
    >
      <div className="lp-how__heading">
        <h2 id="local-how-title">How local works</h2>
      </div>
      <div className="lp-boundary">
        <span className="lp-boundary__tag">Inside your organisation</span>
        <div className="lp-flow" role="list">
          {nodes.map((node, index) => (
            <Fragment key={node.title}>
              <div role="listitem" className="lp-flow__node">
                <span
                  className={`lp-flow__tile lp-flow__tile--${node.tone}`}
                  aria-hidden="true"
                >
                  <SpotIcon
                    name={node.kind}
                    size={64}
                    animate
                    style={delay(index * 160)}
                  />
                </span>
                <strong>{node.title}</strong>
                <span>{node.body}</span>
              </div>
              {wires[index] && (
                <div className="lp-flow__wire" aria-hidden="true">
                  <span className="lp-flow__line">
                    <span className="sl-packet" style={delay(index * 1300)} />
                  </span>
                  <span className="lp-flow__label">{wires[index]}</span>
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="lp-guarantee">
        <span className="lp-guarantee__shield" aria-hidden="true">
          <SpotIcon name="secure" size={48} />
        </span>
        <div>
          <p>
            <strong>Nothing crosses this line.</strong> Board rows, API
            responses and conversations are used for your reports in memory and
            are never saved or logged. Steerloom’s hosted service never receives
            them. The only optional outbound path is an AI endpoint your
            organisation approves. It gets a minimised report snapshot and
            selected board evidence, and only if you configure it.
          </p>
          <ul className="lp-guarantee__facts">
            {guarantees.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
