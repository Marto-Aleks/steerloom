import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LocalSetupPage } from './LocalExperience'
import DesignPreview from './DesignPreview'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('opens the local design preview and keeps the destination in the URL', () => {
  window.history.replaceState({}, '', '/?preview=design')
  render(<DesignPreview />)
  expect(screen.getAllByText('Read-only')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: /Local workspace/ }))
  expect(
    screen.getByRole('heading', { name: /Your board data stays inside/ }),
  ).toBeInTheDocument()
  expect(window.location.search).toContain('view=local')
  expect(screen.getByText('Read-only')).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: 'Install with one command' }),
  ).toBeInTheDocument()
})

it('plays, pauses, finishes and replays the guide without running installation commands', () => {
  vi.useFakeTimers()
  render(<LocalSetupPage productionHosted onBack={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Play walkthrough/ }))
  act(() => {
    vi.advanceTimersByTime(7500)
  })
  expect(screen.getByText('Step 2 of 3 · Start Steerloom')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Pause walkthrough/ }))
  act(() => {
    vi.advanceTimersByTime(10000)
  })
  expect(screen.getByText('Step 2 of 3 · Start Steerloom')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Play walkthrough/ }))
  act(() => {
    vi.advanceTimersByTime(30000)
  })
  expect(
    screen.getByRole('button', { name: /Replay walkthrough/ }),
  ).toBeInTheDocument()
  expect(
    screen.getByText('Step 3 of 3 · Open your workspace'),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Replay walkthrough/ }))
  expect(
    screen.getByText('Step 1 of 3 · Install Node.js and download'),
  ).toBeInTheDocument()
})

it('copies the selected platform command and resets the walkthrough when switching platform', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  render(<LocalSetupPage productionHosted onBack={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Start Steerloom/ }))
  expect(screen.getByText('Step 2 of 3 · Start Steerloom')).toBeInTheDocument()
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Operating system' })).getByRole(
      'button',
      { name: 'Windows' },
    ),
  )
  expect(
    screen.getByText('Step 1 of 3 · Install Node.js and download'),
  ).toBeInTheDocument()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy command 1' }))
  })
  expect(writeText).toHaveBeenCalledWith('cd "$HOME\\Downloads"')
  expect(screen.getByRole('status')).toHaveTextContent('Copied:')
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy command 4' }))
  })
  expect(writeText).toHaveBeenLastCalledWith('node server.mjs --open')
  vi.unstubAllGlobals()
})

it('allows seeking inside the player and pauses at the selected step', () => {
  vi.useFakeTimers()
  render(<LocalSetupPage productionHosted onBack={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Play walkthrough/ }))
  fireEvent.change(
    screen.getByRole('slider', { name: 'Walkthrough position' }),
    {
      target: { value: '150' },
    },
  )
  act(() => {
    vi.advanceTimersByTime(3000)
  })
  expect(screen.getByRole('slider')).toHaveValue('150')
  expect(
    screen.getByRole('button', { name: /Play walkthrough/ }),
  ).toBeInTheDocument()
  expect(screen.getByText('Step 2 of 3 · Start Steerloom')).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: /Node.js 22 or newer/ }).closest('li'),
  ).toHaveTextContent('Install Node.js and download')
})

function stubInstallCommand(userAgent: string) {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { userAgent, clipboard: { writeText } })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          command:
            'curl -fsSL "https://x.example/api/hosted/install.sh?t=1" | sh',
          windowsCommand:
            'irm "https://x.example/api/hosted/install.ps1?t=1" | iex',
          expiresAt: '2026-10-21T12:00:00.000Z',
        }),
        { status: 200 },
      ),
    ),
  )
  return writeText
}

it('offers the PowerShell command first on Windows and the shell command on macOS', async () => {
  const writeText = stubInstallCommand(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  )
  render(<LocalSetupPage productionHosted onBack={() => {}} />)
  const toggle = within(screen.getByRole('group', { name: 'Install on' }))
  expect(
    toggle.getByRole('button', { name: 'Windows 10 / 11' }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText(/Open Start, type PowerShell/)).toBeInTheDocument()
  expect(
    screen.getByText(/open Steerloom from the Start menu or your desktop/),
  ).toBeInTheDocument()
  await waitFor(() =>
    expect(
      screen.getByText(
        'irm "https://x.example/api/hosted/install.ps1?t=1" | iex',
      ),
    ).toBeInTheDocument(),
  )
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  })
  expect(writeText).toHaveBeenCalledWith(
    'irm "https://x.example/api/hosted/install.ps1?t=1" | iex',
  )
  fireEvent.click(toggle.getByRole('button', { name: 'macOS / Linux' }))
  expect(
    screen.getByText(
      'curl -fsSL "https://x.example/api/hosted/install.sh?t=1" | sh',
    ),
  ).toBeInTheDocument()
  expect(
    screen.getByText(/open Steerloom from Launchpad or Spotlight/),
  ).toBeInTheDocument()
  expect(
    screen.getByText('Prefer to install step by step?'),
  ).toBeInTheDocument()
})

it('defaults the one-command install to macOS / Linux outside Windows', () => {
  stubInstallCommand('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')
  render(<LocalSetupPage productionHosted={false} onBack={() => {}} />)
  expect(
    within(screen.getByRole('group', { name: 'Install on' })).getByRole(
      'button',
      { name: 'macOS / Linux' },
    ),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText(/Open Terminal/)).toBeInTheDocument()
})

it('links the signed-in download from the local setup page', () => {
  render(<LocalSetupPage productionHosted onBack={() => {}} />)
  expect(
    screen.getByRole('link', { name: 'Download steerloom-local.tar.gz' }),
  ).toHaveAttribute('href', '/api/hosted/download/local')
})

it('fetches the install command without an account and offers an optional email', async () => {
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >((url) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          url.endsWith('/install-command')
            ? { command: 'curl example | sh', windowsCommand: 'irm example' }
            : { ok: true },
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  render(
    <LocalSetupPage
      productionHosted
      backLabel="Back to Steerloom"
      onBack={() => {}}
    />,
  )
  expect(await screen.findByText('curl example | sh')).toBeInTheDocument()
  expect(screen.getAllByText('Back to Steerloom').length).toBeGreaterThan(0)
  expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute(
    'href',
    '/terms.html',
  )
  fireEvent.change(screen.getByLabelText(/Leave your email/), {
    target: { value: 'tester@example.com' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Keep me posted' }))
  expect(await screen.findByText(/Thanks\. We’ll write/)).toBeInTheDocument()
  const [url, init] = fetchMock.mock.calls.at(-1)!
  expect(url).toBe('/api/hosted/feedback')
  expect(JSON.parse(String(init?.body))).toMatchObject({
    kind: 'idea',
    email: 'tester@example.com',
  })
})
