import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiReportContext } from '../../lib/ai/report-context'
import { AiChatPanel, AiMessageContent } from './AiChatPanel'

const aiMocks = vi.hoisted(() => ({
  getAiConfiguration: vi.fn(),
  sendAiChat: vi.fn(),
}))

vi.mock('../../lib/ai/ai-http', () => ({
  getAiConfiguration: aiMocks.getAiConfiguration,
  sendAiChat: aiMocks.sendAiChat,
}))

const context: AiReportContext = {
  generatedAt: '2026-09-29T09:00:00Z',
  sourceLabel: 'Fictional Jira',
  boardName: 'Fictional delivery board',
  scope: {
    selectedColumns: ['In Progress'],
    ticketTypes: ['Story'],
    windowDays: 30,
  },
  headline: {
    completedObservations: 5,
    medianCycleTimeDays: 4,
    percentile85CycleTimeDays: 8,
    exitThroughputPerWeek: 2,
  },
  focusSignals: [],
  ticketGroupTotals: {
    completedOutliers: 0,
    delayedWorkInProgress: 0,
    reenteredWorkInProgress: 0,
  },
  weeklyThroughput: [],
  cycleTimeDistribution: [],
  weeklyCycleTimeTrend: [],
  delayedWorkInProgress: [],
  completedOutliers: [],
  reenteredWorkInProgress: [],
}

describe('Steerloom AI contextual drafts', () => {
  beforeEach(() => {
    aiMocks.getAiConfiguration.mockReset()
    aiMocks.sendAiChat.mockReset()
    aiMocks.getAiConfiguration.mockResolvedValue({
      configured: true,
      missing: [],
      invalid: [],
      source: 'anthropic',
    })
    aiMocks.sendAiChat.mockResolvedValue({
      message: 'Fictional review ready.',
      checkedJiraKeys: [],
      unavailableJiraKeys: [],
      omittedJiraKeys: 0,
    })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('opens an editable draft without sending it automatically', async () => {
    const prompt = 'Prepare a concise team flow review from this report.'

    render(<AiChatPanel context={context} draftRequest={{ id: 1, prompt }} />)

    const composer = await screen.findByLabelText(
      'Ask a question about this report',
    )
    expect(composer).toHaveValue(prompt)
    expect(aiMocks.sendAiChat).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(aiMocks.sendAiChat).toHaveBeenCalledTimes(1))
  })

  it('starts a signal investigation once with the active report context', async () => {
    const prompt = 'Investigate the fictional aging signal.'
    const props = { context, draftRequest: { id: 1, prompt, autoSend: true } }
    const { rerender } = render(<AiChatPanel {...props} />)
    await screen.findByText('Fictional review ready.')
    expect(aiMocks.sendAiChat).toHaveBeenCalledTimes(1)
    expect(aiMocks.sendAiChat.mock.calls[0]?.[0]).toEqual(context)
    expect(aiMocks.sendAiChat.mock.calls[0]?.[1]).toEqual([
      { role: 'user', content: prompt },
    ])
    rerender(<AiChatPanel {...props} />)
    expect(aiMocks.sendAiChat).toHaveBeenCalledTimes(1)
  })

  it('offers rule-based guidance without sending when AI is unavailable', async () => {
    aiMocks.getAiConfiguration.mockResolvedValue({
      configured: false,
      missing: [],
      invalid: [],
      source: null,
    })
    render(
      <AiChatPanel
        context={context}
        draftRequest={{
          id: 1,
          prompt: 'Investigate aging work.',
          autoSend: true,
          fallback: 'Review delayed items with the team.',
        }}
      />,
    )
    expect(
      await screen.findByText('Review delayed items with the team.'),
    ).toBeInTheDocument()
    expect(aiMocks.sendAiChat).not.toHaveBeenCalled()
  })

  it('shows owners the key form in the panel, and tells members whom to ask', async () => {
    aiMocks.getAiConfiguration.mockResolvedValue({
      configured: false,
      missing: [],
      invalid: [],
      source: null,
    })
    render(
      <AiChatPanel
        context={context}
        keyForm={<p>Fictional key form</p>}
        configurationKey="none"
      />,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Steerloom AI chat' }),
    )
    expect(await screen.findByText('Fictional key form')).toBeInTheDocument()
    expect(screen.queryByText(/A workspace owner or admin/)).toBeNull()
    cleanup()
    render(<AiChatPanel context={context} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Steerloom AI chat' }),
    )
    expect(
      await screen.findByText(/A workspace owner or admin can connect/),
    ).toBeInTheDocument()
  })

  it('checks again when the workspace key changes, and turns into the chat', async () => {
    aiMocks.getAiConfiguration.mockResolvedValueOnce({
      configured: false,
      missing: [],
      invalid: [],
      source: null,
    })
    const { rerender } = render(
      <AiChatPanel
        context={context}
        keyForm={<p>Fictional key form</p>}
        configurationKey="none"
      />,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Steerloom AI chat' }),
    )
    expect(await screen.findByText('Fictional key form')).toBeInTheDocument()
    aiMocks.getAiConfiguration.mockResolvedValueOnce({
      configured: true,
      missing: [],
      invalid: [],
      source: 'workspace',
    })
    rerender(
      <AiChatPanel
        context={context}
        keyForm={<p>Fictional key form</p>}
        configurationKey="anthropic"
      />,
    )
    expect(
      await screen.findByLabelText('Ask a question about this report'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Fictional key form')).toBeNull()
  })

  it('opens a named non-modal panel and preserves the draft when dismissed and reopened', async () => {
    render(
      <AiChatPanel
        context={context}
        draftRequest={{ id: 1, prompt: 'Review fictional delivery.' }}
      />,
    )
    const panel = await screen.findByRole('complementary', {
      name: 'Ask Steerloom AI',
    })
    expect(panel).not.toHaveAttribute('aria-modal')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body).toHaveClass('ai-chat-docked')
    const composer = screen.getByLabelText('Ask a question about this report')
    await waitFor(() => expect(composer).toHaveFocus())

    fireEvent.keyDown(composer, { key: 'Escape' })
    const launcher = screen.getByRole('button', {
      name: 'Open Steerloom AI chat',
    })
    expect(launcher).toHaveFocus()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(document.body).not.toHaveClass('ai-chat-docked')
    fireEvent.click(launcher)
    expect(
      await screen.findByLabelText('Ask a question about this report'),
    ).toHaveValue('Review fictional delivery.')
    expect(aiMocks.sendAiChat).not.toHaveBeenCalled()
  })

  it('links known ticket keys and copies an answer from the icon, with no follow-up buttons', async () => {
    aiMocks.sendAiChat.mockResolvedValueOnce({
      message: 'Start with FICT-12, then FICT-99.',
      checkedJiraKeys: [],
      unavailableJiraKeys: [],
      omittedJiraKeys: 0,
      // FICT-99 was read by the assistant: its title comes with the answer.
      itemTitles: { 'FICT-99': 'Fictional linked task' },
    })
    render(
      <AiChatPanel
        context={context}
        itemLinks={(key) =>
          key === 'FICT-12'
            ? 'https://jira.example.com/browse/FICT-12'
            : undefined
        }
        itemTitles={(key) =>
          key === 'FICT-12' ? 'Fictional checkout story' : undefined
        }
        draftRequest={{ id: 1, prompt: 'What first?', autoSend: true }}
      />,
    )
    // Like keys everywhere else: the title on hover, in the link's name.
    const link = await screen.findByRole('link', {
      name: 'FICT-12: Fictional checkout story (opens in a new tab)',
    })
    expect(await screen.findByText('Fictional linked task')).toBeInTheDocument()
    expect(link).toHaveAttribute(
      'href',
      'https://jira.example.com/browse/FICT-12',
    )
    expect(screen.queryByRole('link', { name: 'FICT-99' })).toBeNull()
    expect(screen.getByText('FICT-99')).toBeInTheDocument()

    for (const gone of ['Tell me more', 'Note for the team', 'For my manager'])
      expect(screen.queryByRole('button', { name: gone })).toBeNull()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }))
    expect(writeText).toHaveBeenCalledWith('Start with FICT-12, then FICT-99.')
    expect(
      await screen.findByRole('button', { name: 'Copied' }),
    ).toBeInTheDocument()
  })

  it('draws a card answer: verdict and next step first, reasoning on demand', async () => {
    aiMocks.sendAiChat.mockResolvedValueOnce({
      message: 'Rework that went quiet.',
      card: {
        verdict: '**Rework that went quiet**, not a slow review.',
        confidence: 'likely',
        basis: 'GitHub and Jira agree',
        reasons: [
          {
            kind: 'supports',
            source: 'GitHub',
            keys: ['FICT-12'],
            fact: 'Changes requested; quiet for 16 days.',
          },
          {
            kind: 'rules-out',
            source: 'GitHub',
            keys: [],
            fact: 'Not waiting for reviewers.',
          },
        ],
        options: [
          {
            what: 'Ask whether the changes still apply.',
            checkpoint: 'New commits by Friday.',
            keys: ['FICT-12'],
            recommended: true,
          },
        ],
        why: 'the reviewer said what to change.',
        next: 'Ask the assignee whether the requested changes still apply.',
        checkpoint: 'New commits by the next refresh.',
      },
      checkedJiraKeys: [],
      unavailableJiraKeys: [],
      omittedJiraKeys: 0,
    })
    render(
      <AiChatPanel
        context={context}
        draftRequest={{ id: 1, prompt: 'Why is FICT-12 late?', autoSend: true }}
      />,
    )
    expect(
      await screen.findByText('Rework that went quiet'),
    ).toBeInTheDocument()
    expect(screen.getByText('Likely')).toBeInTheDocument()
    expect(screen.getByText('Next step')).toBeInTheDocument()
    expect(screen.queryByText('Not waiting for reviewers.')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show reasoning · 1 reason · 1 ruled out · 1 option weighed',
      }),
    )
    expect(screen.getByText('Not waiting for reviewers.')).toBeInTheDocument()
    expect(screen.getByText('Recommended: A')).toBeInTheDocument()
  })

  it('does not show the model name anywhere in the panel', async () => {
    render(<AiChatPanel context={context} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Steerloom AI chat' }),
    )
    const panel = await screen.findByRole('complementary', {
      name: 'Ask Steerloom AI',
    })
    await within(panel).findByText('What would you like to know?')
    expect(panel).not.toHaveTextContent('fictional-enterprise-model')
  })

  it('restores a failed question so the user can edit or retry it', async () => {
    aiMocks.sendAiChat.mockRejectedValueOnce(
      new Error('Fictional endpoint failure.'),
    )
    const question = 'What should the team discuss next?'

    render(<AiChatPanel context={context} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Steerloom AI chat' }),
    )
    const composer = await screen.findByLabelText(
      'Ask a question about this report',
    )
    fireEvent.change(composer, { target: { value: question } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(
      await screen.findByText('Fictional endpoint failure.'),
    ).toBeInTheDocument()
    expect(composer).toHaveValue(question)
    expect(
      within(screen.getByRole('log')).queryByText(question),
    ).not.toBeInTheDocument()
  })

  it('remembers read-only Jira permission for later questions in the chat', async () => {
    aiMocks.sendAiChat
      .mockResolvedValueOnce({
        message: '',
        confirmation: {
          plan: {
            skillId: 'flow-diagnosis',
            jiraSelector: 'delayed-wip',
            jiraMode: 'overview',
          },
          skill: { id: 'flow-diagnosis', name: 'Flow diagnosis' },
          lookup: {
            mode: 'overview',
            source: 'delayed work in progress',
            keys: ['DEMO-1'],
            availableCount: 1,
            omittedCount: 0,
          },
        },
        checkedJiraKeys: [],
        unavailableJiraKeys: [],
        omittedJiraKeys: 0,
      })
      .mockResolvedValue({
        message: 'Fictional Jira evidence reviewed.',
        checkedJiraKeys: ['DEMO-1'],
        unavailableJiraKeys: [],
        omittedJiraKeys: 0,
      })

    const { rerender } = render(
      <AiChatPanel
        context={context}
        jiraScope={{ connectionId: 'fictional', projectKey: 'DEMO' }}
      />,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Steerloom AI chat' }),
    )
    const composer = await screen.findByLabelText(
      'Ask a question about this report',
    )
    fireEvent.change(composer, {
      target: { value: 'Inspect the unusually slow work.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Allow Jira',
      }),
    )

    await waitFor(() => expect(aiMocks.sendAiChat).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Jira read-only/)).toBeInTheDocument()

    fireEvent.change(composer, {
      target: { value: 'Which owner should we speak with?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(aiMocks.sendAiChat).toHaveBeenCalledTimes(3))
    expect(aiMocks.sendAiChat.mock.calls[2]?.[4]).toBe(true)

    // Remembered for the person: a new chat, even on another board, reads
    // without asking, says so, and can be turned off.
    fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }))
    rerender(
      <AiChatPanel
        context={context}
        jiraScope={{ connectionId: 'fictional', projectKey: 'OTHER' }}
      />,
    )
    expect(
      await screen.findByText(/Reads Jira when a question needs it/),
    ).toBeInTheDocument()
    fireEvent.change(composer, { target: { value: 'And the next one?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(aiMocks.sendAiChat).toHaveBeenCalledTimes(4))
    expect(aiMocks.sendAiChat.mock.calls[3]?.[4]).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    expect(
      screen.queryByText(/Reads Jira when a question needs it/),
    ).not.toBeInTheDocument()
    fireEvent.change(composer, { target: { value: 'One more?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(aiMocks.sendAiChat).toHaveBeenCalledTimes(5))
    expect(aiMocks.sendAiChat.mock.calls[4]?.[4]).toBe(false)
  })
  it('shows what the agent wants to read, and answers either way', async () => {
    const asking = {
      message: '',
      confirmation: {
        board: 'Azure DevOps',
        requests: [
          'Read #42 in detail: description, comments, history and links',
        ],
        skill: { id: 'item-investigation', name: 'Item investigation' },
      },
      checkedJiraKeys: [],
      unavailableJiraKeys: [],
      omittedJiraKeys: 0,
    }
    const answered = {
      message: 'Fictional answer.',
      checkedJiraKeys: [],
      unavailableJiraKeys: [],
      omittedJiraKeys: 0,
    }
    aiMocks.sendAiChat
      .mockResolvedValueOnce(asking)
      .mockResolvedValueOnce(answered)
      .mockResolvedValueOnce(asking)
      .mockResolvedValueOnce(answered)

    render(
      <AiChatPanel
        context={context}
        jiraScope={{
          connectionId: 'fictional',
          projectKey: 'ADO',
          provider: 'azure-devops',
          boardId: '00000000-0000-0000-0000-000000000000',
        }}
      />,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Steerloom AI chat' }),
    )
    const composer = await screen.findByLabelText(
      'Ask a question about this report',
    )
    fireEvent.change(composer, { target: { value: 'Why is #42 stuck?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(
      await screen.findByText(/Read #42 in detail: description, comments/),
    ).toBeInTheDocument()
    // Saying no answers from the report alone.
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue without Azure DevOps' }),
    )
    await waitFor(() => expect(aiMocks.sendAiChat).toHaveBeenCalledTimes(2))
    expect(aiMocks.sendAiChat.mock.calls[1]?.[4]).toBe(false)
    expect(aiMocks.sendAiChat.mock.calls[1]?.[7]).toBe(true)

    // Saying yes asks again with reading allowed, and remembers it.
    fireEvent.change(composer, { target: { value: 'And #43?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Allow Azure DevOps',
      }),
    )
    await waitFor(() => expect(aiMocks.sendAiChat).toHaveBeenCalledTimes(4))
    expect(aiMocks.sendAiChat.mock.calls[3]?.[4]).toBe(true)
    expect(aiMocks.sendAiChat.mock.calls[3]?.[7]).toBe(false)
  })
})

describe('Steerloom AI answer formatting', () => {
  afterEach(cleanup)

  it('shows bold as emphasis, with item keys still linked inside it', () => {
    render(
      <AiMessageContent
        message={{
          role: 'assistant',
          content:
            '**Review is the queue**, not FLOW-112 itself. Stray ** gone.',
        }}
        links={(key) => `https://jira.example/browse/${key}`}
      />,
    )
    expect(screen.getByText('Review is the queue').tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: /FLOW-112/ })).toBeTruthy()
    expect(document.body.textContent).not.toContain('**')
  })
})
