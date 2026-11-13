import { parseJiraConnectionUrl } from '../../lib/workspace/jira-url'
import { parseAzureDevOpsUrl } from '../../lib/workspace/azure-devops-url'
import { GoogleSignIn } from './GoogleSignIn'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react'
import { ArrowRight, Check, ChevronDown, Lock, Plus } from 'lucide-react'
import { SpotIcon } from '../../components/SpotIcon'
import { UiIcon } from '../../components/UiIcon'
import { ReachNote } from './ReachNote'
import { useHostedReach } from './use-hosted-reach'
import {
  GlassButton,
  GlassInput,
  GlassPanel,
  StatusBadge,
  StatusMessage,
} from '../../components/ui'
import { getBoards, workspaceRequest } from '../../lib/workspace/api'
import { AiKeySettings } from './AiKeySettings'
import { GithubLocalCard } from './GithubLocalNote'
import { GithubSettings } from './GithubSettings'
import { FigmaSettings } from './FigmaSettings'
import {
  defaultMetrics,
  type DashboardMetric,
  type SavedDashboard,
  type WorkspaceBoard,
  type WorkspaceConnection,
  type WorkspaceSession,
} from '../../lib/workspace/model'
import { ProviderIcon } from './ProviderIcon'
import { AiProviderMarks } from './AiProviderMarks'
import { BoardLoadProgress } from './BoardLoadProgress'
import type { BoardLoad } from '../../lib/workspace/board-progress'

interface Props {
  session: WorkspaceSession
  onSession: (session: WorkspaceSession) => void
  onOpen: (dashboard: SavedDashboard, configure?: boolean) => Promise<void>
  onSelectBoards: (
    connection: WorkspaceConnection,
    boards: WorkspaceBoard[],
    metrics: DashboardMetric[],
  ) => Promise<void>
  busy: boolean
  /** Boards being loaded after a selection here, with live progress. */
  boardLoad?: BoardLoad | null
}

/** The page with the one-command install for running Steerloom locally. */
const LOCAL_SETUP = '/?hosted=1&page=local'

const providerLabel = (provider: SavedDashboard['provider']) =>
  ({
    demo: 'Demo',
    jira: 'Jira',
    trello: 'Trello',
    'azure-devops': 'Azure DevOps',
  })[provider]

export function WorkspaceHome({
  session,
  onSession,
  onOpen,
  onSelectBoards,
  busy: parentBusy,
  boardLoad = null,
}: Props) {
  const [provider, setProvider] = useState<
    'jira' | 'trello' | 'azure-devops' | null
  >(null)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [projectKey, setProjectKey] = useState('')
  const [azureProject, setAzureProject] = useState('')
  const [apiKey, setApiKey] = useState('')
  // The gateway key field opens on request, or by itself when a company
  // gateway turns the connection away.
  const [gatewayOpen, setGatewayOpen] = useState(false)
  // The hosted site cannot reach this Jira: offer the local version instead.
  const [needsLocal, setNeedsLocal] = useState(false)
  const gatewayInput = useRef<HTMLInputElement>(null)
  const tokenInput = useRef<HTMLInputElement>(null)
  const openGateway = () => {
    setGatewayOpen(true)
    window.requestAnimationFrame(() => gatewayInput.current?.focus())
  }
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [connectionId, setConnectionId] = useState('')
  const [boards, setBoards] = useState<WorkspaceBoard[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const metrics = defaultMetrics
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cloudAvailable, setCloudAvailable] = useState<boolean | null>(null)
  const [cloudTokenAvailable, setCloudTokenAvailable] = useState(false)
  const [trelloAvailable, setTrelloAvailable] = useState(false)
  const [addOpen, setAddOpen] = useState(
    () => session.connections.length === 0 && session.dashboards.length === 0,
  )
  const [trelloReturn] = useState(() =>
    new URLSearchParams(window.location.search).get('trello'),
  )
  const [trelloReason] = useState(() =>
    new URLSearchParams(window.location.search).get('trelloReason'),
  )
  const [jiraReturn] = useState(() =>
    new URLSearchParams(window.location.search).get('jira'),
  )
  const request = useRef<AbortController | null>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    workspaceRequest<{
      atlassian: boolean
      jiraCloudToken?: boolean
      trello?: boolean
    }>('/api/auth/providers', 'GET', undefined, controller.signal)
      .then((result) => {
        setCloudAvailable(result.atlassian === true)
        setCloudTokenAvailable(result.jiraCloudToken === true)
        setTrelloAvailable(result.trello === true)
      })
      .catch(() => {
        if (!controller.signal.aborted) setCloudAvailable(false)
      })
    return () => {
      controller.abort()
      request.current?.abort()
    }
  }, [])
  const editing = session.workspaceRole !== 'member'
  const working = busy || parentBusy
  const jiraAddress = (() => {
    if (!baseUrl.trim()) return null
    try {
      return parseJiraConnectionUrl(baseUrl)
    } catch {
      return null
    }
  })()
  const azureAddress = (() => {
    if (provider !== 'azure-devops' || !baseUrl.trim()) return null
    try {
      return parseAzureDevOpsUrl(baseUrl)
    } catch {
      return null
    }
  })()
  const trelloBoardId = (() => {
    if (provider !== 'trello' || !baseUrl.trim()) return undefined
    try {
      const url = new URL(baseUrl)
      if (url.origin !== 'https://trello.com' || url.username || url.password)
        return undefined
      return /^\/b\/([a-zA-Z0-9]{8})(?:\/|$)/.exec(url.pathname)?.[1]
    } catch {
      return undefined
    }
  })()
  const jiraCloudToken =
    provider === 'jira' &&
    jiraAddress?.edition === 'cloud' &&
    cloudAvailable === false &&
    cloudTokenAvailable
  // OAuth flow; installs without an Atlassian app use the email + API token form.
  const jiraCloud =
    provider === 'jira' && jiraAddress?.edition === 'cloud' && !jiraCloudToken
  // The hosted site reaches Jira from the internet: company-network-only
  // Data Center needs the local version, so say what works here.
  const jiraEditions = session.workspaceId
    ? 'Cloud and public Data Center'
    : 'Cloud and Data Center'
  // Company-hosted addresses are checked from steerloom.app before anyone
  // looks for a token; cloud addresses are always reachable.
  const reach = useHostedReach(
    provider === 'jira' && jiraAddress && jiraAddress.edition !== 'cloud'
      ? jiraAddress.baseUrl
      : provider === 'azure-devops' && azureAddress?.edition === 'server'
        ? azureAddress.orgUrl
        : null,
    provider === 'azure-devops' ? 'azure-devops' : 'jira',
    Boolean(session.workspaceId),
  )
  const openProvider = (next: 'jira' | 'trello' | 'azure-devops') => {
    setProvider(next)
    setError('')
    setNotice('')
    setToken('')
    setEmail('')
    setApiKey('')
    setGatewayOpen(false)
    setNeedsLocal(false)
    setBaseUrl('')
    setName(
      next === 'jira'
        ? 'My Jira'
        : next === 'azure-devops'
          ? 'My Azure DevOps'
          : 'My Trello',
    )
    setProjectKey('')
    setAzureProject('')
    setTimeout(
      () => formRef.current?.querySelector<HTMLInputElement>('input')?.focus(),
      0,
    )
  }
  const revealConnect = () => {
    setAddOpen(true)
    setTimeout(() => {
      addRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      addRef.current?.querySelector<HTMLElement>('summary')?.focus()
    }, 0)
  }
  const discover = async (
    connection: WorkspaceConnection,
    targetBoard?: string,
  ) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    setNotice('')
    setConnectionId(connection.id)
    setBoards([])
    setSelected([])
    setQuery('')
    try {
      const result = await getBoards(connection.id, controller.signal)
      if (!controller.signal.aborted) {
        const match = targetBoard
          ? result.boards.find(
              (board) =>
                board.id === targetBoard ||
                board.shortLink === targetBoard ||
                (connection.provider === 'azure-devops' &&
                  board.name.toLowerCase() === targetBoard.toLowerCase()),
            )
          : result.boards.length === 1
            ? result.boards[0]
            : undefined
        if (match) {
          await onSelectBoards(connection, [match], metrics)
          return
        }
        setBoards(result.boards)
        if (targetBoard && result.boards.length)
          setNotice(
            'Choose a board below. The linked board was not found among your accessible boards.',
          )
        if (!result.boards.length)
          setNotice(
            'No accessible boards were found. Check the selected project and your provider permissions.',
          )
      }
      setTimeout(
        () =>
          boardRef.current?.scrollIntoView?.({
            behavior: 'smooth',
            block: 'start',
          }),
        0,
      )
    } catch (caught) {
      if (!controller.signal.aborted) setError(message(caught))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const resumeCloudConnection = useEffectEvent(() => {
    const returnedId = new URLSearchParams(window.location.search).get(
      'connection',
    )
    const connection = returnedId
      ? session.connections.find((item) => item.id === returnedId)
      : session.connections.at(-1)
    if (
      connection &&
      (connection.jiraEdition === 'cloud' || connection.provider === 'trello')
    )
      void discover(
        connection,
        new URLSearchParams(window.location.search).get('board') ?? undefined,
      )
  })
  useEffect(() => {
    if (!jiraReturn && !trelloReturn) return
    const url = new URL(window.location.href)
    url.searchParams.delete('jira')
    url.searchParams.delete('trello')
    url.searchParams.delete('trelloReason')
    window.history.replaceState(null, '', url)
    if (jiraReturn === 'connected' || trelloReturn === 'connected')
      resumeCloudConnection()
    const clean = new URL(window.location.href)
    clean.searchParams.delete('connection')
    clean.searchParams.delete('board')
    window.history.replaceState(null, '', clean)
    if (jiraReturn === 'error')
      setError(
        'Jira authorization was not completed. Try connecting again and approve the same site as your project link.',
      )
    if (trelloReturn === 'error')
      setError(
        trelloReason === 'exchange'
          ? 'Trello could not exchange the approval. Check the OAuth client ID and secret on the server, then try again.'
          : trelloReason === 'boards'
            ? 'Trello approved access, but Steerloom could not load boards. Check the app read permissions and try again.'
            : trelloReason === 'save'
              ? 'Trello approved access, but Steerloom could not save the connection. Try again.'
              : trelloReason === 'permission'
                ? 'Only workspace owners and admins can connect Trello.'
                : trelloReason === 'denied'
                  ? 'Trello did not grant access. If you cancelled, start again. Otherwise check that the Trello app does not use Power-Up capabilities and its callback URL matches this site.'
                  : 'Trello authorization expired or lost your sign-in session. Start the connection again.',
      )
  }, [jiraReturn, trelloReturn, trelloReason])

  const connect = async (event: FormEvent) => {
    event.preventDefault()
    if (working) return
    // Once the page is leaving for the provider, the button stays disabled.
    let leaving = false
    setBusy(true)
    setError('')
    setNeedsLocal(false)
    setNotice('')
    try {
      if (provider === 'trello' && baseUrl.trim() && !trelloBoardId)
        throw new Error(
          'Paste a Trello board link, such as https://trello.com/b/AbCd1234/team.',
        )
      if (provider === 'trello' && session.workspaceId) {
        const result = await workspaceRequest<{ url: string }>(
          '/api/workspace/trello/start',
          'POST',
          { link: baseUrl },
        )
        leaving = true
        window.location.assign(result.url)
        return
      }
      if (jiraCloud) {
        const result = await workspaceRequest<{ url: string }>(
          '/api/auth/atlassian/start',
          'POST',
          {
            link: baseUrl,
            projectKey: jiraAddress?.projectKey ?? projectKey,
          },
        )
        leaving = true
        window.location.assign(result.url)
        return
      }
      const result = await workspaceRequest<{ session: WorkspaceSession }>(
        '/api/workspace/connections',
        'POST',
        provider === 'azure-devops'
          ? {
              provider,
              name,
              baseUrl,
              ...(azureAddress?.project ? {} : { project: azureProject }),
              token,
            }
          : {
              provider,
              name,
              baseUrl,
              projectKey:
                provider === 'jira'
                  ? (jiraAddress?.projectKey ?? projectKey)
                  : projectKey,
              ...(jiraCloudToken ? { email } : { apiKey }),
              token,
            },
      )
      setToken('')
      setEmail('')
      setApiKey('')
      setProvider(null)
      onSession(result.session)
      await discover(
        result.session.connections.at(-1)!,
        provider === 'jira'
          ? jiraAddress?.boardId
          : provider === 'azure-devops'
            ? azureAddress?.team
            : trelloBoardId,
      )
    } catch (caught) {
      setError(message(caught))
      const reason = (caught as { reason?: unknown } | null)?.reason
      if (
        reason === 'gateway-key-required' ||
        reason === 'gateway-key-rejected'
      )
        openGateway()
      if (
        reason === 'jira-not-reachable-hosted' ||
        reason === 'azure-not-reachable-hosted'
      )
        setNeedsLocal(true)
      if (
        reason === 'jira-token-rejected' ||
        reason === 'azure-token-rejected'
      ) {
        setToken('')
        window.requestAnimationFrame(() => tokenInput.current?.focus())
      }
    } finally {
      if (!leaving) setBusy(false)
    }
  }
  const removeConnection = async (connection: WorkspaceConnection) => {
    if (
      !window.confirm(
        `Disconnect ${connection.name}? Its saved dashboards will also be removed. Source boards will not be changed.`,
      )
    )
      return
    setBusy(true)
    setError('')
    try {
      const result = await workspaceRequest<{ session: WorkspaceSession }>(
        `/api/workspace/connections/${connection.id}`,
        'DELETE',
        {},
      )
      onSession(result.session)
      if (connectionId === connection.id) {
        setConnectionId('')
        setBoards([])
        setSelected([])
      }
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }
  const removeDashboard = async (dashboard: SavedDashboard) => {
    setBusy(true)
    setError('')
    try {
      const result = await workspaceRequest<{ session: WorkspaceSession }>(
        `/api/workspace/dashboards/${dashboard.id}`,
        'DELETE',
        {},
      )
      onSession(result.session)
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }
  const createSelected = async () => {
    const connection = session.connections.find(
      (item) => item.id === connectionId,
    )
    if (!connection) return
    setError('')
    try {
      await onSelectBoards(
        connection,
        boards.filter((board) => selected.includes(board.id)),
        metrics,
      )
    } catch (caught) {
      setError(message(caught))
    }
  }
  const demo = (boardId: string) =>
    onOpen(
      {
        id: `demo:${boardId}`,
        name:
          boardId === 'demo-product'
            ? 'Product delivery · Demo'
            : 'Platform delivery · Demo',
        connectionId: 'demo',
        provider: 'demo',
        boardId,
        filters: {
          selectedColumnIds: ['stage-1', 'stage-2'],
          windowDays: 30,
          ticketTypes: [],
        },
        metrics: defaultMetrics,
      },
      true,
    )
  const hasDashboards = session.dashboards.length > 0
  // First run: no board connected yet. Show one clear path instead of the
  // full workspace toolbox.
  const firstRun = !hasDashboards && session.connections.length === 0
  const currentStep = firstRun ? 1 : 2
  const onlyConnection =
    session.connections.length === 1 ? session.connections[0] : undefined
  const enter = (index: number) =>
    ({ '--su-i': Math.min(index, 8) }) as CSSProperties
  return (
    <section
      className="workspace-home home screen-stack"
      aria-labelledby="workspace-title"
    >
      {!session.workspaceId && <GoogleSignIn session={session} />}
      {!editing && (
        <StatusMessage variant="info" className="home-permission">
          You have view access. Ask an owner or admin to connect boards or edit
          dashboards.
        </StatusMessage>
      )}
      {/* Before any dashboard the welcome fills the screen: a failed
          connection is said above it, not below the fold. */}
      {error && !provider && !connectionId && !hasDashboards && (
        <StatusMessage variant="error">{error}</StatusMessage>
      )}
      {hasDashboards ? (
        <header className="home-hero">
          <div className="home-hero__copy">
            <h1 id="workspace-title" className="page-title home-title">
              Your dashboards
            </h1>
            <p className="page-subtitle home-subtitle">
              Open a briefing to see what’s stuck, what needs a decision, and
              when work will land.
            </p>
          </div>
        </header>
      ) : (
        <>
          <header className="home-welcome su-enter" style={enter(0)}>
            <p className="home-eyebrow">
              {editing
                ? `Step ${currentStep} of 3 · about five minutes`
                : 'Nothing to read yet'}
            </p>
            <h1 id="workspace-title" className="home-welcome__title">
              {firstRun
                ? 'Your first briefing is five minutes away'
                : 'Pick a board for your first briefing'}
            </h1>
            <p className="home-welcome__lead">
              {firstRun
                ? 'Connect a board and Steerloom reads its history: what’s stuck, what needs a decision, and when work will land.'
                : 'Your connection is ready. Choose a board, then the stages to measure. Steerloom only reads it.'}
            </p>
            {firstRun && editing && (
              <div
                className="home-choice"
                role="group"
                aria-labelledby="home-choice-label"
              >
                <p id="home-choice-label" className="home-choice__label">
                  Where does your team’s work live?
                </p>
                <div className="home-choice__options">
                  <button
                    type="button"
                    className="home-choice__option"
                    disabled={working}
                    onClick={() => openProvider('jira')}
                    aria-label="Connect Jira"
                  >
                    <ProviderIcon provider="jira" small />
                    <span className="home-choice__copy">
                      <strong>Jira</strong>
                      <small>{jiraEditions}</small>
                    </span>
                    <UiIcon icon={ArrowRight} className="home-choice__arrow" />
                  </button>
                  <button
                    type="button"
                    className="home-choice__option"
                    disabled={working}
                    onClick={() => openProvider('trello')}
                    aria-label="Connect Trello"
                  >
                    <ProviderIcon provider="trello" small />
                    <span className="home-choice__copy">
                      <strong>Trello</strong>
                      <small>Boards and lists</small>
                    </span>
                    <UiIcon icon={ArrowRight} className="home-choice__arrow" />
                  </button>
                  <button
                    type="button"
                    className="home-choice__option"
                    disabled={working}
                    onClick={() => openProvider('azure-devops')}
                    aria-label="Connect Azure DevOps"
                  >
                    <ProviderIcon provider="azure-devops" small />
                    <span className="home-choice__copy">
                      <strong>Azure DevOps</strong>
                      <small>Azure Boards · Preview</small>
                    </span>
                    <UiIcon icon={ArrowRight} className="home-choice__arrow" />
                  </button>
                </div>
                <p className="home-choice__more">
                  <button
                    type="button"
                    className="home-link"
                    disabled={working}
                    onClick={() => void demo('demo-product')}
                  >
                    Explore the demo <span aria-hidden="true">→</span>
                  </button>
                  <span className="metadata-copy">
                    Fictional sample data, no account needed.
                  </span>
                </p>
                {session.workspaceId && (
                  <p className="metadata-copy home-choice__local">
                    Company board that only opens on your VPN?{' '}
                    <a href={LOCAL_SETUP}>Use Steerloom on your computer</a>
                  </p>
                )}
              </div>
            )}
            {!firstRun && editing && onlyConnection && (
              <GlassButton
                variant="primary"
                className="home-welcome__action"
                disabled={working}
                onClick={() => void discover(onlyConnection)}
              >
                Choose a board
              </GlassButton>
            )}
            <p className="home-trust">
              <UiIcon icon={Lock} size={16} className="home-lock" /> Read-only.
              Steerloom never changes your board.
            </p>
          </header>
          {editing && !provider && !connectionId && (
            <JourneyShowcase
              current={currentStep}
              style={enter(1)}
              className="su-enter"
            />
          )}
        </>
      )}
      {error && !provider && !connectionId && hasDashboards && (
        <StatusMessage variant="error">{error}</StatusMessage>
      )}
      {notice && <StatusMessage variant="info">{notice}</StatusMessage>}
      {hasDashboards && (
        <section aria-labelledby="dashboards-title" className="home-section">
          <h2 id="dashboards-title" className="visually-hidden">
            Your dashboards
          </h2>
          <div className="home-card-grid">
            {session.dashboards.map((dashboard, index) => (
              <DashboardTile
                key={dashboard.id}
                dashboard={dashboard}
                hero={index === 0}
                style={enter(index)}
                working={working}
                editing={editing}
                onOpen={() => void onOpen(dashboard)}
                onRemove={() => void removeDashboard(dashboard)}
              />
            ))}
            {editing && (
              <button
                type="button"
                className="home-card home-card--add su-enter"
                style={enter(session.dashboards.length)}
                disabled={working}
                onClick={revealConnect}
              >
                <span aria-hidden="true" className="home-card__plus">
                  <UiIcon icon={Plus} />
                </span>
                <strong>Connect another board</strong>
                <span className="metadata-copy">
                  Each board gets its own briefing.
                </span>
              </button>
            )}
          </div>
        </section>
      )}
      {session.connections.length > 0 && (
        <section
          className="home-quiet home-connections"
          aria-labelledby="connections-title"
        >
          <div className="home-quiet__heading">
            <h2 id="connections-title" className="home-quiet__title">
              Connections
            </h2>
            <p className="metadata-copy">
              Steerloom reads these sources and never changes them.
            </p>
          </div>
          <ul className="home-connection-list">
            {session.connections.map((connection) => (
              <li className="home-connection" key={connection.id}>
                <ProviderIcon provider={connection.provider} small />
                <div className="home-connection__identity">
                  <strong>{connection.name}</strong>
                  <span className="metadata-copy">
                    {connection.provider === 'jira'
                      ? `Jira · ${connection.projectKey}`
                      : providerLabel(connection.provider)}
                  </span>
                </div>
                <span className="home-readonly">
                  <UiIcon icon={Lock} size={16} className="home-lock" />{' '}
                  Read-only
                </span>
                <div className="home-connection__actions">
                  <GlassButton
                    size="compact"
                    disabled={working || !editing}
                    onClick={() => void discover(connection)}
                  >
                    Choose boards
                  </GlassButton>
                  <GlassButton
                    variant="quiet"
                    size="compact"
                    disabled={working || !editing}
                    onClick={() => void removeConnection(connection)}
                    aria-label={`Disconnect ${connection.name}`}
                  >
                    Disconnect
                  </GlassButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {editing && !firstRun && (!hasDashboards || addOpen) && (
        <details
          className="workspace-disclosure home-add"
          ref={addRef}
          open={addOpen}
          onToggle={(event) => setAddOpen(event.currentTarget.open)}
        >
          <summary className="home-add__summary">
            <span className="home-add__summary-copy">
              <span className="home-add__summary-title">
                Connect another board
              </span>
              <span className="metadata-copy">
                Read-only. Jira, Trello, Azure DevOps or the demo board.
              </span>
            </span>
            <UiIcon icon={ChevronDown} className="home-add__chevron" />
          </summary>
          <section aria-labelledby="providers-title" className="home-providers">
            <h2 id="providers-title" className="visually-hidden">
              Choose a provider
            </h2>
            <div className="home-provider-grid">
              <div className="home-provider">
                <div className="home-provider__heading">
                  <ProviderIcon provider="jira" small />
                  <div>
                    <h3>Jira</h3>
                    <p className="metadata-copy">{jiraEditions}</p>
                  </div>
                </div>
                <p className="body-copy">
                  Reads board columns and item history.
                </p>
                <GlassButton
                  size="compact"
                  disabled={working}
                  onClick={() => openProvider('jira')}
                >
                  Connect Jira
                </GlassButton>
              </div>
              <div className="home-provider">
                <div className="home-provider__heading">
                  <ProviderIcon provider="trello" small />
                  <div>
                    <h3>Trello</h3>
                    <p className="metadata-copy">Boards and lists</p>
                  </div>
                </div>
                <p className="body-copy">Reads how cards move across lists.</p>
                <GlassButton
                  size="compact"
                  disabled={working}
                  onClick={() => openProvider('trello')}
                >
                  Connect Trello
                </GlassButton>
              </div>
              <div className="home-provider">
                <div className="home-provider__heading">
                  <ProviderIcon provider="azure-devops" small />
                  <div>
                    <h3>Azure DevOps</h3>
                    <p className="metadata-copy">Azure Boards · Preview</p>
                  </div>
                </div>
                <p className="body-copy">
                  Reads board columns and work item history.
                </p>
                <GlassButton
                  size="compact"
                  disabled={working}
                  onClick={() => openProvider('azure-devops')}
                >
                  Connect Azure DevOps
                </GlassButton>
              </div>
              <div className="home-provider home-provider--demo">
                <div className="home-provider__heading">
                  <ProviderIcon provider="demo" small />
                  <div>
                    <h3>Demo board</h3>
                    <p className="metadata-copy">Fictional sample data</p>
                  </div>
                </div>
                <p className="body-copy">
                  See a full briefing before you connect a board.
                </p>
                <GlassButton
                  size="compact"
                  disabled={working}
                  onClick={() => void demo('demo-product')}
                >
                  Explore the demo
                </GlassButton>
              </div>
            </div>
          </section>
        </details>
      )}
      {provider && (
        <GlassPanel
          className="home-panel home-connect su-enter"
          ref={formRef}
          aria-labelledby="connect-title"
        >
          <div className="home-panel__heading">
            <div className="home-connect__identity">
              <ProviderIcon provider={provider} small />
              <h2
                id="connect-title"
                className="section-title home-panel__title"
              >
                Connect {providerLabel(provider)}
              </h2>
            </div>
            <GlassButton
              variant="quiet"
              disabled={working}
              onClick={() => {
                setProvider(null)
                setToken('')
                setEmail('')
                setApiKey('')
              }}
            >
              Cancel
            </GlassButton>
          </div>
          <form
            className="workspace-form workspace-form--connection home-form"
            onSubmit={connect}
            onInvalid={() =>
              setError(
                'Complete all required connection fields before connecting.',
              )
            }
            aria-busy={working}
          >
            {provider === 'jira' && (
              <>
                <label>
                  Jira link
                  <GlassInput
                    type="url"
                    placeholder={
                      session.workspaceId
                        ? 'https://your-team.atlassian.net/…'
                        : 'https://jira.example.com'
                    }
                    value={baseUrl}
                    onChange={(event) => {
                      setBaseUrl(event.target.value)
                      setError('')
                    }}
                    onBlur={() => {
                      if (!baseUrl.trim()) return
                      try {
                        const address = parseJiraConnectionUrl(baseUrl)
                        if (!projectKey && address.projectKey)
                          setProjectKey(address.projectKey)
                      } catch (caught) {
                        setError(message(caught))
                      }
                    }}
                    aria-describedby="jira-link-help"
                    required
                    maxLength={300}
                  />
                </label>
                <p className="metadata-copy" id="jira-link-help">
                  Paste a link to your Jira site, project, board, or ticket. We
                  find the connection address for you.
                </p>
                <ReachNote
                  {...reach}
                  product="Jira"
                  localSetup={LOCAL_SETUP}
                  onConnectAnyway={reach.connectAnyway}
                />
                {jiraCloud && (
                  <p className="metadata-copy home-form__hint">
                    {cloudAvailable === null
                      ? 'Checking connection setup…'
                      : cloudAvailable
                        ? 'Continue to Atlassian to approve read-only access. No token to copy.'
                        : 'Jira Cloud needs a one-time administrator setup on this installation.'}
                  </p>
                )}
                {jiraCloudToken && (
                  <>
                    <label>
                      Atlassian account email
                      <GlassInput
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="email"
                        required
                        maxLength={254}
                      />
                    </label>
                    <label>
                      API token
                      <GlassInput
                        type="password"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        autoComplete="off"
                        required
                        maxLength={512}
                        aria-describedby="jira-cloud-token-help"
                      />
                    </label>
                    <div className="token-help" id="jira-cloud-token-help">
                      <p className="token-help__title">
                        Getting your API token (one minute)
                      </p>
                      <ol>
                        <li>
                          Open{' '}
                          <a
                            href="https://id.atlassian.com/manage-profile/security/api-tokens"
                            target="_blank"
                            rel="noreferrer"
                          >
                            your Atlassian API tokens
                          </a>{' '}
                          (opens in a new tab).
                        </li>
                        <li>
                          Choose <strong>Create API token</strong>, name it
                          “Steerloom” and pick an expiry date.
                        </li>
                        <li>
                          Copy the token (it is shown only once) and paste it
                          above, with the email you use to sign in to Jira.
                        </li>
                      </ol>
                      <p className="metadata-copy">
                        Steerloom only reads your board and never changes
                        tickets.
                      </p>
                    </div>
                  </>
                )}
                {/* Which credentials are needed depends on the link (Jira
                    Cloud needs none here), so they wait for it. */}
                {jiraAddress &&
                  !jiraCloud &&
                  !jiraCloudToken &&
                  !reach.blocked && (
                    <>
                      <label>
                        Personal access token
                        <GlassInput
                          ref={tokenInput}
                          type="password"
                          value={token}
                          onChange={(event) => setToken(event.target.value)}
                          autoComplete="off"
                          required
                          maxLength={512}
                        />
                      </label>
                      <div className="token-help">
                        <p className="token-help__title">
                          Getting your personal access token
                        </p>
                        <ol>
                          <li>
                            In Jira, open your profile picture →{' '}
                            <strong>Profile</strong> →{' '}
                            <strong>Personal access tokens</strong>.
                          </li>
                          <li>
                            Choose <strong>Create token</strong>, name it
                            “Steerloom” and copy it.
                          </li>
                          <li>Paste it above.</li>
                        </ol>
                      </div>
                      {gatewayOpen || apiKey ? (
                        <div className="gateway-key">
                          <label>
                            API gateway key
                            <GlassInput
                              ref={gatewayInput}
                              type="password"
                              value={apiKey}
                              onChange={(event) =>
                                setApiKey(event.target.value)
                              }
                              autoComplete="off"
                              maxLength={512}
                              aria-describedby="gateway-key-help"
                            />
                          </label>
                          <div className="token-help" id="gateway-key-help">
                            <p className="token-help__title">
                              What is a gateway key?
                            </p>
                            <p>
                              Some companies put Jira behind an API gateway. The
                              gateway needs its own key, separate from your
                              personal access token: the token says who you are,
                              the key lets the request through the gateway.
                            </p>
                            <p>
                              It usually comes from the team that runs Jira or
                              developer access at your company. If Steerloom
                              connects without it, you don’t need one.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="home-link gateway-key__open"
                          onClick={() => openGateway()}
                        >
                          My company also gave me an API gateway key for Jira
                        </button>
                      )}
                      <details className="workspace-disclosure home-form__more">
                        <summary>Connection settings (optional)</summary>
                        <label>
                          Connection name
                          <GlassInput
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            maxLength={100}
                            required
                          />
                        </label>
                      </details>
                    </>
                  )}
                {jiraAddress && !jiraAddress.projectKey && !reach.blocked && (
                  <label>
                    Project key
                    <GlassInput
                      value={projectKey}
                      onChange={(event) =>
                        setProjectKey(event.target.value.toUpperCase())
                      }
                      required
                      placeholder="PROJECT"
                      maxLength={30}
                    />
                  </label>
                )}
                {jiraAddress && !jiraAddress.projectKey && !reach.blocked && (
                  <p className="metadata-copy">
                    Use the prefix from a ticket, such as DEMO in DEMO-123, or
                    paste a project link above.
                  </p>
                )}
              </>
            )}
            {provider === 'azure-devops' && (
              <>
                <label>
                  Azure DevOps link
                  <GlassInput
                    type="url"
                    placeholder="https://dev.azure.com/your-org/your-project"
                    value={baseUrl}
                    onChange={(event) => {
                      setBaseUrl(event.target.value)
                      setError('')
                    }}
                    onBlur={() => {
                      if (!baseUrl.trim()) return
                      try {
                        parseAzureDevOpsUrl(baseUrl)
                      } catch (caught) {
                        setError(message(caught))
                      }
                    }}
                    aria-describedby="azure-link-help"
                    required
                    maxLength={500}
                  />
                </label>
                <p className="metadata-copy" id="azure-link-help">
                  Paste a link to your project, board or a work item. A board
                  link opens that team’s board directly.
                </p>
                <ReachNote
                  {...reach}
                  product="Azure DevOps Server"
                  localSetup={LOCAL_SETUP}
                  onConnectAnyway={reach.connectAnyway}
                />
                {!reach.blocked && (
                  <>
                    {azureAddress && !azureAddress.project && (
                      <label>
                        Project name
                        <GlassInput
                          value={azureProject}
                          onChange={(event) =>
                            setAzureProject(event.target.value)
                          }
                          required
                          maxLength={128}
                        />
                      </label>
                    )}
                    <label>
                      Personal access token
                      <GlassInput
                        ref={tokenInput}
                        type="password"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        autoComplete="off"
                        required
                        maxLength={512}
                        aria-describedby="azure-token-help"
                      />
                    </label>
                    <div className="token-help" id="azure-token-help">
                      <p className="token-help__title">
                        Getting your personal access token (one minute)
                      </p>
                      <ol>
                        <li>
                          {azureAddress ? (
                            <>
                              Open{' '}
                              <a
                                href={`${azureAddress.orgUrl}/_usersSettings/tokens`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                your personal access tokens
                              </a>{' '}
                              (opens in a new tab).
                            </>
                          ) : (
                            <>
                              In Azure DevOps, open{' '}
                              <strong>User settings</strong> (top right) →{' '}
                              <strong>Personal access tokens</strong>.
                            </>
                          )}
                        </li>
                        <li>
                          Choose <strong>New Token</strong> and name it
                          “Steerloom”. Under <strong>Scopes</strong>, tick{' '}
                          <strong>Work Items: Read</strong> and{' '}
                          <strong>Project and Team: Read</strong> (show all
                          scopes to find it).
                        </li>
                        <li>
                          Copy the token (it is shown only once) and paste it
                          above.
                        </li>
                      </ol>
                      <p className="metadata-copy">
                        Steerloom only reads your board and never changes work
                        items.
                      </p>
                    </div>
                    <details className="workspace-disclosure home-form__more">
                      <summary>Connection settings (optional)</summary>
                      <label>
                        Connection name
                        <GlassInput
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          required
                          maxLength={100}
                        />
                      </label>
                    </details>
                  </>
                )}
              </>
            )}
            {provider === 'trello' && (
              <>
                <label>
                  Trello board link (optional)
                  <GlassInput
                    type="url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://trello.com/b/…"
                    maxLength={300}
                  />
                </label>
                <p className="metadata-copy">
                  Paste your board link to open its setup directly, or leave
                  blank to choose a board.
                </p>
                {session.workspaceId ? (
                  <p className="metadata-copy home-form__hint">
                    {trelloAvailable
                      ? 'Continue to Trello to approve read-only access, then choose your boards.'
                      : 'Trello connection is not available yet. Please try again later.'}
                  </p>
                ) : (
                  <>
                    <label>
                      API key
                      <GlassInput
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        autoComplete="off"
                        required
                        maxLength={128}
                      />
                    </label>
                    <label>
                      Read-only token
                      <GlassInput
                        type="password"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        autoComplete="off"
                        required
                        maxLength={256}
                      />
                    </label>
                    <p className="metadata-copy">
                      Create an API key in{' '}
                      <a
                        href="https://trello.com/apps/admin"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Trello’s developer portal
                      </a>
                      .{' '}
                      {apiKey && /^[a-zA-Z0-9]+$/.test(apiKey) && (
                        <a
                          href={`https://trello.com/1/authorize?expiration=30days&scope=read&response_type=token&name=Steerloom&key=${encodeURIComponent(apiKey)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Generate a read-only token
                        </a>
                      )}
                    </p>
                  </>
                )}
                <details className="workspace-disclosure home-form__more">
                  <summary>Connection settings (optional)</summary>
                  <label>
                    Connection name
                    <GlassInput
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                      maxLength={100}
                    />
                  </label>
                </details>
              </>
            )}
            {!reach.blocked && (
              <p className="metadata-copy home-form__privacy">
                Read-only access. Credentials are encrypted on the server.
                {session.workspaceId &&
                  ' Connecting shares board access with members of this workspace.'}
              </p>
            )}
            {error && <StatusMessage variant="error">{error}</StatusMessage>}
            {error && needsLocal && (
              <a
                className="glass-button home-form__local"
                data-variant="secondary"
                href={LOCAL_SETUP}
              >
                Set up Steerloom on my computer
                <UiIcon icon={ArrowRight} size={16} />
              </a>
            )}
            {busy && (
              <StatusMessage variant="loading">
                Checking provider access. A network timeout can take up to 30
                seconds.
              </StatusMessage>
            )}
            {!reach.blocked && (
              <GlassButton
                type="submit"
                variant="primary"
                className="home-form__submit"
                disabled={
                  working ||
                  (jiraCloud && !cloudAvailable) ||
                  (provider === 'trello' &&
                    !!session.workspaceId &&
                    !trelloAvailable)
                }
              >
                {busy
                  ? jiraCloud
                    ? 'Opening Atlassian…'
                    : 'Checking connection…'
                  : jiraCloud
                    ? 'Connect with Atlassian'
                    : provider === 'trello' && session.workspaceId
                      ? 'Connect with Trello'
                      : 'Connect and find boards'}
              </GlassButton>
            )}
          </form>
        </GlassPanel>
      )}
      {connectionId && (
        <GlassPanel
          className="home-panel home-boards su-enter"
          ref={boardRef}
          aria-labelledby="boards-title"
        >
          {error && !provider && (
            <StatusMessage variant="error">{error}</StatusMessage>
          )}
          <div className="home-panel__heading">
            <div>
              <h2 id="boards-title" className="section-title home-panel__title">
                Choose boards
              </h2>
              <p className="metadata-copy">Each board gets its own briefing.</p>
            </div>
            <StatusBadge tone="info">{selected.length} selected</StatusBadge>
          </div>
          {boardLoad ? (
            <BoardLoadProgress load={boardLoad} />
          ) : busy ? (
            <StatusMessage variant="loading">
              Finding boards you can access…
            </StatusMessage>
          ) : (
            <>
              <label className="workspace-search home-search">
                Find a board
                <GlassInput
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search board names…"
                />
              </label>
              <div className="workspace-board-options home-board-options">
                {boards
                  .filter((board) =>
                    board.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((board) => (
                    <label
                      className="workspace-board-option home-board-option"
                      key={board.id}
                      data-selected={selected.includes(board.id)}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(board.id)}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? [...selected, board.id]
                              : selected.filter((id) => id !== board.id),
                          )
                        }
                      />
                      <span>
                        <strong>{board.name}</strong>
                        <small>Board {board.id}</small>
                      </span>
                    </label>
                  ))}
              </div>
              {boards.length > 0 &&
                !boards.some((board) =>
                  board.name.toLowerCase().includes(query.toLowerCase()),
                ) && <p className="body-copy">No boards match this search.</p>}
              {boards.length > 0 && (
                <div className="home-boards__footer">
                  <p className="metadata-copy">
                    Next: pick the stages to measure and how often you’ll read
                    it.
                  </p>
                  <GlassButton
                    variant="primary"
                    disabled={working || !selected.length || !metrics.length}
                    onClick={() => void createSelected()}
                  >
                    {parentBusy
                      ? 'Setting up…'
                      : `Set up ${selected.length || ''} ${selected.length === 1 ? 'dashboard' : 'dashboards'}`}
                  </GlassButton>
                </div>
              )}
            </>
          )}
        </GlassPanel>
      )}
      {hasDashboards && (
        <section
          className="home-settings"
          aria-labelledby="workspace-settings-title"
        >
          <h2 id="workspace-settings-title" className="home-quiet__title">
            Workspace settings
          </h2>
          <AiKeySettings
            session={session}
            onSession={onSession}
            disabled={working}
          />
          {/* Local app only for now: company GitHub is usually internal. The
              hosted site says so and points to the local version. */}
          {session.workspaceId ? (
            <GithubLocalCard />
          ) : (
            <>
              <GithubSettings
                session={session}
                onSession={onSession}
                disabled={working}
              />
              <FigmaSettings
                session={session}
                onSession={onSession}
                disabled={working}
              />
            </>
          )}
        </section>
      )}
    </section>
  )
}
const JOURNEY = [
  {
    title: 'Connect a board',
    body: 'Read-only access to Jira, Trello or Azure DevOps. Credentials are encrypted on the server.',
  },
  {
    title: 'Choose what to measure',
    body: 'Pick the stages where work happens and how often you’ll read the briefing.',
  },
  {
    title: 'Read your briefing',
    body: 'See what’s stuck, what needs a decision, and when work will land.',
  },
  {
    title: 'Ask your AI assistant',
    body: 'Optional: add your team’s own key for Claude, OpenAI, Gemini or Grok, and ask about the briefing in your own words.',
  },
] as const

// Sample board for the illustration: chips per stage, of which past the limit.
const SAMPLE_LANES: ReadonlyArray<{
  name: string
  chips: number
  late: number
  measured: boolean
}> = [
  { name: 'To do', chips: 3, late: 0, measured: false },
  { name: 'In progress', chips: 6, late: 3, measured: true },
  { name: 'Review', chips: 2, late: 0, measured: true },
]

/**
 * The three-step guide in the landing page's story-tabs style: a rail on the
 * left, the open step as a white card, and a sample board on the right that
 * shows what that step does. User-driven; nothing advances on its own.
 */
function JourneyShowcase({
  current,
  className,
  style,
}: {
  current: number
  className?: string
  style?: CSSProperties
}) {
  const [open, setOpen] = useState(current - 1)
  let chip = 0
  return (
    <section
      className={`home-journey ${className ?? ''}`.trim()}
      style={style}
      aria-label="How it works"
    >
      <ol className="home-steps" aria-label="Getting started">
        {JOURNEY.map((step, index) => {
          const state =
            index + 1 < current
              ? 'done'
              : index + 1 === current
                ? 'current'
                : 'next'
          return (
            <li
              key={step.title}
              data-state={state}
              data-open={open === index}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <button
                type="button"
                className="home-steps__toggle"
                aria-expanded={open === index}
                aria-controls={`home-step-${index}`}
                onClick={() => setOpen(index)}
              >
                <span className="home-steps__number" aria-hidden="true">
                  {state === 'done' ? (
                    <UiIcon icon={Check} size={16} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="home-steps__title">{step.title}</span>
                {state === 'done' && (
                  <span className="visually-hidden">, done</span>
                )}
              </button>
              <p
                id={`home-step-${index}`}
                className="home-steps__body"
                hidden={open !== index}
              >
                {step.body}
              </p>
            </li>
          )
        })}
      </ol>
      <div className="home-visual" data-step={open + 1} aria-hidden="true">
        <span className="home-visual__blob home-visual__blob--one" />
        <span className="home-visual__blob home-visual__blob--two" />
        <p className="home-visual__caption">
          {open === 0
            ? 'Your board, read-only'
            : open === 1
              ? 'Measured: In progress → Review'
              : open === 2
                ? 'Your briefing'
                : 'Your AI, your key'}
        </p>
        {/* The board keeps its place on every step, so the panel never
            changes size; on the AI step the services show over it. */}
        <div className="home-visual__stage">
          <div className="home-visual__board">
            {SAMPLE_LANES.map((lane) => (
              <div
                className="home-visual__lane"
                data-measured={lane.measured}
                key={lane.name}
              >
                <div className="home-visual__stack">
                  {Array.from({ length: lane.chips }, (_, index) => (
                    <span
                      className="home-chip"
                      data-late={index < lane.late || undefined}
                      key={index}
                      style={{ '--su-i': Math.min(chip++, 8) } as CSSProperties}
                    />
                  ))}
                </div>
                <span className="home-visual__name">{lane.name}</span>
              </div>
            ))}
          </div>
          {open === 3 && (
            <div className="home-visual__ai">
              <AiProviderMarks size="large" />
            </div>
          )}
        </div>
        <div className="home-visual__signal">
          <SpotIcon
            name={open === 3 ? 'assistant' : 'bottleneck'}
            size={44}
            className="home-visual__icon"
          />
          <span className="home-visual__signal-copy">
            {open === 3 ? (
              <>
                <strong>Why is In progress piling up?</strong>
                <span>
                  Three of its six items are past the usual limit, all waiting
                  for review.
                </span>
              </>
            ) : (
              <>
                <strong>Bottleneck</strong>
                <span>
                  In progress holds 6 items; 3 are past the usual limit.
                </span>
              </>
            )}
          </span>
          <span className="home-visual__sample">Sample</span>
        </div>
      </div>
    </section>
  )
}

function DashboardTile({
  dashboard,
  hero,
  style,
  working,
  editing,
  onOpen,
  onRemove,
}: {
  dashboard: SavedDashboard
  hero: boolean
  style: CSSProperties
  working: boolean
  editing: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  const days = dashboard.filters.windowDays
  const stages = dashboard.filters.selectedColumnIds.length
  const insights = dashboard.metrics.length
  return (
    <article
      className="home-card su-enter"
      data-hero={hero || undefined}
      style={style}
      aria-label={dashboard.name}
    >
      <div className="home-card__top">
        <ProviderIcon provider={dashboard.provider} small />
      </div>
      <h3 className="home-card__title">{dashboard.name}</h3>
      <p className="home-card__metric">
        <span className="home-card__number">{days ?? 'All'}</span>{' '}
        <span className="home-card__unit">
          {days ? 'days of finished work' : 'available history'}
        </span>
      </p>
      <p className="home-card__line">
        {providerLabel(dashboard.provider)} · {stages}{' '}
        {stages === 1 ? 'stage' : 'stages'} measured · {insights}{' '}
        {insights === 1 ? 'insight' : 'insights'}
      </p>
      <div className="home-card__actions">
        <GlassButton
          variant={hero ? 'primary' : 'secondary'}
          className="home-card__open"
          disabled={working}
          onClick={onOpen}
        >
          Open briefing
        </GlassButton>
        <GlassButton
          variant="quiet"
          size="compact"
          disabled={working || !editing}
          onClick={onRemove}
          aria-label={`Remove dashboard ${dashboard.name}`}
        >
          Remove
        </GlassButton>
      </div>
    </article>
  )
}

function message(caught: unknown) {
  return caught instanceof Error
    ? caught.message
    : 'Could not complete this request.'
}
