import { Component, type ErrorInfo, type ReactNode } from 'react'
import { GlassButton, GlassPanel } from './ui'

/**
 * If a screen fails while drawing, show what happened and a way back instead
 * of a blank page. The error text is shown so people can send it with the
 * Feedback button; nothing about their board is in it beyond what the
 * browser already shows them.
 */
export class CrashGuard extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Steerloom screen failed', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <main className="crash-guard">
        <GlassPanel className="crash-guard__panel" role="alert">
          <h1 className="crash-guard__title">This screen couldn’t open</h1>
          <p className="body-copy">
            Something in Steerloom went wrong while showing it. Your boards and
            settings are safe.
          </p>
          <GlassButton
            variant="primary"
            onClick={() => window.location.reload()}
          >
            Back to your workspace
          </GlassButton>
          <details className="crash-guard__details">
            <summary>What went wrong</summary>
            <p className="metadata-copy">
              Send this with the Feedback button so it can be fixed:
            </p>
            <code>{error.message || error.name}</code>
          </details>
        </GlassPanel>
      </main>
    )
  }
}
