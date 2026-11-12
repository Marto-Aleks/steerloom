import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HostedAccountSetup } from './HostedAccountSetup'
import { entryNavigation } from './entry/navigation'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../lib/workspace/api', () => ({ workspaceRequest: request }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  window.history.replaceState(null, '', '/')
})
const session = {
  user: { id: 'fictional', email: 'person@example.invalid' },
  workspaces: [],
  invitations: [],
}
it('registers with email and shows confirmation without treating registration as a session', async () => {
  request.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/config')
        ? { configured: true }
        : path.endsWith('/session')
          ? { session: null }
          : { notice: 'Check your inbox to confirm your email.' },
    ),
  )
  window.history.replaceState(null, '', '/?hosted=1&page=signin')
  render(<HostedAccountSetup />)
  await screen.findByRole('button', { name: 'Sign in' })
  expect(
    screen.getByRole('heading', { level: 1, name: 'Your briefing is waiting' }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'What is Steerloom?' }),
  ).toHaveAttribute('href', '/?hosted=1')
  fireEvent.click(screen.getByRole('button', { name: 'Create an account' }))
  expect(screen.getByText(/At least 12 characters/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'person@example.invalid' },
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'fictional-password' },
  })
  await act(async () => {
    fireEvent.submit(
      screen.getByRole('button', { name: 'Create account' }).closest('form')!,
    )
  })
  expect(request).toHaveBeenCalledWith('/api/hosted/auth/register', 'POST', {
    email: 'person@example.invalid',
    password: 'fictional-password',
  })
  expect(
    screen.getByRole('heading', { name: 'Check your inbox' }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { level: 1, name: 'One click left' }),
  ).toBeInTheDocument()
  expect(screen.getByText('person@example.invalid')).toBeInTheDocument()
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'send it again' }))
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith('/api/hosted/auth/resend', 'POST', {
      email: 'person@example.invalid',
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: /Back to sign in/ }))
  expect(screen.getByLabelText('Password')).toHaveValue('')
})
it('opens a newly created workspace straight away', async () => {
  const open = vi.spyOn(entryNavigation, 'assign').mockImplementation(() => {})
  let created = false
  request.mockImplementation((path: string) => {
    if (path === '/api/hosted/config')
      return Promise.resolve({ configured: true })
    if (path === '/api/hosted/session')
      return Promise.resolve({
        session: {
          ...session,
          workspaces: created
            ? [{ id: 'fictional-workspace', name: 'Team delivery' }]
            : [],
        },
      })
    created = true
    return Promise.resolve({ id: 'fictional-workspace' })
  })
  render(<HostedAccountSetup />)
  await screen.findByLabelText('Workspace name')
  fireEvent.change(screen.getByLabelText('Workspace name'), {
    target: { value: 'Team delivery' },
  })
  await act(async () => {
    fireEvent.submit(
      screen.getByRole('button', { name: 'Create workspace' }).closest('form')!,
    )
  })
  expect(request).toHaveBeenCalledWith('/api/hosted/workspaces', 'POST', {
    name: 'Team delivery',
  })
  expect(open).toHaveBeenCalledWith('/?hosted=1&workspace=fictional-workspace')
})
it('opens the only workspace straight after sign-in', async () => {
  const open = vi.spyOn(entryNavigation, 'assign').mockImplementation(() => {})
  request.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/config')
        ? { configured: true }
        : {
            session: {
              ...session,
              workspaces: [{ id: 'fictional-workspace', name: 'Team' }],
            },
          },
    ),
  )
  window.history.replaceState(null, '', '/?hosted=1')
  render(<HostedAccountSetup />)
  await vi.waitFor(() =>
    expect(open).toHaveBeenCalledWith(
      '/?hosted=1&workspace=fictional-workspace',
    ),
  )
})
it('keeps permission errors visible without reporting a workspace as created', async () => {
  request.mockImplementation((path: string) =>
    path === '/api/hosted/workspaces'
      ? Promise.reject(
          new Error(
            'A verified, active account is required to create a workspace.',
          ),
        )
      : Promise.resolve(
          path.endsWith('/config') ? { configured: true } : { session },
        ),
  )
  render(<HostedAccountSetup />)
  await screen.findByLabelText('Workspace name')
  fireEvent.change(screen.getByLabelText('Workspace name'), {
    target: { value: 'Team' },
  })
  await act(async () => {
    fireEvent.submit(
      screen.getByRole('button', { name: 'Create workspace' }).closest('form')!,
    )
  })
  expect(screen.getByRole('alert')).toHaveTextContent(
    'verified, active account',
  )
  expect(
    screen.queryByText('Your workspace was created.'),
  ).not.toBeInTheDocument()
})

it('lets an invited user create their own workspace without accepting the invitation', async () => {
  request.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/config')
        ? { configured: true }
        : {
            session: {
              ...session,
              invitations: [
                { id: 'invite', workspaceId: 'other-team', role: 'member' },
              ],
            },
          },
    ),
  )
  render(<HostedAccountSetup />)
  await screen.findByLabelText('Workspace name')
  fireEvent.change(screen.getByLabelText('Workspace name'), {
    target: { value: 'My team' },
  })
  await act(async () => {
    fireEvent.submit(
      screen.getByRole('button', { name: 'Create workspace' }).closest('form')!,
    )
  })
  expect(request).toHaveBeenCalledWith('/api/hosted/workspaces', 'POST', {
    name: 'My team',
  })
  expect(
    request.mock.calls.some(
      ([path]) => path === '/api/hosted/invitations/accept',
    ),
  ).toBe(false)
})

it('opens local setup from ?page=local and returns to the workspaces', async () => {
  request.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/config') ? { configured: true } : { session },
    ),
  )
  window.history.replaceState(null, '', '/?hosted=1&page=local')
  render(<HostedAccountSetup />)
  expect(
    await screen.findByText(
      /Your hosted sign-in does not unlock the local app/,
    ),
  ).toBeInTheDocument()
  expect(
    screen.getByText(/tar -xzf steerloom-local.tar.gz/),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Windows' }))
  expect(
    screen.getByText(/tar -xzf .\\steerloom-local.tar.gz/),
  ).toBeInTheDocument()
  expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument()
  fireEvent.click(
    screen.getAllByRole('button', { name: /Back to your workspaces/ })[0]!,
  )
  expect(screen.getByLabelText('Workspace name')).toBeInTheDocument()
})

it('shows the product landing page to signed-out visitors', async () => {
  request.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/config') ? { configured: true } : { session: null },
    ),
  )
  window.history.replaceState(null, '', '/?hosted=1')
  render(<HostedAccountSetup />)
  expect(
    await screen.findByRole('heading', {
      name: /where delivery really stands/,
    }),
  ).toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: 'Sign in' })[0]).toHaveAttribute(
    'href',
    '/?hosted=1&page=signin',
  )
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
})

it('sends a reset link from the sign-in page', async () => {
  request.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/config')
        ? { configured: true }
        : path.endsWith('/session')
          ? { session: null }
          : {
              notice:
                'If an account uses this email, a reset link is on its way.',
            },
    ),
  )
  window.history.replaceState(null, '', '/?hosted=1&page=signin')
  render(<HostedAccountSetup />)
  await screen.findByRole('button', { name: 'Sign in' })
  fireEvent.click(screen.getByRole('button', { name: 'Reset it' }))
  expect(
    screen.getByRole('heading', { level: 1, name: 'Forgot your password?' }),
  ).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'person@example.invalid' },
  })
  await act(async () => {
    fireEvent.submit(
      screen.getByRole('button', { name: 'Send reset link' }).closest('form')!,
    )
  })
  expect(request).toHaveBeenCalledWith('/api/hosted/auth/recover', 'POST', {
    email: 'person@example.invalid',
  })
  expect(screen.getByText(/reset link is on its way/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
})

it('back from a reset link, asks for a new password before opening the workspace', async () => {
  const navigate = vi
    .spyOn(entryNavigation, 'assign')
    .mockImplementation(() => {})
  request.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/config')
        ? { configured: true }
        : path.endsWith('/session')
          ? {
              session: {
                ...session,
                workspaces: [
                  {
                    id: '20000000-0000-4000-8000-000000000001',
                    name: 'Fictional team',
                    role: 'owner',
                  },
                ],
              },
            }
          : { ok: true },
    ),
  )
  window.history.replaceState(null, '', '/?hosted=1&reset=1')
  render(<HostedAccountSetup />)
  const field = await screen.findByLabelText('New password')
  // The single workspace does not open on its own while the password is due.
  expect(navigate).not.toHaveBeenCalled()
  fireEvent.change(field, { target: { value: 'a-new-fictional-password' } })
  await act(async () => {
    fireEvent.submit(field.closest('form')!)
  })
  expect(request).toHaveBeenCalledWith('/api/hosted/auth/password', 'POST', {
    password: 'a-new-fictional-password',
  })
  expect(screen.getByText(/Your password is changed/)).toBeInTheDocument()
  expect(window.location.search).not.toContain('reset')
})
it('reports a board connection that failed on its way back, instead of saying nothing', async () => {
  const open = vi.spyOn(entryNavigation, 'assign').mockImplementation(() => {})
  const workspaces = [{ id: 'fictional-workspace', name: 'Team' }]
  request.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/config')
        ? { configured: true }
        : { session: { ...session, workspaces } },
    ),
  )
  // The attempt expired while the person was approving: the return names
  // no workspace. With one workspace it opens, and the reason goes with it.
  window.history.replaceState(
    null,
    '',
    '/?hosted=1&trello=error&trelloReason=session',
  )
  render(<HostedAccountSetup />)
  await vi.waitFor(() =>
    expect(open).toHaveBeenCalledWith(
      '/?hosted=1&workspace=fictional-workspace&trello=error&trelloReason=session',
    ),
  )
  cleanup()
  // With several workspaces the list says it.
  workspaces.push({ id: 'fictional-second', name: 'Platform' })
  window.history.replaceState(null, '', '/?hosted=1&jira=error')
  render(<HostedAccountSetup />)
  expect(
    await screen.findByText(
      'The board connection didn’t finish. Open your workspace and connect again.',
    ),
  ).toBeInTheDocument()
})
