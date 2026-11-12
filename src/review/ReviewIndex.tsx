import { Wordmark } from '../components/Wordmark'
import { REVIEW_SCENARIOS, reviewHref, type ReviewScenario } from './review-api'
import './review.css'

const publicPages: ReadonlyArray<{
  title: string
  body: string
  href: string
}> = [
  {
    title: 'Landing page',
    body: 'The public product page.',
    href: '/?hosted=1',
  },
  {
    title: 'Sign in',
    body: 'Hosted sign-in.',
    href: '/?hosted=1&page=signin',
  },
  {
    title: 'Sign up',
    body: 'Hosted account creation.',
    href: '/?hosted=1&page=signup',
  },
  {
    title: 'Cloud or local',
    body: 'Where Steerloom runs.',
    href: '/?preview=design',
  },
  {
    title: 'Local setup',
    body: 'The one-command install page.',
    href: '/?preview=design&view=local',
  },
]

/** Development-only index of every screen, reachable without signing in. */
export function ReviewIndex() {
  return (
    <main className="review-index" id="main-content">
      <header className="review-index__head">
        <Wordmark />
        <h1>Review every screen</h1>
        <p>
          Sample data, no sign-in. The app screens run against answers served in
          your browser, so nothing touches a real board or account. This page
          only exists on the local development server.
        </p>
      </header>

      <section aria-labelledby="review-app">
        <h2 id="review-app">Signed-in app</h2>
        <ul className="review-index__grid">
          {REVIEW_SCENARIOS.map((scenario) => (
            <li key={scenario.id}>
              <a href={reviewHref(scenario.id)}>
                <strong>{scenario.title}</strong>
                <span>{scenario.body}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="review-index__hint">
          In “Briefings ready”, open a briefing for the dashboard, the ⋯ menu,
          the AI chat (sample answers) and the AI key settings on the workspace
          page.
        </p>
      </section>

      <section aria-labelledby="review-design">
        <h2 id="review-design">Design system</h2>
        <ul className="review-index__grid">
          <li>
            <a href="/?review=code-trail">
              <strong>GitHub as one code trail</strong>
              <span>
                Branch, commits, pull request and merge as one code state per
                item, compared with the board.
              </span>
            </a>
          </li>
          <li>
            <a href="/?review=github">
              <strong>GitHub in the briefing</strong>
              <span>
                Pull requests show what happens inside Review, without a new
                Jira status.
              </span>
            </a>
          </li>
          <li>
            <a href="/?review=reasoning">
              <strong>Answers that steer a decision</strong>
              <span>
                A short verdict and next step; the reasoning, ruled-out causes
                and options open on demand.
              </span>
            </a>
          </li>
          <li>
            <a href="/?review=cards">
              <strong>Answer cards</strong>
              <span>
                The assistant answers in a fixed shape: claim, evidence, one
                move.
              </span>
            </a>
          </li>
          <li>
            <a href="/?review=decisions">
              <strong>Decisions</strong>
              <span>
                A signal becomes a decision, and the check shows what moved.
              </span>
            </a>
          </li>
          <li>
            <a href="/?review=icons">
              <strong>Icon gallery</strong>
              <span>
                Every UI and spot icon, all sizes, on light, gradient and dark.
              </span>
            </a>
          </li>
        </ul>
      </section>

      <section aria-labelledby="review-public">
        <h2 id="review-public">Public pages</h2>
        <ul className="review-index__grid">
          {publicPages.map((page) => (
            <li key={page.href}>
              <a href={page.href}>
                <strong>{page.title}</strong>
                <span>{page.body}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

/** A small fixed tag so nobody mistakes review mode for a real workspace. */
export function ReviewBadge({ scenario }: { scenario: ReviewScenario }) {
  const title =
    REVIEW_SCENARIOS.find((item) => item.id === scenario)?.title ?? scenario
  return (
    <a className="review-badge" href="/?review">
      Review mode · {title} · All screens
    </a>
  )
}
