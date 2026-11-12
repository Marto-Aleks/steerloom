import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { defaultMetrics } from '../../lib/workspace/model'
import { WorkspaceHome } from './WorkspaceHome'

const mocks = vi.hoisted(() => ({ request: vi.fn(), boards: vi.fn() }))
vi.mock('../../lib/workspace/api', () => ({
  workspaceRequest: mocks.request,
  getBoards: mocks.boards,
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('shows pending progress and a recoverable network error beside the connection button', async () => {
  let rejectConnection!: (reason: Error) => void
  mocks.request.mockImplementation((path: string) =>
    path.endsWith('/local-jira')
      ? Promise.resolve({ connections: [] })
      : new Promise((_resolve, reject) => {
          rejectConnection = reject
        }),
  )
  render(
    <WorkspaceHome
      session={{
        user: { id: 'fictional', username: 'tester' },
        workspaceName: 'Test',
        connections: [],
        dashboards: [],
      }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Connect Trello/ }))
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'fictionalkey' },
  })
  fireEvent.change(screen.getByLabelText('Read-only token'), {
    target: { value: 'fictionaltoken' },
  })
  const button = screen.getByRole('button', { name: 'Connect and find boards' })
  const form = button.closest('form')!
  fireEvent.click(button)
  expect(
    screen.getByRole('button', { name: 'Checking connection…' }),
  ).toBeDisabled()
  expect(within(form).getByRole('status')).toHaveTextContent(
    'Checking provider access',
  )
  await act(async () =>
    rejectConnection(
      new Error('The local server could not resolve api.trello.com.'),
    ),
  )
  expect(within(form).getByRole('alert')).toHaveTextContent(
    'could not resolve api.trello.com',
  )
  expect(
    screen.getByRole('button', { name: 'Connect and find boards' }),
  ).toBeEnabled()
  expect(screen.getByLabelText('Read-only token')).toHaveValue('fictionaltoken')
  expect(mocks.boards).not.toHaveBeenCalled()
})

it('connects a project link without requiring a separate project or connection-name field', async () => {
  mocks.request.mockImplementation((path: string) =>
    path.endsWith('/local-jira')
      ? Promise.resolve({ connections: [] })
      : path.endsWith('/providers')
        ? Promise.resolve({ google: false })
        : Promise.reject(new Error('Fictional recoverable Jira error')),
  )
  render(
    <WorkspaceHome
      session={{
        user: { id: 'fictional', username: 'tester' },
        workspaceName: 'Test',
        connections: [],
        dashboards: [],
      }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Connect Jira/ }))
  const link = 'https://jira.example.invalid/instance/projects/DEMO/summary'
  fireEvent.change(screen.getByLabelText('Jira link'), {
    target: { value: link },
  })
  fireEvent.change(screen.getByLabelText('Personal access token'), {
    target: { value: 'fictional-pat' },
  })
  expect(screen.queryByLabelText('Project key')).not.toBeInTheDocument()
  await act(async () => {
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Connect and find boards' })
        .closest('form')!,
    )
  })
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/workspace/connections',
    'POST',
    expect.objectContaining({
      projectKey: 'DEMO',
      baseUrl: link,
      token: 'fictional-pat',
    }),
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Fictional recoverable Jira error',
  )
})

it('offers Atlassian authorization for a Cloud project without asking for a token', async () => {
  mocks.request.mockImplementation((path: string) =>
    path.endsWith('/local-jira')
      ? Promise.resolve({ connections: [] })
      : path.endsWith('/providers')
        ? Promise.resolve({ google: false, atlassian: true })
        : Promise.reject(new Error('Fictional authorization start error')),
  )
  render(
    <WorkspaceHome
      session={{
        user: { id: 'fictional', username: 'tester' },
        workspaceName: 'Test',
        connections: [],
        dashboards: [],
      }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Connect Jira/ }))
  const link =
    'https://fictional.atlassian.net/jira/software/c/projects/DEMO/boards/1'
  fireEvent.change(screen.getByLabelText('Jira link'), {
    target: { value: link },
  })
  const button = screen.getByRole('button', { name: 'Connect with Atlassian' })
  await waitFor(() => expect(button).toBeEnabled())
  expect(
    screen.queryByLabelText('Personal access token'),
  ).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Project key')).not.toBeInTheDocument()
  await act(async () => {
    fireEvent.submit(button.closest('form')!)
  })
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/auth/atlassian/start',
    'POST',
    { link, projectKey: 'DEMO' },
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Fictional authorization start error',
  )
})

it('asks for an Atlassian email and API token when this install has no Atlassian app', async () => {
  mocks.request.mockImplementation((path: string) =>
    path.endsWith('/local-jira')
      ? Promise.resolve({ connections: [] })
      : path.endsWith('/providers')
        ? Promise.resolve({ atlassian: false, jiraCloudToken: true })
        : Promise.reject(new Error('Fictional Jira Cloud error')),
  )
  render(
    <WorkspaceHome
      session={{
        user: { id: 'fictional', username: 'tester' },
        workspaceName: 'Test',
        connections: [],
        dashboards: [],
      }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Connect Jira/ }))
  const link =
    'https://fictional.atlassian.net/jira/software/c/projects/DEMO/boards/1'
  fireEvent.change(screen.getByLabelText('Jira link'), {
    target: { value: link },
  })
  const email = await screen.findByLabelText('Atlassian account email')
  fireEvent.change(email, { target: { value: 'person@example.invalid' } })
  fireEvent.change(screen.getByLabelText('API token'), {
    target: { value: 'fictional-api-token' },
  })
  expect(
    screen.getByRole('link', { name: /your Atlassian API tokens/ }),
  ).toHaveAttribute(
    'href',
    'https://id.atlassian.com/manage-profile/security/api-tokens',
  )
  expect(screen.queryByText(/administrator setup/)).not.toBeInTheDocument()
  expect(
    screen.queryByLabelText('Personal access token'),
  ).not.toBeInTheDocument()
  await act(async () => {
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Connect and find boards' })
        .closest('form')!,
    )
  })
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/workspace/connections',
    'POST',
    expect.objectContaining({
      provider: 'jira',
      baseUrl: link,
      projectKey: 'DEMO',
      email: 'person@example.invalid',
      token: 'fictional-api-token',
    }),
  )
  expect(mocks.request).not.toHaveBeenCalledWith(
    '/api/auth/atlassian/start',
    expect.anything(),
    expect.anything(),
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Fictional Jira Cloud error',
  )
})

it.each([true, false])(
  'opens only an accessible linked Trello board (match: %s)',
  async (matched) => {
    const connection = {
      id: 'test-connection',
      provider: 'trello' as const,
      name: 'My Trello',
    }
    const session = {
      user: { id: 'fictional', username: 'tester' },
      workspaceName: 'Test',
      connections: [connection],
      dashboards: [],
    }
    const board = {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      name: 'Team',
      shortLink: matched ? 'AbCd1234' : 'ZyXw9876',
    }
    mocks.request.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('/local-jira')
          ? { connections: [] }
          : path.endsWith('/providers')
            ? { atlassian: false }
            : { session },
      ),
    )
    mocks.boards.mockResolvedValue({ boards: [board] })
    const select = vi.fn().mockResolvedValue(undefined)
    render(
      <WorkspaceHome
        session={{ ...session, connections: [] }}
        busy={false}
        onSession={vi.fn()}
        onOpen={vi.fn()}
        onSelectBoards={select}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Connect Trello/ }))
    fireEvent.change(screen.getByLabelText('Trello board link (optional)'), {
      target: { value: 'https://trello.com/b/AbCd1234/team' },
    })
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'fictionalkey' },
    })
    fireEvent.change(screen.getByLabelText('Read-only token'), {
      target: { value: 'fictionaltoken' },
    })
    await act(async () => {
      fireEvent.submit(
        screen
          .getByRole('button', { name: 'Connect and find boards' })
          .closest('form')!,
      )
    })
    if (matched)
      expect(select).toHaveBeenCalledWith(
        connection,
        [board],
        expect.any(Array),
      )
    else {
      expect(select).not.toHaveBeenCalled()
      expect(screen.getByText(/linked board was not found/)).toBeInTheDocument()
    }
  },
)

it('starts hosted Trello approval without asking users for API keys or tokens', async () => {
  mocks.request.mockImplementation((path: string) =>
    path.endsWith('/local-jira')
      ? Promise.resolve({ connections: [] })
      : path.endsWith('/providers')
        ? Promise.resolve({ trello: true })
        : Promise.reject(new Error('Fictional retry message')),
  )
  render(
    <WorkspaceHome
      session={{
        user: { id: 'fictional', username: 'tester' },
        workspaceId: '20000000-0000-4000-8000-000000000001',
        workspaceRole: 'owner',
        workspaceName: 'Team',
        connections: [],
        dashboards: [],
      }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Connect Trello/ }))
  const button = screen.getByRole('button', { name: 'Connect with Trello' })
  await waitFor(() => expect(button).toBeEnabled())
  expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Read-only token')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Trello board link (optional)'), {
    target: { value: 'https://trello.com/b/AbCd1234/team' },
  })
  await act(async () => {
    fireEvent.submit(button.closest('form')!)
  })
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/workspace/trello/start',
    'POST',
    { link: 'https://trello.com/b/AbCd1234/team' },
  )
  expect(mocks.boards).not.toHaveBeenCalled()
})

it('guides a brand-new workspace through one clear first step', () => {
  mocks.request.mockReturnValue(new Promise(() => {}))
  render(
    <WorkspaceHome
      session={{
        user: { id: 'fictional', username: 'tester' },
        workspaceName: 'Test',
        connections: [],
        dashboards: [],
      }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={vi.fn()}
    />,
  )
  expect(
    screen.getByRole('heading', {
      name: 'Your first briefing is five minutes away',
    }),
  ).toBeInTheDocument()
  const steps = screen.getByRole('list', { name: 'Getting started' })
  // Three steps to a briefing, then the optional AI assistant.
  expect(
    within(steps)
      .getAllByRole('listitem')
      .map((step) => step.querySelector('.home-steps__title')?.textContent),
  ).toEqual([
    'Connect a board',
    'Choose what to measure',
    'Read your briefing',
    'Ask your AI assistant',
  ])
  expect(
    within(steps).getByText('Connect a board').closest('li'),
  ).toHaveAttribute('aria-current', 'step')
  expect(
    screen.queryByRole('button', { name: /\+ Connect a board/ }),
  ).not.toBeInTheDocument()
  expect(screen.queryByText('AI assistant')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Connect Jira/ })).toBeVisible()
})

it('lets people read each first-run step without advancing on its own', () => {
  mocks.request.mockReturnValue(new Promise(() => {}))
  render(
    <WorkspaceHome
      session={{
        user: { id: 'fictional', username: 'tester' },
        workspaceName: 'Test',
        connections: [],
        dashboards: [],
      }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={vi.fn()}
    />,
  )
  const last = screen.getByRole('button', { name: /Read your briefing/ })
  expect(last).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(last)
  expect(last).toHaveAttribute('aria-expanded', 'true')
  expect(
    screen.getByRole('button', { name: /Connect a board/ }),
  ).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByRole('button', { name: /Explore the demo/ })).toBeVisible()
})

it('shows saved dashboards as tiles with one primary action', () => {
  mocks.request.mockReturnValue(new Promise(() => {}))
  const dashboard = (id: string, name: string) => ({
    id,
    name,
    connectionId: 'demo',
    provider: 'demo' as const,
    boardId: id,
    filters: {
      selectedColumnIds: ['stage-1', 'stage-2'],
      windowDays: 30,
      ticketTypes: [],
    },
    metrics: defaultMetrics,
  })
  render(
    <WorkspaceHome
      session={{
        user: { id: 'fictional', username: 'tester' },
        workspaceName: 'Test',
        connections: [],
        dashboards: [dashboard('a', 'Alpha'), dashboard('b', 'Beta')],
      }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={vi.fn()}
    />,
  )
  const open = screen.getAllByRole('button', { name: 'Open briefing' })
  expect(open).toHaveLength(2)
  expect(open[0]).toHaveAttribute('data-variant', 'primary')
  expect(open[1]).toHaveAttribute('data-variant', 'secondary')
  expect(
    screen.queryByRole('button', { name: 'Connect Jira' }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Connect another board/ }))
  expect(screen.getByRole('button', { name: 'Connect Jira' })).toBeVisible()
})

it('opens the gateway key field, explained, when a company gateway turns Jira away', async () => {
  mocks.request.mockImplementation((path: string) =>
    path.endsWith('/local-jira')
      ? Promise.resolve({ connections: [] })
      : path.endsWith('/providers')
        ? Promise.resolve({ google: false })
        : Promise.reject(
            Object.assign(
              new Error(
                'Your company’s API gateway turned this connection away before it reached Jira.',
              ),
              { reason: 'gateway-key-required' },
            ),
          ),
  )
  render(
    <WorkspaceHome
      session={{
        user: { id: 'fictional', username: 'tester' },
        workspaceName: 'Test',
        connections: [],
        dashboards: [],
      }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Connect Jira/ }))
  fireEvent.change(screen.getByLabelText('Jira link'), {
    target: { value: 'https://jira.example.invalid/projects/DEMO/summary' },
  })
  fireEvent.change(screen.getByLabelText('Personal access token'), {
    target: { value: 'fictional-pat' },
  })
  // Hidden behind one plain sentence until needed.
  expect(screen.queryByLabelText('API gateway key')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', {
      name: 'My company also gave me an API gateway key for Jira',
    }),
  ).toBeInTheDocument()
  await act(async () => {
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Connect and find boards' })
        .closest('form')!,
    )
  })
  expect(screen.getByRole('alert')).toHaveTextContent('API gateway')
  const field = await screen.findByLabelText('API gateway key')
  await waitFor(() => expect(field).toHaveFocus())
  expect(screen.getByText('What is a gateway key?')).toBeInTheDocument()
  fireEvent.change(field, { target: { value: 'fictional-gateway-key' } })
  await act(async () => {
    fireEvent.submit(field.closest('form')!)
  })
  expect(mocks.request).toHaveBeenLastCalledWith(
    '/api/workspace/connections',
    'POST',
    expect.objectContaining({
      token: 'fictional-pat',
      apiKey: 'fictional-gateway-key',
    }),
  )
})

it('on the hosted site, leads from an unreachable company Jira to the local setup', async () => {
  mocks.request.mockImplementation((path: string) =>
    path.endsWith('/providers')
      ? Promise.resolve({ google: false, atlassian: false, trello: false })
      : Promise.reject(
          Object.assign(new Error('steerloom.app can’t reach this Jira.'), {
            reason: 'jira-not-reachable-hosted',
          }),
        ),
  )
  render(
    <WorkspaceHome
      session={{
        workspaceId: '20000000-0000-4000-8000-000000000001',
        workspaceRole: 'owner',
        user: { id: 'fictional', username: 'tester' },
        workspaceName: 'Test',
        connections: [],
        dashboards: [],
      }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Connect Jira/ }))
  fireEvent.change(screen.getByLabelText('Jira link'), {
    target: { value: 'https://jira.example.invalid/projects/DEMO/summary' },
  })
  // Before connecting: the reach check could not decide, so a hint with a link.
  const form = screen.getByLabelText('Jira link').closest('form')!
  expect(
    await within(form).findByRole('link', {
      name: 'Use Steerloom on your computer',
    }),
  ).toHaveAttribute('href', '/?hosted=1&page=local')
  fireEvent.change(screen.getByLabelText('Personal access token'), {
    target: { value: 'fictional-pat' },
  })
  await act(async () => {
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Connect and find boards' })
        .closest('form')!,
    )
  })
  // After the refusal: one clear way forward.
  expect(
    screen.getByRole('link', { name: 'Set up Steerloom on my computer' }),
  ).toHaveAttribute('href', '/?hosted=1&page=local')
})

it('connects Azure DevOps from a board link and opens that team’s board', async () => {
  const connection = {
    id: 'ado-1',
    name: 'My Azure DevOps',
    provider: 'azure-devops' as const,
  }
  const session = {
    user: { id: 'fictional', username: 'tester' },
    workspaceName: 'Test',
    connections: [connection],
    dashboards: [],
  }
  mocks.request.mockImplementation((path: string) =>
    path === '/api/workspace/connections'
      ? Promise.resolve({ session })
      : Promise.resolve({}),
  )
  mocks.boards.mockResolvedValue({
    boards: [
      { id: 'team-a', name: 'Checkout Team' },
      { id: 'team-b', name: 'Platform Team' },
    ],
  })
  const onSelectBoards = vi.fn()
  render(
    <WorkspaceHome
      session={{ ...session, connections: [] }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={onSelectBoards}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Connect Azure DevOps' }))
  const link =
    'https://dev.azure.com/contoso/Web/_boards/board/t/Checkout%20Team/Stories'
  fireEvent.change(screen.getByLabelText('Azure DevOps link'), {
    target: { value: link },
  })
  fireEvent.change(screen.getByLabelText('Personal access token'), {
    target: { value: 'fictional-pat' },
  })
  // The link names the project, so no project field is needed.
  expect(screen.queryByLabelText('Project name')).not.toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'your personal access tokens' }),
  ).toHaveAttribute(
    'href',
    'https://dev.azure.com/contoso/_usersSettings/tokens',
  )
  await act(async () => {
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Connect and find boards' })
        .closest('form')!,
    )
  })
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/workspace/connections',
    'POST',
    {
      provider: 'azure-devops',
      name: 'My Azure DevOps',
      baseUrl: link,
      token: 'fictional-pat',
    },
  )
  await waitFor(() =>
    expect(onSelectBoards).toHaveBeenCalledWith(
      connection,
      [{ id: 'team-a', name: 'Checkout Team' }],
      defaultMetrics,
    ),
  )
})

it('on the hosted site, sends company-network Jira to the local version before asking for a token', async () => {
  mocks.request.mockImplementation((path: string) =>
    path === '/api/workspace/reach'
      ? Promise.resolve({ reach: 'company-network' })
      : Promise.resolve({}),
  )
  render(
    <WorkspaceHome
      session={{
        workspaceId: '7c3c1d3e-0000-4000-8000-000000000001',
        workspaceRole: 'owner',
        user: { id: 'fictional', username: 'tester' },
        workspaceName: 'Test',
        connections: [],
        dashboards: [],
      }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={vi.fn()}
    />,
  )
  expect(
    screen.getByRole('link', { name: 'Use Steerloom on your computer' }),
  ).toHaveAttribute('href', '/?hosted=1&page=local')
  fireEvent.click(screen.getByRole('button', { name: 'Connect Jira' }))
  fireEvent.change(screen.getByLabelText('Jira link'), {
    target: { value: 'https://jira.corp.example/projects/DEMO' },
  })
  expect(
    await screen.findByText(/only opens inside your company network/),
  ).toBeVisible()
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/workspace/reach',
    'POST',
    { link: 'https://jira.corp.example', product: 'jira' },
    expect.anything(),
  )
  expect(
    screen.queryByLabelText('Personal access token'),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Connect and find boards' }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Set up Steerloom on my computer' }),
  ).toBeVisible()
  // A slow public server can look unreachable: people can still try.
  fireEvent.click(
    screen.getByRole('button', { name: 'Try connecting from here anyway' }),
  )
  expect(screen.getByLabelText('Personal access token')).toBeVisible()
})

it('never checks reach on a local install, which runs inside the network', () => {
  mocks.request.mockResolvedValue({})
  render(
    <WorkspaceHome
      session={{
        user: { id: 'fictional', username: 'tester' },
        workspaceName: 'Test',
        connections: [],
        dashboards: [],
      }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={vi.fn()}
    />,
  )
  expect(
    screen.queryByRole('link', { name: 'Use Steerloom on your computer' }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Connect Jira' }))
  fireEvent.change(screen.getByLabelText('Jira link'), {
    target: { value: 'https://jira.corp.example/projects/DEMO' },
  })
  expect(screen.getByLabelText('Personal access token')).toBeVisible()
  expect(mocks.request).not.toHaveBeenCalledWith(
    '/api/workspace/reach',
    expect.anything(),
    expect.anything(),
    expect.anything(),
  )
})
it('asks for the Jira link first: credentials appear once the link says which Jira it is', async () => {
  mocks.request.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/local-jira') ? { connections: [] } : { google: false },
    ),
  )
  render(
    <WorkspaceHome
      session={{
        user: { id: 'fictional', username: 'tester' },
        workspaceName: 'Test',
        connections: [],
        dashboards: [],
      }}
      busy={false}
      onSession={vi.fn()}
      onOpen={vi.fn()}
      onSelectBoards={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Connect Jira/ }))
  expect(screen.getByLabelText('Jira link')).toBeVisible()
  // Nothing a Jira Cloud user will never need.
  expect(
    screen.queryByLabelText('Personal access token'),
  ).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Project key')).not.toBeInTheDocument()
  expect(screen.queryByText(/API gateway key/)).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Jira link'), {
    target: { value: 'https://jira.example.invalid/projects/DEMO/summary' },
  })
  expect(screen.getByLabelText('Personal access token')).toBeVisible()
})
