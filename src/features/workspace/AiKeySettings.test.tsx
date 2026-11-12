import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkspaceSession } from '../../lib/workspace/model'
import { AiKeySettings } from './AiKeySettings'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../../lib/workspace/api', () => ({ workspaceRequest: mocks.request }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const session = (ai?: WorkspaceSession['ai']): WorkspaceSession => ({
  user: { id: 'fictional', username: 'tester' },
  workspaceName: 'Test',
  workspaceRole: 'owner',
  connections: [],
  dashboards: [],
  ...(ai ? { ai } : {}),
})

async function fillCompanyEndpoint() {
  fireEvent.click(screen.getByRole('button', { name: 'Connect an AI key' }))
  fireEvent.click(screen.getByRole('button', { name: 'Company' }))
  fireEvent.change(screen.getByLabelText('Endpoint address'), {
    target: { value: 'https://ai.example.com/v1' },
  })
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'fictional-company-key-123456' },
  })
}

it('saves a company endpoint without a model name and says which model answered', async () => {
  mocks.request.mockImplementation((path: string) =>
    path === '/api/workspace/ai-models'
      ? Promise.reject(new Error('Not available'))
      : Promise.resolve({
          session: session({
            provider: 'custom',
            model: 'company-llm-2',
            endpointHost: 'ai.example.com',
          }),
        }),
  )
  const onSession = vi.fn()
  render(<AiKeySettings session={session()} onSession={onSession} />)
  await fillCompanyEndpoint()
  const model = screen.getByLabelText('Model')
  expect(model).not.toBeRequired()
  expect(model).toHaveAttribute('placeholder', 'Optional: found automatically')
  await act(async () => {
    fireEvent.submit(model.closest('form')!)
  })
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/workspace/ai-settings',
    'PUT',
    expect.objectContaining({ provider: 'custom', model: '' }),
  )
  expect(screen.getByRole('status')).toHaveTextContent(
    'Saved. The key works, using company-llm-2.',
  )
})

it('asks for the model, with focus, only when the endpoint needs one', async () => {
  mocks.request.mockImplementation((path: string) =>
    path === '/api/workspace/ai-models'
      ? Promise.reject(new Error('Not available'))
      : Promise.reject(
          Object.assign(
            new Error(
              'This endpoint needs a model or deployment name. You’ll find it where you got the key.',
            ),
            { reason: 'ai-model-required' },
          ),
        ),
  )
  render(<AiKeySettings session={session()} onSession={vi.fn()} />)
  await fillCompanyEndpoint()
  await act(async () => {
    fireEvent.submit(screen.getByLabelText('Model').closest('form')!)
  })
  expect(screen.getByRole('alert')).toHaveTextContent('needs a model')
  await waitFor(() => expect(screen.getByLabelText('Model')).toHaveFocus())
})

it('names a gateway default in plain words', () => {
  render(
    <AiKeySettings
      session={session({
        provider: 'custom',
        model: '(gateway default)',
        endpointHost: 'ai.example.com',
      })}
      onSession={vi.fn()}
    />,
  )
  expect(
    screen.getByText(/the gateway’s default model · ai\.example\.com/),
  ).toBeInTheDocument()
})

it('starts with the service whose mark was picked, and saves Gemini as its known endpoint', async () => {
  mocks.request.mockResolvedValue({
    session: session({
      provider: 'custom',
      model: 'gemini-2.5-flash',
      endpointHost: 'generativelanguage.googleapis.com',
    }),
  })
  render(<AiKeySettings session={session()} onSession={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Connect Gemini' }))
  expect(screen.getByRole('button', { name: 'Gemini' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(
    screen.getByRole('link', { name: 'Create a key in Google AI Studio' }),
  ).toBeVisible()
  expect(screen.queryByLabelText('Endpoint address')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'fictional-gemini-key' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Check and save' }))
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/workspace/ai-settings',
      'PUT',
      {
        provider: 'custom',
        apiKey: 'fictional-gemini-key',
        model: '',
        endpoint:
          'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      },
    ),
  )
})

it('in the AI panel: no card heading, the form open from the start, and says when it saved', async () => {
  mocks.request.mockResolvedValue({
    session: session({ provider: 'anthropic', model: 'claude-sonnet-5-5' }),
  })
  const onSaved = vi.fn()
  render(
    <AiKeySettings
      session={session()}
      onSession={vi.fn()}
      compact
      onSaved={onSaved}
    />,
  )
  expect(screen.queryByRole('heading', { name: 'AI assistant' })).toBeNull()
  expect(screen.getByText(/works for everyone in Test/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'fictional-anthropic-key-123456' },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Check and save' }))
  })
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
})
