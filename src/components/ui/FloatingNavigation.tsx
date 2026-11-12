import { useEffect, useState, type ReactNode } from 'react'
import { FileText, LayoutGrid, Moon, Sun } from 'lucide-react'
import { UiIcon } from '../UiIcon'
import { Wordmark } from '../Wordmark'

export type NavigationTheme = 'light' | 'dark'
export type NavigationView = 'home' | 'setup' | 'report'

export interface FloatingNavigationProps {
  view: NavigationView
  /** A dashboard is open, so the Dashboard tab can be shown. */
  hasDashboard: boolean
  /** Hosted workspaces link back to the account's workspace list. */
  hostedWorkspace: boolean
  workspaceName: string
  theme: NavigationTheme
  /** ISO timestamp of the board data currently loaded, when any. */
  loadedAt?: string | null
  /** The open board is the fictional demo; shown instead of the load time. */
  demo?: boolean
  onOpenWorkspace: () => void
  onOpenDashboard: () => void
  onThemeToggle: () => void
  onSignOut: () => void
  signOutDisabled?: boolean
  /** Shown first among the utilities, such as the installed app's update pill. */
  notice?: ReactNode
}

const SCROLLED_THRESHOLD = 24

/**
 * The glass navigation bar shared by the workspace home, report setup and the
 * dashboard. It only reports real state: the "Loaded" chip shows the time of
 * the board snapshot that is actually in memory.
 */
export function FloatingNavigation({
  view,
  hasDashboard,
  hostedWorkspace,
  workspaceName,
  theme,
  loadedAt = null,
  demo = false,
  onOpenWorkspace,
  onOpenDashboard,
  onThemeToggle,
  onSignOut,
  signOutDisabled = false,
  notice = null,
}: FloatingNavigationProps) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    let frame = 0
    const requestFrame = (callback: FrameRequestCallback) =>
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(callback)
        : window.setTimeout(() => callback(Date.now()), 16)
    const cancelFrame = (frameId: number) => {
      if (typeof window.cancelAnimationFrame === 'function')
        window.cancelAnimationFrame(frameId)
      else window.clearTimeout(frameId)
    }
    const updateScrollState = () => {
      if (frame) return
      frame = requestFrame(() => {
        setScrolled(window.scrollY > SCROLLED_THRESHOLD)
        frame = 0
      })
    }
    updateScrollState()
    window.addEventListener('scroll', updateScrollState, { passive: true })
    return () => {
      window.removeEventListener('scroll', updateScrollState)
      if (frame) cancelFrame(frame)
    }
  }, [])

  const nextTheme = theme === 'light' ? 'dark' : 'light'
  const loadedTime = loadedAt ? formatLoadedTime(loadedAt) : null

  return (
    <header className="floating-navigation" data-scrolled={scrolled}>
      <div className="floating-navigation__surface">
        <button
          type="button"
          className="floating-navigation__brand"
          onClick={onOpenWorkspace}
          aria-label="Steerloom workspace home"
        >
          <Wordmark />
        </button>

        <nav
          aria-label="Workspace navigation"
          className="floating-navigation__tabs"
        >
          {hostedWorkspace && (
            <a
              href="/?hosted=1&view=hosted"
              className="floating-navigation__tab"
            >
              All workspaces
            </a>
          )}
          <button
            type="button"
            className="floating-navigation__tab"
            aria-current={view === 'home' ? 'page' : undefined}
            onClick={onOpenWorkspace}
          >
            <UiIcon
              icon={LayoutGrid}
              className="floating-navigation__tab-icon"
            />
            Workspace
          </button>
          {hasDashboard && (
            <button
              type="button"
              className="floating-navigation__tab"
              aria-current={
                view === 'setup' || view === 'report' ? 'page' : undefined
              }
              onClick={onOpenDashboard}
            >
              <UiIcon
                icon={FileText}
                className="floating-navigation__tab-icon"
              />
              Dashboard
            </button>
          )}
        </nav>

        <div className="floating-navigation__utilities">
          {notice}
          {demo && (
            <span
              className="floating-navigation__demo"
              title="Fictional sample data, not a real board"
            >
              Demo data
            </span>
          )}
          {loadedTime && !demo && (
            <span
              className="floating-navigation__loaded"
              title={`Board data loaded ${new Date(loadedAt!).toLocaleString()}`}
            >
              <span
                className="floating-navigation__loaded-dot"
                aria-hidden="true"
              />
              Loaded {loadedTime}
            </span>
          )}
          <span title={workspaceName} className="floating-navigation__team">
            {workspaceName}
          </span>
          <button
            type="button"
            className="floating-navigation__theme-toggle"
            onClick={onThemeToggle}
            aria-label={`Switch to ${nextTheme} appearance`}
          >
            <UiIcon
              icon={theme === 'light' ? Moon : Sun}
              className="floating-navigation__theme-icon"
            />
            <span className="floating-navigation__theme-label">
              {nextTheme === 'dark' ? 'Dark' : 'Light'}
            </span>
          </button>
          <button
            type="button"
            className="floating-navigation__signout"
            onClick={onSignOut}
            disabled={signOutDisabled}
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}

function formatLoadedTime(iso: string): string | null {
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return null
  return time.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}
