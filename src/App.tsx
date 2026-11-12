import { HostedAccountSetup } from './features/workspace/HostedAccountSetup'
import { UpdateNotice } from './features/workspace/UpdateNotice'
import { AiKeySettings } from './features/workspace/AiKeySettings'
import { GoogleWorkspaceSetup } from './features/workspace/GoogleWorkspaceSetup'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  FloatingNavigation,
  GlassInput,
  GlassPanel,
  StatusMessage,
} from './components/ui'
import { JiraAnalysisSetup } from './features/analysis/JiraAnalysisSetup'
import { ReviewPresetPicker } from './features/workspace/ReviewPresetPicker'
import { FigmaFileField } from './features/workspace/FigmaFileField'
import { usePullRequests } from './features/workspace/use-pull-requests'
import { demoCodeTrail } from './lib/workspace/demo-github'
import { applyReviewPreset } from './lib/workspace/model'
import { MetricPicker } from './features/workspace/MetricPicker'
import { SignIn } from './features/workspace/SignIn'
import { WorkspaceHome } from './features/workspace/WorkspaceHome'
import { BoardLoadProgress } from './features/workspace/BoardLoadProgress'
import {
  startBoardLoad,
  updateBoardLoad,
  type BoardLoad,
} from './lib/workspace/board-progress'
import { useTheme } from './hooks/useTheme'
import { suggestLocalBoardColumns } from './lib/data-source/local-transition'
import {
  getBoardSnapshot,
  getSession,
  saveDashboard,
  workspaceRequest,
} from './lib/workspace/api'
import { demoSnapshot } from './lib/workspace/demo'
import { askForFeedbackSoon } from './components/feedback-nudge'
import { DemoCodeHint } from './features/workspace/GithubLocalNote'
import { track } from './lib/usage/track'
import type {
  DashboardMetric,
  SavedDashboard,
  WorkspaceBoard,
  WorkspaceConnection,
  WorkspaceSession,
} from './lib/workspace/model'
import type { AnalysisFilters, FlowBoardSnapshot } from './types'

const FlowAnalysis = lazy(() =>
  import('./features/analysis/FlowAnalysis').then((module) => ({
    default: module.FlowAnalysis,
  })),
)
type View = 'home' | 'setup' | 'report'

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [session, setSession] = useState<WorkspaceSession | null>(null)
  const [checking, setChecking] = useState(true)
  const [view, setView] = useState<View>('home')
  const [snapshot, setSnapshot] = useState<FlowBoardSnapshot | null>(null)
  const [dashboard, setDashboard] = useState<SavedDashboard | null>(null)
  const [busy, setBusy] = useState(false)
  const [boardLoad, setBoardLoad] = useState<BoardLoad | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Pull requests from the workspace's GitHub repositories (local app only).
  const {
    pullRequests,
    branches,
    error: pullRequestError,
    loading: pullRequestsLoading,
  } = usePullRequests({
    repositories:
      session?.github && !session.workspaceId
        ? session.github.repositories
        : [],
    windowDays: dashboard?.filters.windowDays ?? null,
    loadedAt: snapshot?.loadedAt,
  })
  // The demo board carries a fictional code trail instead of GitHub's.
  const demoCode = useMemo(
    () =>
      dashboard?.provider === 'demo' && snapshot
        ? demoCodeTrail(snapshot)
        : undefined,
    [dashboard?.provider, snapshot],
  )
  const generation = useRef(0)
  // The board load in flight, so leaving a screen or opening another board
  // stops it instead of letting it finish and pull the view back.
  const loading = useRef<AbortController | null>(null)
  const startLoad = () => {
    loading.current?.abort()
    const controller = new AbortController()
    loading.current = controller
    generation.current++
    return { version: generation.current, signal: controller.signal }
  }
  const userId = useRef<string | null>(null)
  const acceptSession = (next: WorkspaceSession | null) => {
    userId.current = next?.user.id ?? null
    setSession(next)
  }
  const updateSession = (next: WorkspaceSession) => {
    if (next.user.id === userId.current) setSession(next)
  }
  // A return visit opens the briefing read last time, not the workspace hub.
  const returning = useRef<SavedDashboard | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    getSession(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          userId.current = result.session?.user.id ?? null
          setSession(result.session)
          returning.current = lastDashboard(result.session)
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not reach the local workspace server.',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false)
      })
    const expired = () => {
      generation.current++
      userId.current = null
      setSession(null)
      setSnapshot(null)
      setDashboard(null)
      setView('home')
      setBusy(false)
      setBoardLoad(null)
      setNotice('')
      setError('Your session expired. Sign in again.')
    }
    window.addEventListener('flowlens-session-expired', expired)
    return () => {
      controller.abort()
      window.removeEventListener('flowlens-session-expired', expired)
    }
  }, [])
  // A briefing for a real board opened on the hosted site: count the step.
  const briefingKey =
    view === 'report' &&
    dashboard &&
    snapshot &&
    dashboard.provider !== 'demo' &&
    session?.workspaceId
      ? `${dashboard.id}:${snapshot.loadedAt}`
      : ''
  useEffect(() => {
    if (briefingKey) track('briefing_built')
  }, [briefingKey])
  // Loomy asks whether it was useful: once per browser, after a while. The
  // demo board has its own question, counted apart from real boards.
  const asksAbout = briefingKey
    ? 'briefing'
    : view === 'report' && snapshot && dashboard?.provider === 'demo'
      ? 'demo'
      : null
  useEffect(
    () => (asksAbout ? askForFeedbackSoon(asksAbout) : undefined),
    [asksAbout],
  )
  const navigate = (next: View) => {
    if (next === 'home' && loading.current) {
      loading.current.abort()
      generation.current++
      setBusy(false)
      setBoardLoad(null)
    }
    setView(next)
    window.scrollTo({ top: 0, behavior: 'instant' })
    window.requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>('#main-content h1')
      if (heading) {
        heading.tabIndex = -1
        heading.focus({ preventScroll: true })
      }
    })
  }
  const openDashboard = async (
    saved: SavedDashboard,
    configure = false,
    /** Refresh: reload from the provider, not the server's recent copy. */
    fresh = false,
  ) => {
    const { version, signal } = startLoad()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const connection = session?.connections.find(
        (item) => item.id === saved.connectionId,
      )
      if (saved.provider !== 'demo' && !connection)
        throw new Error('Reconnect this dashboard’s provider first.')
      if (saved.provider !== 'demo')
        setBoardLoad(startBoardLoad('open', [saved.name]))
      const loaded =
        saved.provider === 'demo'
          ? demoSnapshot(saved.boardId)
          : await getBoardSnapshot(
              connection!,
              saved.boardId,
              signal,
              (event) => {
                if (version === generation.current)
                  setBoardLoad((load) => updateBoardLoad(load, 0, { event }))
              },
              fresh,
            )
      if (version !== generation.current) return
      setBoardLoad(null)
      const columns = new Set(loaded.board.columns.map((column) => column.id))
      const mappingChanged =
        saved.filters.selectedColumnIds.some((id) => !columns.has(id)) ||
        saved.filters.selectedColumnIds.length === 0
      // A member cannot save a new mapping: say so before showing anything.
      if (mappingChanged && session?.workspaceRole === 'member')
        throw new Error(
          'This board’s workflow changed. Ask an owner or admin to update its dashboard.',
        )
      setSnapshot(loaded)
      setDashboard(
        mappingChanged
          ? {
              ...saved,
              filters: {
                ...saved.filters,
                selectedColumnIds: suggestLocalBoardColumns(loaded),
              },
            }
          : saved,
      )
      if (mappingChanged)
        setNotice(
          'This board’s workflow changed. Review the suggested stages before continuing.',
        )
      rememberLastDashboard(session, saved.id)
      navigate(configure || mappingChanged ? 'setup' : 'report')
    } catch (caught) {
      if (version === generation.current) setError(message(caught))
    } finally {
      if (version === generation.current) {
        setBusy(false)
        setBoardLoad(null)
      }
    }
  }
  const selectBoards = async (
    connection: WorkspaceConnection,
    boards: WorkspaceBoard[],
    metrics: DashboardMetric[],
  ) => {
    if (boards.length > 10) throw new Error('Choose up to 10 boards at a time.')
    const { version, signal } = startLoad()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setBoardLoad(
        startBoardLoad(
          'select',
          boards.map((board) => board.name),
        ),
      )
      const loaded = await Promise.all(
        boards.map(async (board, index) => {
          const loadedBoard = await getBoardSnapshot(
            connection,
            board.id,
            signal,
            (event) => {
              if (version === generation.current)
                setBoardLoad((load) => updateBoardLoad(load, index, { event }))
            },
          )
          if (version === generation.current)
            setBoardLoad((load) => updateBoardLoad(load, index, { done: true }))
          return loadedBoard
        }),
      )
      if (version !== generation.current) return
      setBoardLoad(null)
      const dashboards = loaded.map(
        (board) =>
          ({
            id: `${connection.id}:${board.board.id}`,
            name: board.board.name,
            connectionId: connection.id,
            provider: connection.provider,
            boardId: board.board.id,
            projectKey: connection.projectKey,
            filters: {
              selectedColumnIds: suggestLocalBoardColumns(board),
              windowDays: 90,
              ticketTypes: [],
            },
            metrics,
          }) satisfies SavedDashboard,
      )
      for (const item of dashboards) {
        const result = await saveDashboard(item)
        if (version !== generation.current) return
        updateSession(result.session)
      }
      setSnapshot(loaded[0]!)
      setDashboard(dashboards[0]!)
      navigate('setup')
      if (dashboards.length > 1)
        setNotice(
          `${dashboards.length} dashboards created. Configure this board first; open the others from your workspace.`,
        )
    } catch (caught) {
      if (version === generation.current) throw caught
    } finally {
      if (version === generation.current) {
        setBusy(false)
        setBoardLoad(null)
      }
    }
  }
  // The briefing's own "Change" and team notes: save and stay on the briefing.
  const updateFilters = (filters: AnalysisFilters) =>
    dashboard ? saveInPlace({ ...dashboard, filters }) : undefined
  // Empty notes are dropped when the briefing is sent and saved.
  const updateTeamNotes = (teamNotes: string) =>
    dashboard
      ? saveInPlace({ ...dashboard, teamNotes: teamNotes || undefined })
      : undefined
  const saveInPlace = async (next: SavedDashboard) => {
    setDashboard(next)
    const version = generation.current
    setBusy(true)
    setError('')
    try {
      const result = await saveDashboard(next)
      if (version !== generation.current) return
      updateSession(result.session)
    } catch (caught) {
      if (version === generation.current) setError(message(caught))
    } finally {
      if (version === generation.current) setBusy(false)
    }
  }
  const persistReport = async () => {
    if (!dashboard) return
    const version = generation.current
    setBusy(true)
    setError('')
    try {
      const result = await saveDashboard(dashboard)
      if (version !== generation.current) return
      updateSession(result.session)
      navigate('report')
    } catch (caught) {
      if (version === generation.current) setError(message(caught))
    } finally {
      if (version === generation.current) setBusy(false)
    }
  }
  useEffect(() => {
    const saved = returning.current
    if (!saved || !session || checking) return
    returning.current = null
    void openDashboard(saved)
    // Opens once, when the session first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, checking])
  const signOut = async () => {
    setBusy(true)
    setError('')
    try {
      await workspaceRequest('/api/auth/logout', 'POST', {})
      loading.current?.abort()
      generation.current++
      acceptSession(null)
      setSnapshot(null)
      setDashboard(null)
      setBoardLoad(null)
      setNotice('')
      setView('home')
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="app-shell workspace-app">
      <div className="ambient-canvas" aria-hidden="true">
        <span className="ambient-canvas__orb ambient-canvas__orb--blue" />
        <span className="ambient-canvas__orb ambient-canvas__orb--mint" />
        <span className="ambient-canvas__orb ambient-canvas__orb--warm" />
      </div>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {checking ? (
        <main id="main-content" className="workspace-loading">
          <StatusMessage variant="loading">Opening Steerloom…</StatusMessage>
        </main>
      ) : !session &&
        new URLSearchParams(window.location.search).get('hosted') === '1' ? (
        <>
          {error && (
            <div className="workspace-auth-error">
              <StatusMessage variant="error">{error}</StatusMessage>
            </div>
          )}
          <HostedAccountSetup />
        </>
      ) : !session ? (
        <>
          {error && (
            <div className="workspace-auth-error">
              <StatusMessage variant="error">{error}</StatusMessage>
            </div>
          )}
          <SignIn
            onSession={(next) => {
              generation.current++
              acceptSession(next)
              setError('')
              setView('home')
            }}
          />
        </>
      ) : session.needsWorkspaceName ? (
        <GoogleWorkspaceSetup onSession={acceptSession} />
      ) : (
        <div className="workspace-container">
          <FloatingNavigation
            view={view}
            hasDashboard={dashboard !== null}
            hostedWorkspace={Boolean(session.workspaceId)}
            workspaceName={session.workspaceName}
            theme={theme}
            loadedAt={view === 'home' ? null : snapshot?.loadedAt}
            demo={view !== 'home' && dashboard?.provider === 'demo'}
            onOpenWorkspace={() => navigate('home')}
            onOpenDashboard={() =>
              navigate(view === 'setup' ? 'setup' : 'report')
            }
            onThemeToggle={toggleTheme}
            onSignOut={() => void signOut()}
            signOutDisabled={busy}
            notice={<UpdateNotice />}
          />
          <main id="main-content" className="workspace-main">
            {error && <StatusMessage variant="error">{error}</StatusMessage>}
            {notice && <StatusMessage variant="info">{notice}</StatusMessage>}
            {boardLoad
              ? // Boards picked on the home page show progress in that panel.
                !(view === 'home' && boardLoad.source === 'select') && (
                  <BoardLoadProgress load={boardLoad} />
                )
              : busy && (
                  <StatusMessage variant="loading">Working…</StatusMessage>
                )}
            {view === 'home' && (
              <WorkspaceHome
                session={session}
                onSession={updateSession}
                onOpen={openDashboard}
                onSelectBoards={selectBoards}
                busy={busy}
                boardLoad={boardLoad?.source === 'select' ? boardLoad : null}
              />
            )}
            {view === 'setup' && snapshot && dashboard && (
              <>
                <JiraAnalysisSetup
                  snapshot={snapshot}
                  filters={dashboard.filters}
                  onFiltersChange={(filters) =>
                    setDashboard({
                      ...dashboard,
                      filters,
                      reviewMode:
                        filters.windowDays === dashboard.filters.windowDays
                          ? dashboard.reviewMode
                          : 'custom',
                    })
                  }
                  briefing={
                    <GlassPanel className="workspace-dashboard-settings">
                      <ReviewPresetPicker
                        value={dashboard.reviewMode ?? 'custom'}
                        onChange={(preset) =>
                          setDashboard(applyReviewPreset(dashboard, preset))
                        }
                      />
                    </GlassPanel>
                  }
                  moreOptions={
                    <div className="setup-more__dashboard">
                      <label className="workspace-dashboard-name">
                        Dashboard name
                        <GlassInput
                          value={dashboard.name}
                          maxLength={150}
                          onChange={(event) =>
                            setDashboard({
                              ...dashboard,
                              name: event.target.value,
                            })
                          }
                        />
                      </label>
                      {session?.figma && !session.workspaceId && (
                        <FigmaFileField
                          value={dashboard.figmaFiles ?? []}
                          onChange={(figmaFiles) =>
                            setDashboard({
                              ...dashboard,
                              figmaFiles: figmaFiles.length
                                ? figmaFiles
                                : undefined,
                            })
                          }
                        />
                      )}
                      <details className="workspace-disclosure">
                        <summary>
                          Customize metrics ({dashboard.metrics.length}{' '}
                          selected)
                        </summary>
                        <MetricPicker
                          value={dashboard.metrics}
                          onChange={(metrics) =>
                            setDashboard({
                              ...dashboard,
                              metrics,
                              reviewMode: 'custom',
                            })
                          }
                        />
                      </details>
                    </div>
                  }
                  onBack={() => navigate('home')}
                  onContinue={() => void persistReport()}
                  canContinue={
                    !busy &&
                    dashboard.metrics.length > 0 &&
                    dashboard.name.trim().length > 0
                  }
                />
              </>
            )}
            {view === 'report' && snapshot && dashboard && (
              <>
                <Suspense
                  fallback={
                    <StatusMessage variant="loading">
                      Calculating your insights…
                    </StatusMessage>
                  }
                >
                  <FlowAnalysis
                    key={`${dashboard.id}:${snapshot.loadedAt}`}
                    snapshot={snapshot}
                    filters={dashboard.filters}
                    selectedMetrics={dashboard.metrics}
                    reviewMode={dashboard.reviewMode}
                    pullRequests={demoCode?.pullRequests ?? pullRequests}
                    branches={demoCode?.branches ?? branches}
                    pullRequestError={demoCode ? undefined : pullRequestError}
                    pullRequestsLoading={!demoCode && pullRequestsLoading}
                    codeHint={
                      // The local app connects GitHub itself; the hosted
                      // site points there.
                      demoCode && session.workspaceId ? (
                        <DemoCodeHint />
                      ) : undefined
                    }
                    refreshing={busy}
                    onRefresh={() => void openDashboard(dashboard, false, true)}
                    aiKeyForm={
                      session.workspaceRole === 'member' ? undefined : (
                        <AiKeySettings
                          session={session}
                          onSession={updateSession}
                          compact
                        />
                      )
                    }
                    aiConfigurationKey={JSON.stringify(session.ai ?? null)}
                    onAdjust={
                      session.workspaceRole === 'member'
                        ? undefined
                        : () => navigate('setup')
                    }
                    onFiltersChange={
                      session.workspaceRole === 'member'
                        ? undefined
                        : (filters) => void updateFilters(filters)
                    }
                    teamNotes={dashboard.teamNotes}
                    onTeamNotesChange={
                      session.workspaceRole === 'member'
                        ? undefined
                        : (notes) => void updateTeamNotes(notes)
                    }
                  />
                </Suspense>
              </>
            )}
          </main>
          <footer className="workspace-footer">
            <span>Steerloom</span>
            <span>
              Read-only sources. Transparent calculations. Your data stays in
              memory.
            </span>
          </footer>
        </div>
      )}
    </div>
  )
}
function message(caught: unknown) {
  return caught instanceof Error
    ? caught.message
    : 'Could not complete this request.'
}

/** Where the last opened briefing is remembered, per workspace, in this browser. */
function lastDashboardKey(session: WorkspaceSession): string {
  return `steerloom:last-briefing:${session.workspaceId ?? session.user.id}`
}

function rememberLastDashboard(session: WorkspaceSession | null, id: string) {
  if (!session) return
  try {
    window.localStorage.setItem(lastDashboardKey(session), id)
  } catch {
    // Private mode: nothing remembered, the hub opens next time.
  }
}

/**
 * The briefing to open on a return visit: the one read last time, when it
 * still exists and the address carries no other intent (a provider return,
 * a board link, or an explicit request for the workspace).
 */
function lastDashboard(
  session: WorkspaceSession | null,
): SavedDashboard | null {
  if (!session?.dashboards.length) return null
  const params = new URLSearchParams(window.location.search)
  if (
    ['jira', 'trello', 'connection', 'board', 'page', 'demo', 'reset'].some(
      (key) => params.has(key),
    ) ||
    params.get('view') === 'home'
  )
    return null
  try {
    const id = window.localStorage.getItem(lastDashboardKey(session))
    return session.dashboards.find((item) => item.id === id) ?? null
  } catch {
    return null
  }
}
