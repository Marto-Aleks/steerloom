import { Fragment, useEffect, useState, type CSSProperties } from 'react'
import { track } from '../../../lib/usage/track'
import { Wordmark } from '../../../components/Wordmark'
import { AssistantSection } from './AssistantSection'
import { CapabilityShowcase } from './CapabilityShowcase'
import { ClosingCta } from './ClosingCta'
import { CodeSection } from './CodeSection'
import { MetricsBento } from './MetricsBento'
import { TrustSection } from './TrustSection'
import { FilmPlayer } from './FilmPlayer'
import { HeroFilm, HeroRibbon } from './HeroFilm'

// The headline reveals word by word (see .landing__word).
const TITLE_WORDS = 'See where delivery really stands.'.split(' ')

const SIGN_IN = '/?hosted=1&page=signin'
const SIGN_UP = '/?hosted=1&page=signup'
const DEMO = '/?hosted=1&demo=1'
const LOCAL = '/?hosted=1&page=local'

/** Public product page for the hosted site; sign-in lives on its own page. */
export function LandingPage({
  productionHosted,
}: {
  productionHosted: boolean
}) {
  useEffect(() => track('landing_view'), [])
  const [filmHover, setFilmHover] = useState(false)
  const [filmOpener, setFilmOpener] = useState<HTMLElement | null>(null)
  const openFilm = (opener: HTMLElement) => setFilmOpener(opener)
  const closeFilm = () => setFilmOpener(null)
  return (
    <main className="workspace-entry landing" id="main-content">
      <div className="workspace-entry__shell">
        <header className="landing__nav">
          <a
            href="/?hosted=1"
            className="landing__brand"
            aria-label="Steerloom"
          >
            <Wordmark />
          </a>
          <nav className="landing__actions" aria-label="Account">
            <a className="landing__local-link" href={LOCAL}>
              Run locally
            </a>
            <a className="glass-button" data-variant="secondary" href={SIGN_IN}>
              Sign in
            </a>
            <a className="glass-button" data-variant="primary" href={SIGN_UP}>
              Get started
            </a>
          </nav>
        </header>

        <section
          className="landing__hero"
          data-film-hover={filmHover || undefined}
          aria-labelledby="landing-title"
        >
          <HeroRibbon />
          <div className="landing__copy">
            <h1 id="landing-title" className="landing__title">
              {TITLE_WORDS.map((word, index) => (
                <Fragment key={index}>
                  <span
                    className="landing__word"
                    style={{ '--w': index } as CSSProperties}
                  >
                    {word}
                  </span>
                  {index < TITLE_WORDS.length - 1 ? ' ' : null}
                </Fragment>
              ))}
            </h1>
            <p className="landing__lead">
              Your board already knows what’s going wrong. Steerloom tells you:
              what’s stuck, what needs your call, and when it’ll likely be done.
            </p>
            <p className="landing__audience">
              Built for the people who get asked{' '}
              <span className="landing__quote">
                “when will it be done?”
                <svg
                  viewBox="0 0 100 10"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path
                    d="M1 6 C 25 2, 50 9, 75 4 S 95 5, 99 3"
                    pathLength={1}
                  />
                </svg>
              </span>
            </p>
            <div className="landing__cta">
              <a className="glass-button" data-variant="primary" href={SIGN_UP}>
                Get started
              </a>
              <a className="glass-button" data-variant="secondary" href={DEMO}>
                See the live demo
              </a>
            </div>
          </div>
          <HeroFilm onOpen={openFilm} onHover={setFilmHover} />
        </section>

        <FilmPlayer opener={filmOpener} onClose={closeFilm} />

        <CapabilityShowcase />

        <MetricsBento />

        <CodeSection localHref={LOCAL} demoHref={DEMO} />

        <AssistantSection signUpHref={SIGN_UP} />

        <TrustSection />

        <ClosingCta signUpHref={SIGN_UP} localHref={LOCAL} />

        <footer className="landing__footer">
          <span>Steerloom reads your boards and never changes them.</span>
          {productionHosted && (
            <span className="landing__footer-links">
              <a href="/about.html">About</a>
              <a href="/terms.html">Terms</a>
              <a href="/privacy.html">Privacy notice</a>
            </span>
          )}
        </footer>
      </div>
    </main>
  )
}
