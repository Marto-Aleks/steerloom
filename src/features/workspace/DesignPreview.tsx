import { useEffect, useState } from 'react'
import { FeedbackButton } from '../../components/FeedbackButton'
import { askForFeedbackAgain } from '../../components/feedback-nudge'
import { Loomy, LOOMY_FACES } from '../../components/Loomy'
import { GlassButton } from '../../components/ui'
import { Wordmark } from '../../components/Wordmark'
import { useTheme } from '../../hooks/useTheme'
import { GithubLocalCard } from './GithubLocalNote'
import { SendToComputer } from './SendToComputer'
import { UpdateSheet, type UpdatePhase } from './UpdateNotice'
import { LocalSetupPage } from './LocalExperience'
import { WorkLocationChoice } from './WorkLocationChoice'

type PreviewView =
  | 'choose'
  | 'local'
  | 'hosted'
  | 'loomy'
  | 'github'
  | 'install'
const requestedView = (): PreviewView => {
  const view = new URLSearchParams(window.location.search).get('view')
  return view === 'local' ||
    view === 'hosted' ||
    view === 'loomy' ||
    view === 'github' ||
    view === 'install'
    ? view
    : 'choose'
}

export default function DesignPreview() {
  const [view, setView] = useState<PreviewView>(requestedView)
  const { theme, toggleTheme } = useTheme()
  const chooseView = (nextView: PreviewView) => {
    const url = new URL(window.location.href)
    if (nextView === 'choose') url.searchParams.delete('view')
    else url.searchParams.set('view', nextView)
    window.history.pushState({}, '', url)
    setView(nextView)
  }

  useEffect(() => {
    const restoreView = () => setView(requestedView())
    window.addEventListener('popstate', restoreView)
    return () => window.removeEventListener('popstate', restoreView)
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
    const heading = document.querySelector('h1')
    if (heading) {
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
    }
  }, [view])
  return (
    <main className="workspace-entry" id="main-content">
      <div className="workspace-entry__shell">
        <header className="workspace-entry__nav">
          <Wordmark />
          <div className="workspace-entry__account">
            <button type="button" onClick={toggleTheme}>
              {theme === 'light' ? 'Dark mode' : 'Light mode'}
            </button>
            <a href="/">Exit preview</a>
          </div>
        </header>
        <p className="entry-preview-note">
          Design preview with fictional data. No sign-in needed.
        </p>
        {view === 'loomy' ? (
          <LoomyPreview />
        ) : view === 'install' ? (
          <InstallPreview />
        ) : view === 'github' ? (
          <section className="loomy-preview">
            <h1 className="entry-choice__title">GitHub on the hosted site</h1>
            <p className="entry-choice__lead">
              This card takes the place of the GitHub settings in a hosted
              workspace, under Workspace settings.
            </p>
            <section
              className="home-settings"
              aria-labelledby="preview-settings-title"
            >
              <h2 id="preview-settings-title" className="home-quiet__title">
                Workspace settings
              </h2>
              <GithubLocalCard />
            </section>
          </section>
        ) : view === 'choose' ? (
          <WorkLocationChoice onChoose={chooseView} />
        ) : view === 'local' ? (
          <LocalSetupPage
            productionHosted={false}
            onBack={() => chooseView('choose')}
          />
        ) : (
          <section className="entry-choice__hero">
            <h1 className="entry-choice__title">
              Your team’s briefings,{' '}
              <span className="entry-hero__accent">online.</span>
            </h1>
            <p className="entry-choice__lead">
              In the live app, this opens your workspaces. This design preview
              does not connect to an account or save data.
            </p>
            <button
              className="workspace-local-page__back"
              type="button"
              onClick={() => chooseView('choose')}
            >
              All setup options
            </button>
          </section>
        )}
        <footer className="workspace-entry__footer">
          Steerloom design preview
        </footer>
      </div>
    </main>
  )
}

/** Loomy in the app: every face, and the feedback button she lives on. */
function LoomyPreview() {
  return (
    <section className="loomy-preview">
      <h1 className="entry-choice__title">Loomy on the feedback button</h1>
      <p className="entry-choice__lead">
        The feedback button is in the bottom-left corner of this page, as on the
        live site. Move the pointer near it, then ask the question.
      </p>
      <div className="loomy-preview__actions">
        <GlassButton
          variant="primary"
          onClick={() => askForFeedbackAgain('briefing')}
        >
          Ask the question
        </GlassButton>
        <GlassButton onClick={() => askForFeedbackAgain('demo')}>
          Ask the demo question
        </GlassButton>
      </div>
      <h2 className="loomy-preview__heading">Every face, at film size</h2>
      <ul className="loomy-preview__faces">
        {LOOMY_FACES.map((face) => (
          <li key={face}>
            <Loomy face={face} size={120} />
            <span>{face}</span>
          </li>
        ))}
      </ul>
      <h2 className="loomy-preview__heading">At button size</h2>
      <ul className="loomy-preview__faces" data-size="small">
        {LOOMY_FACES.map((face) => (
          <li key={face}>
            <Loomy face={face} size={44} />
            <span>{face}</span>
          </li>
        ))}
      </ul>
      <div className="corner-actions">
        <FeedbackButton />
      </div>
    </section>
  )
}

/** The two install drafts: updating from inside the app, and the phone card. */
function InstallPreview() {
  const [phase, setPhase] = useState<UpdatePhase | null>(null)
  const update = {
    current: '2026.11.12.2',
    available: true,
    latest: '2026.11.13',
    notes: [
      'Update Steerloom from inside the app: one click, no terminal',
      'A shorter briefing header, and “Ask AI” on every link that opens Steerloom AI',
    ],
    updateUrl: '/?hosted=1&page=local',
  }
  const phases: Array<[UpdatePhase, string]> = [
    ['ready', '1. Update is ready'],
    ['updating', '2. Updating'],
    ['done', '3. Done'],
    ['failed', 'If it fails'],
  ]
  return (
    <section className="loomy-preview">
      <h1 className="entry-choice__title">Install without the terminal</h1>
      <p className="entry-choice__lead">
        In the installed app, “Update available” opens this sheet. Choose a
        state to see it.
      </p>
      <div className="loomy-preview__actions">
        {phases.map(([value, label]) => (
          <GlassButton key={value} onClick={() => setPhase(value)}>
            {label}
          </GlassButton>
        ))}
      </div>
      <p className="entry-choice__lead">
        On a phone, the local setup page shows this card above the install
        command.
      </p>
      <div className="lp">
        <SendToComputer force />
      </div>
      {phase && (
        <UpdateSheet
          update={update}
          phase={phase}
          onUpdate={() => setPhase('updating')}
          onLater={() => setPhase(null)}
          onClose={() => setPhase(null)}
        />
      )}
    </section>
  )
}
