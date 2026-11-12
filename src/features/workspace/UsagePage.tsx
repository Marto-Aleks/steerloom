import { useEffect, useState } from 'react'
import { Wordmark } from '../../components/Wordmark'
import { GlassPanel, StatusMessage } from '../../components/ui'
import { workspaceRequest } from '../../lib/workspace/api'

/*
 * Usage counts for the people who run the hosted site: how many reached each
 * step, so drop-off is visible without asking testers. Steps only; see
 * server/hosted/usage.ts for what is and is not kept.
 */

interface UsageReport {
  since: string
  steps: Array<{ step: string; people: number | null; total: number }>
  days: Array<{ day: string; counts: Record<string, number> }>
  sources?: Array<{ source: string; counts: Record<string, number> }>
}

const LABELS: Record<string, string> = {
  landing_view: 'Landing page visits',
  film_played: 'Film plays',
  demo_opened: 'Open demo views',
  signed_in: 'Signed in',
  workspace_created: 'Created a workspace',
  board_connected: 'Connected a board',
  briefing_built: 'Opened a briefing on a real board',
  ai_question: 'Asked the AI a question',
  feedback_sent: 'Sent feedback',
  briefing_useful: 'Said the briefing was useful',
  briefing_not_useful: 'Said the briefing was not useful',
  demo_useful: 'Said the demo looks useful',
  demo_not_useful: 'Said the demo does not look useful',
  install_started: 'Started a local install',
  update_started: 'Updated the installed app',
}
/** What a tagged link (`?src=li`) led to; the browser reports these steps. */
const SOURCE_STEPS = [
  'landing_view',
  'demo_opened',
  'film_played',
  'briefing_built',
]
const SOURCE_NAMES: Record<string, string> = { li: 'LinkedIn (li)' }
const FUNNEL = [
  'signed_in',
  'workspace_created',
  'board_connected',
  'briefing_built',
  'ai_question',
]

export function UsagePage() {
  const [report, setReport] = useState<UsageReport | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    workspaceRequest<UsageReport>(
      '/api/hosted/usage',
      'GET',
      undefined,
      controller.signal,
    )
      .then(setReport)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error ? caught.message : 'Could not load usage.',
          )
      })
    return () => controller.abort()
  }, [])
  const byStep = new Map(report?.steps.map((item) => [item.step, item]))
  const first = byStep.get('signed_in')?.people ?? 0
  return (
    <main className="workspace-entry usage-page" id="main-content">
      <div className="workspace-entry__shell">
        <header className="workspace-entry__nav">
          <a href="/?hosted=1&view=hosted" aria-label="Steerloom workspaces">
            <Wordmark />
          </a>
        </header>
        <h1 className="page-title">Usage</h1>
        <p className="metadata-copy">
          Steps people reached on steerloom.app
          {report &&
            `, counted since ${new Date(report.since).toLocaleDateString()}`}
          . No board data, names or emails are kept.
        </p>
        {error && <StatusMessage variant="error">{error}</StatusMessage>}
        {!report && !error && (
          <StatusMessage variant="loading">Loading usage…</StatusMessage>
        )}
        {report && (
          <>
            <GlassPanel className="usage-page__panel">
              <h2 className="section-title">From sign-in to value</h2>
              <table className="usage-page__table">
                <thead>
                  <tr>
                    <th scope="col">Step</th>
                    <th scope="col">People</th>
                    <th scope="col">Of those signed in</th>
                  </tr>
                </thead>
                <tbody>
                  {FUNNEL.map((step) => {
                    const people = byStep.get(step)?.people ?? 0
                    return (
                      <tr key={step}>
                        <th scope="row">{LABELS[step]}</th>
                        <td>{people}</td>
                        <td>
                          {first
                            ? `${Math.round((people / first) * 100)}%`
                            : '–'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </GlassPanel>
            {report.sources && report.sources.length > 0 && (
              <GlassPanel className="usage-page__panel">
                <h2 className="section-title">Where visitors came from</h2>
                <div className="usage-page__scroll">
                  <table className="usage-page__table">
                    <thead>
                      <tr>
                        <th scope="col">Link</th>
                        {SOURCE_STEPS.map((step) => (
                          <th scope="col" key={step}>
                            {LABELS[step]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.sources.map((item) => (
                        <tr key={item.source}>
                          <th scope="row">
                            {SOURCE_NAMES[item.source] ?? item.source}
                          </th>
                          {SOURCE_STEPS.map((step) => (
                            <td key={step}>{item.counts[step] ?? 0}</td>
                          ))}
                        </tr>
                      ))}
                      <tr>
                        <th scope="row">No tagged link</th>
                        {SOURCE_STEPS.map((step) => (
                          <td key={step}>
                            {Math.max(
                              0,
                              (byStep.get(step)?.total ?? 0) -
                                (report.sources ?? []).reduce(
                                  (sum, item) => sum + (item.counts[step] ?? 0),
                                  0,
                                ),
                            )}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="metadata-copy">
                  Add <code>?src=li</code> (or any short tag) to a link you
                  share. A visitor keeps that tag for 30 days in their browser,
                  so a briefing opened later still counts for it.
                </p>
              </GlassPanel>
            )}
            <GlassPanel className="usage-page__panel">
              <h2 className="section-title">Everything counted</h2>
              <table className="usage-page__table">
                <thead>
                  <tr>
                    <th scope="col">Step</th>
                    <th scope="col">People</th>
                    <th scope="col">Times</th>
                  </tr>
                </thead>
                <tbody>
                  {report.steps.map((item) => (
                    <tr key={item.step}>
                      <th scope="row">{LABELS[item.step] ?? item.step}</th>
                      <td>{item.people ?? '–'}</td>
                      <td>{item.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="metadata-copy">
                People are counted once per step. Visits, plays, installs and
                answers about the demo are counted as times only.
              </p>
            </GlassPanel>
            {report.days.length > 0 && (
              <GlassPanel className="usage-page__panel">
                <h2 className="section-title">Last 14 days</h2>
                <div className="usage-page__scroll">
                  <table className="usage-page__table">
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        {report.steps.map((item) => (
                          <th scope="col" key={item.step}>
                            {LABELS[item.step] ?? item.step}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.days.map((day) => (
                        <tr key={day.day}>
                          <th scope="row">{day.day}</th>
                          {report.steps.map((item) => (
                            <td key={item.step}>
                              {day.counts[item.step] ?? 0}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </GlassPanel>
            )}
          </>
        )}
      </div>
    </main>
  )
}
