import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UpdateNotice } from './UpdateNotice'

HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '')
}
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open')
}

const answer = (value: unknown, command: unknown = COMMAND) =>
  vi.fn((url: string) =>
    Promise.resolve({
      ok: command !== 'failed' || !url.includes('update-command'),
      json: () =>
        Promise.resolve(url.includes('update-command') ? command : value),
    }),
  )
const COMMAND = {
  command:
    'curl -fsSL "https://steerloom.app/api/hosted/install.sh?t=1&u=1" | sh',
  windowsCommand:
    'irm "https://steerloom.app/api/hosted/install.ps1?t=1&u=1" | iex',
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.head.querySelector('meta[name="steerloom-mode"]')?.remove()
})

const newer = {
  current: '2026.10.27',
  available: true,
  latest: '2026.11.3',
  notes: ['Faster boards'],
  updateUrl: 'https://steerloom.app/?hosted=1&page=local',
}

const openCommand = () =>
  fireEvent.click(screen.getByText('Or paste a command instead'))

it('shows the pill and a sheet that offers the update, with the command one click away', async () => {
  vi.stubGlobal('fetch', answer(newer))
  render(<UpdateNotice />)
  fireEvent.click(
    await screen.findByRole('button', { name: /Update available/ }),
  )
  expect(screen.getByRole('dialog')).toHaveTextContent('Faster boards')
  expect(screen.getByRole('dialog')).toHaveTextContent('You have 2026.10.27')
  expect(screen.getByRole('button', { name: 'Update now' })).toBeInTheDocument()
  // The command is fetched only when someone asks for it.
  expect(screen.queryByText(COMMAND.command)).toBeNull()
  openCommand()
  expect(await screen.findByText(COMMAND.command)).toBeInTheDocument()
  const write = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText: write } })
  fireEvent.click(
    screen.getByRole('button', { name: 'Copy the update command' }),
  )
  expect(write).toHaveBeenCalledWith(COMMAND.command)
  expect(
    await screen.findByRole('button', { name: 'Copied' }),
  ).toBeInTheDocument()
})

it('falls back to the site when the command cannot be fetched', async () => {
  vi.stubGlobal('fetch', answer(newer, 'failed'))
  render(<UpdateNotice />)
  fireEvent.click(
    await screen.findByRole('button', { name: /Update available/ }),
  )
  openCommand()
  expect(
    await screen.findByRole('link', { name: 'steerloom.app' }),
  ).toHaveAttribute('href', newer.updateUrl)
})

it('updates in place: asks the local server, waits, and says when it is done', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let current = false
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('update-now'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            current ? { ...newer, available: false, latest: undefined } : newer,
          ),
      })
    }),
  )
  render(<UpdateNotice />)
  fireEvent.click(
    await screen.findByRole('button', { name: /Update available/ }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
  const started = calls.find((call) => call.url.includes('update-now'))
  expect(started?.init?.method).toBe('POST')
  expect(started?.init?.headers).toMatchObject({ 'X-Steerloom-Update': '1' })
  expect(screen.getByRole('dialog')).toHaveTextContent('Updating Steerloom')
  expect(screen.getByRole('status')).toHaveTextContent('reopens by itself')
  // Still the old version: keep waiting.
  await vi.advanceTimersByTimeAsync(2000)
  expect(screen.getByRole('dialog')).toHaveTextContent('Updating Steerloom')
  current = true
  await vi.advanceTimersByTimeAsync(2000)
  expect(await screen.findByText('Steerloom is up to date')).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toHaveTextContent('version 2026.11.3')
  vi.useRealTimers()
})

it('falls back to the pasted command when the update cannot start', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({
        ok: !url.includes('update-now'),
        json: () =>
          Promise.resolve(url.includes('update-command') ? COMMAND : newer),
      }),
    ),
  )
  render(<UpdateNotice />)
  fireEvent.click(
    await screen.findByRole('button', { name: /Update available/ }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Nothing was lost. Paste the command below instead.',
  )
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'The update did not finish',
  )
  // The command is already open, ready to copy.
  expect(await screen.findByText(COMMAND.command)).toBeInTheDocument()
})

it('hides for three days after Later, for that version only', async () => {
  vi.stubGlobal('fetch', answer(newer))
  render(<UpdateNotice />)
  fireEvent.click(
    await screen.findByRole('button', { name: /Update available/ }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Later' }))
  expect(screen.queryByRole('button', { name: /Update available/ })).toBeNull()
  cleanup()
  render(<UpdateNotice />)
  await Promise.resolve()
  expect(screen.queryByRole('button', { name: /Update available/ })).toBeNull()
  cleanup()
  vi.stubGlobal('fetch', answer({ ...newer, latest: '2026.11.9' }))
  render(<UpdateNotice />)
  expect(
    await screen.findByRole('button', { name: /Update available/ }),
  ).toBeInTheDocument()
})

it('shows nothing when current, and never asks on the hosted site', async () => {
  const current = answer({ ...newer, available: false, latest: undefined })
  vi.stubGlobal('fetch', current)
  render(<UpdateNotice />)
  await Promise.resolve()
  expect(screen.queryByRole('button')).toBeNull()
  cleanup()
  const meta = document.createElement('meta')
  meta.name = 'steerloom-mode'
  meta.content = 'hosted'
  document.head.append(meta)
  const hostedFetch = answer(newer)
  vi.stubGlobal('fetch', hostedFetch)
  render(<UpdateNotice />)
  expect(hostedFetch).not.toHaveBeenCalled()
})
