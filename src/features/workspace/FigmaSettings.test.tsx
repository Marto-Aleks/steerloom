import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkspaceSession } from '../../lib/workspace/model'
import { FigmaSettings } from './FigmaSettings'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../../lib/workspace/api', () => ({ workspaceRequest: mocks.request }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const session = (
  figma?: WorkspaceSession['figma'],
  role: WorkspaceSession['workspaceRole'] = 'owner',
): WorkspaceSession => ({
  user: { id: 'fictional', username: 'tester' },
  workspaceName: 'Test',
  workspaceRole: role,
  connections: [],
  dashboards: [],
  ...(figma ? { figma } : {}),
})

it('checks and saves a token, listing only read scopes', async () => {
  const onSession = vi.fn()
  mocks.request.mockResolvedValue({ session: session({ connected: true }) })
  render(<FigmaSettings session={session()} onSession={onSession} />)
  expect(screen.getByText('Not connected')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Connect Figma' }))
  expect(screen.getByText('folders:read')).toBeTruthy()
  expect(screen.queryByText(/:write/)).toBeNull()
  fireEvent.change(screen.getByLabelText('Token'), {
    target: { value: 'fictional-token' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Check and save' }))
  await waitFor(() => expect(onSession).toHaveBeenCalled())
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/workspace/figma-settings',
    'PUT',
    { token: 'fictional-token' },
  )
  expect(screen.getByRole('status')).toHaveTextContent('The token works')
})

it('lets members see the connection but not change it', () => {
  render(
    <FigmaSettings
      session={session({ connected: true }, 'member')}
      onSession={vi.fn()}
    />,
  )
  expect(screen.getByText('Connected')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Change token' })).toBeNull()
})
