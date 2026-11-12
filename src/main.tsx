import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { CrashGuard } from './components/CrashGuard'
import App from './App'
import './styles.css'
import { HostedAccountSetup } from './features/workspace/HostedAccountSetup'
import { SpotIconSprite } from './components/SpotIcon'
import { FeedbackButton } from './components/FeedbackButton'
import { feedbackAvailable } from './components/feedback-available'
import { InstallAppButton } from './components/InstallAppButton'

const DesignPreview = import.meta.env.DEV
  ? lazy(() => import('./features/workspace/DesignPreview'))
  : null
const params = new URLSearchParams(window.location.search)
const preview = import.meta.env.DEV && params.get('preview') === 'design'
// Review mode exists only on the development server: ?review lists every
// screen, ?review=<scenario> runs the app on sample answers without sign-in.
const review = import.meta.env.DEV ? params.get('review') : null

const OpenDemo = lazy(() =>
  import('./features/workspace/OpenDemo').then((module) => ({
    default: module.OpenDemo,
  })),
)
const openDemo = params.get('demo') === '1' && !params.get('workspace')
const UsagePage = lazy(() =>
  import('./features/workspace/UsagePage').then((module) => ({
    default: module.UsagePage,
  })),
)
const usagePage = params.get('hosted') === '1' && params.get('page') === 'usage'

const root = createRoot(document.getElementById('root')!)

function renderApp(extra?: React.ReactNode) {
  root.render(
    <StrictMode>
      <SpotIconSprite />
      <CrashGuard>
        {preview && DesignPreview ? (
          <Suspense fallback={<p>Opening design preview…</p>}>
            <DesignPreview />
          </Suspense>
        ) : usagePage ? (
          <Suspense fallback={null}>
            <UsagePage />
          </Suspense>
        ) : openDemo ? (
          <Suspense fallback={null}>
            <OpenDemo />
          </Suspense>
        ) : params.get('hosted') === '1' && !params.get('workspace') ? (
          <HostedAccountSetup />
        ) : (
          <App />
        )}
      </CrashGuard>
      {feedbackAvailable() && (
        <div className="corner-actions">
          <FeedbackButton />
          <InstallAppButton />
        </div>
      )}
      {extra}
    </StrictMode>,
  )
}

if (import.meta.env.DEV && review !== null) {
  void Promise.all([
    import('./review/review-api'),
    import('./review/ReviewIndex'),
  ]).then(async ([api, screens]) => {
    if (review === 'icons') {
      const { IconGallery } = await import('./review/IconGallery')
      root.render(
        <StrictMode>
          <SpotIconSprite />
          <IconGallery />
        </StrictMode>,
      )
      return
    }
    if (review === 'causes') {
      const { CausesPreview } = await import('./review/CausesPreview')
      root.render(
        <StrictMode>
          <SpotIconSprite />
          <CausesPreview />
        </StrictMode>,
      )
      return
    }
    if (review === 'code-trail') {
      const { CodeTrailPreview } = await import('./review/CodeTrailPreview')
      root.render(
        <StrictMode>
          <SpotIconSprite />
          <CodeTrailPreview />
        </StrictMode>,
      )
      return
    }
    if (review === 'github') {
      const { GithubPreview } = await import('./review/GithubPreview')
      root.render(
        <StrictMode>
          <SpotIconSprite />
          <GithubPreview />
        </StrictMode>,
      )
      return
    }
    if (review === 'reasoning') {
      const { ReasoningPreview } = await import('./review/ReasoningPreview')
      root.render(
        <StrictMode>
          <SpotIconSprite />
          <ReasoningPreview />
        </StrictMode>,
      )
      return
    }
    if (review === 'cards') {
      const { CardsPreview } = await import('./review/CardsPreview')
      root.render(
        <StrictMode>
          <SpotIconSprite />
          <CardsPreview />
        </StrictMode>,
      )
      return
    }
    if (review === 'decisions') {
      const { DecisionsPreview } = await import('./review/DecisionsPreview')
      root.render(
        <StrictMode>
          <SpotIconSprite />
          <DecisionsPreview />
        </StrictMode>,
      )
      return
    }
    if (review === 'signals') {
      const { SignalsPreview } = await import('./review/SignalsPreview')
      root.render(
        <StrictMode>
          <SpotIconSprite />
          <SignalsPreview />
        </StrictMode>,
      )
      return
    }
    const scenario = api.readReviewScenario(review)
    if (!scenario) {
      root.render(
        <StrictMode>
          <SpotIconSprite />
          <screens.ReviewIndex />
        </StrictMode>,
      )
      return
    }
    api.installReviewApi(scenario)
    renderApp(<screens.ReviewBadge scenario={scenario} />)
  })
} else {
  renderApp()
}
