import type { ReactNode } from 'react'
import { GlassPanel } from '../../../components/ui'
import { Wordmark } from '../../../components/Wordmark'

/*
 * Focused auth layout: the logo, then the form card as the only thing on the
 * page. The page title is kept as the h1 for screen readers; the card's own
 * heading ("Sign in", "Create your account") is what people see.
 */
export function EntryPage({
  title,
  links,
  children,
}: {
  title: ReactNode
  /* Kept for callers; the form-only layout no longer shows a lead. */
  lead?: string
  /* Secondary links under the card (what is Steerloom, privacy, back). */
  links?: ReactNode
  children: ReactNode
}) {
  return (
    <main className="entry" id="main-content">
      <div className="entry__grid">
        <div className="entry__form">
          <h1 className="sr-only">{title}</h1>
          <Wordmark className="entry__brand" />
          <GlassPanel className="entry-card" elevation="floating">
            {children}
          </GlassPanel>
          {links && <p className="entry__links">{links}</p>}
        </div>
      </div>
    </main>
  )
}

/* "or with email" rule between the Google button and the password form. */
export function EntryDivider({ children }: { children: ReactNode }) {
  return (
    <p className="entry-divider" role="presentation">
      <span>{children}</span>
    </p>
  )
}
