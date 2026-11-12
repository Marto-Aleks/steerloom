import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkspaceSession } from '../../lib/workspace/model'
import { GithubSettings } from './GithubSettings'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../../lib/workspace/api', () => ({ workspaceRequest: mocks.request }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const session = (
  github?: WorkspaceSession['github'],
  role: WorkspaceSession['workspaceRole'] = 'owner',
): WorkspaceSession => ({
  user: { id: 'fictional', username: 'tester' },
  workspaceName: 'Test',
  workspaceRole: role,
  connections: [],
  dashboards: [],
  ...(github ? { github } : {}),
})

it('checks and saves a token like the AI key, then shows the host', async () => {
  const onSession = vi.fn()
  mocks.request.mockResolvedValue({
    session: session({
      host: 'git.example.invalid',
      repositories: ['acme/web'],
    }),
  })
  render(<GithubSettings session={session()} onSession={onSession} />)
  expect(screen.getByText('Not connected')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }))
  expect(
    screen.getByRole('link', { name: 'Create a fine-grained token' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/settings/personal-access-tokens/new',
  )
  fireEvent.change(screen.getByLabelText('GitHub address'), {
    target: { value: 'https://git.example.invalid' },
  })
  fireEvent.change(screen.getByLabelText('Token'), {
    target: { value: 'fictional-token' },
  })
  fireEvent.change(screen.getByLabelText(/^Repositories/), {
    target: { value: 'acme/web' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Check and save' }))
  await waitFor(() => expect(onSession).toHaveBeenCalled())
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/workspace/github-settings',
    'PUT',
    {
      baseUrl: 'https://git.example.invalid',
      token: 'fictional-token',
      repositories: 'acme/web',
    },
  )
  expect(screen.getByRole('status')).toHaveTextContent('Saved')
})

it('lets members see the connection but not change it', () => {
  render(
    <GithubSettings
      session={session(
        { host: 'git.example.invalid', repositories: ['acme/web'] },
        'member',
      )}
      onSession={vi.fn()}
    />,
  )
  expect(
    screen.getByText('git.example.invalid · Fine-grained token'),
  ).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Change token' })).toBeNull()
})

it('shows a classic token and warns once it has expired', () => {
  render(
    <GithubSettings
      session={session({
        host: 'git.example.invalid',
        repositories: ['acme/web'],
        classic: true,
        expiresAt: '2020-01-01T00:00:00.000Z',
      })}
      onSession={vi.fn()}
    />,
  )
  expect(screen.getByText(/Classic token · expired/)).toBeTruthy()
  expect(screen.getByText(/This token has expired/)).toBeTruthy()
})

it('shows what each repository holds, and why nothing links', () => {
  render(
    <GithubSettings
      session={session({
        host: 'git.example.invalid',
        repositories: ['acme/web', 'acme/docs'],
        checks: [
          { name: 'acme/web', read: 87, linked: 64 },
          { name: 'acme/docs', read: 12, linked: 0 },
        ],
      })}
      onSession={vi.fn()}
    />,
  )
  expect(
    screen.getByText('87 pull requests in the last year · 64 name an item key'),
  ).toBeTruthy()
  expect(
    screen.getByText(
      '12 pull requests in the last year · none names an item key',
    ),
  ).toBeTruthy()
  expect(screen.getByText(/counts when its title or branch/)).toBeTruthy()
})
