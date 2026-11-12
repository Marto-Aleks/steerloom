import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { Check, Copy, Minus } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import { SteerloomMark } from '../../components/SteerloomMark'
import {
  GlassButton,
  GlassPanel,
  StatusBadge,
  StatusMessage,
} from '../../components/ui'
import { TeamNotes } from './TeamNotes'
import type { ProgressEvent } from '../../lib/progress'
import {
  getAiConfiguration,
  sendAiChat,
  type AiConfigurationInfo,
  type AiConversationMessage,
} from '../../lib/ai/ai-http'
import { shouldSendAiChatMessage } from '../../lib/ai/chat-input'
import type { AiAgentApproval, AiAgentConfirmation } from '../../lib/ai/agent'
import {
  AI_CONVERSATION_HISTORY_LIMIT,
  AI_USER_MESSAGE_CHAR_LIMIT,
} from '../../lib/ai/conversation'
import {
  extractProjectTicketKeys,
  extractTicketKeys,
  type AiJiraLookup,
  type AiJiraScope,
} from '../../lib/ai/jira-evidence'
import type { AiReportContext } from '../../lib/ai/report-context'
import { formatAiResponse } from '../../lib/ai/response-format'
import { RichText } from './AiRichText'
import { AgentActivity } from './AgentActivity'
import { AnswerCard } from './AnswerCard'
import { StreamingAnswer } from './StreamingAnswer'

/*
 * Board reading, once allowed, is remembered for the person in this browser,
 * on every board, so they are asked once rather than in every chat. The panel says it is on and
 * offers to turn it off; saying no is never remembered.
 */
const boardReadingKey = (scope?: AiJiraScope) =>
  scope ? 'steerloom:board-reading' : ''

function boardReadingRemembered(key: string): boolean {
  if (!key) return false
  try {
    return localStorage.getItem(key) === 'on'
  } catch {
    return false
  }
}

function rememberBoardReading(key: string, on: boolean) {
  if (!key) return
  try {
    if (on) localStorage.setItem(key, 'on')
    else localStorage.removeItem(key)
  } catch {
    /* No storage: the panel asks again next time. */
  }
}

interface AiChatPanelProps {
  context: AiReportContext
  jiraScope?: AiJiraScope
  draftRequest?: AiChatDraftRequest
  /** Where an item key in an answer opens; keys without a link are only highlighted. */
  itemLinks?: (key: string) => string | undefined
  /** An item's title from the board, shown on hover over its key. */
  itemTitles?: (key: string) => string | undefined
  /** Owners and admins: the key form, shown in place of the chat until a key works. */
  keyForm?: ReactNode
  /** Changes when the workspace key changes, so the panel checks again. */
  configurationKey?: string
  /** What the team wrote about how it works; the AI reads it with every question. */
  teamNotes?: string
  /** Owners and admins save the notes with the briefing. */
  onTeamNotesChange?: (notes: string) => void
}

export interface AiChatDraftRequest {
  id: number
  prompt: string
  autoSend?: boolean
  fallback?: string
}

export function AiChatPanel({
  context,
  jiraScope,
  draftRequest,
  itemLinks,
  itemTitles,
  keyForm,
  configurationKey = '',
  teamNotes,
  onTeamNotesChange,
}: AiChatPanelProps) {
  const readingKey = boardReadingKey(jiraScope)
  const [readingRemembered, setReadingRemembered] = useState(() =>
    boardReadingRemembered(readingKey),
  )
  const [open, setOpen] = useState(false)
  const [configuration, setConfiguration] =
    useState<AiConfigurationInfo | null>(null)
  const [messages, setMessages] = useState<AiConversationMessage[]>([])
  const [draft, setDraft] = useState('')
  const [checking, setChecking] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [pendingConfirmation, setPendingConfirmation] =
    useState<AiAgentConfirmation | null>(null)
  const [jiraAllowedForChat, setJiraAllowedForChat] = useState(() =>
    boardReadingRemembered(boardReadingKey(jiraScope)),
  )
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  /** Reads and working notes so far in this answer, oldest first. */
  const [trail, setTrail] = useState<ProgressEvent[]>([])
  /** The answer as the AI writes it; replaced by the finished answer. */
  const [streamed, setStreamed] = useState('')
  const lastProgress = useRef<ProgressEvent | null>(null)
  const onProgress = (event: ProgressEvent) => {
    // The step that just ended joins the trail when it was a read or a note;
    // "weighing" lines are the waiting itself, not something done.
    const previous = lastProgress.current
    if (
      previous &&
      previous.step !== 'plan' &&
      previous.step !== 'answer' &&
      previous.step !== 'read' &&
      previous.label !== event.label
    )
      setTrail((items) => [...items, previous])
    lastProgress.current = event
    // A read means the text so far was a working note, not the answer.
    if (event.step === 'jira' || event.step === 'note') setStreamed('')
    setProgress(event)
  }
  const [copied, setCopied] = useState<number | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const previouslyOpened = useRef(false)
  const startedInvestigation = useRef<number | null>(null)
  const reportIdentity = useMemo(
    () =>
      JSON.stringify({
        generatedAt: context.generatedAt,
        sourceLabel: context.sourceLabel,
        boardName: context.boardName,
        scope: context.scope,
        jiraScope,
      }),
    [
      context.boardName,
      context.generatedAt,
      context.scope,
      context.sourceLabel,
      jiraScope,
    ],
  )

  // Checked on open and again whenever the workspace key changes (a key
  // saved in this panel turns the setup view into the chat).
  useEffect(() => {
    const controller = new AbortController()
    getAiConfiguration(controller.signal)
      .then(setConfiguration)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(caught))
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false)
      })
    return () => controller.abort()
  }, [configurationKey])

  useEffect(() => {
    activeRequest.current?.abort()
    setMessages([])
    setDraft('')
    setSending(false)
    setError('')
    setPendingConfirmation(null)
    const remembered = boardReadingRemembered(readingKey)
    setReadingRemembered(remembered)
    setJiraAllowedForChat(remembered)
    return () => activeRequest.current?.abort()
  }, [reportIdentity, readingKey])

  useEffect(() => {
    if (!draftRequest) return
    setOpen(true)
    setDraft(draftRequest.prompt)
    setError('')
    setPendingConfirmation(null)
  }, [draftRequest])

  // The docked panel is non-modal: on wide screens the page reserves room for
  // it (see `.ai-chat-docked` in components.css) instead of being covered.
  useEffect(() => {
    if (!open) return
    document.body.classList.add(AI_CHAT_DOCKED_CLASS)
    return () => document.body.classList.remove(AI_CHAT_DOCKED_CLASS)
  }, [open])

  const configured = configuration?.configured === true

  // Move focus into the panel on open (the composer once AI is configured,
  // otherwise the panel itself so Escape still works) and back on close.
  useEffect(() => {
    if (open) {
      previouslyOpened.current = true
      ;(inputRef.current ?? panelRef.current)?.focus()
      return
    }
    if (!previouslyOpened.current) return
    previouslyOpened.current = false
    launcherRef.current?.focus()
  }, [open, configured])

  useEffect(() => {
    if (!open) return
    const conversation = conversationRef.current
    if (conversation) conversation.scrollTop = conversation.scrollHeight
  }, [error, messages, open, pendingConfirmation, sending])

  // Titles the assistant read in this chat, then the board's own.
  const titleOf = (key: string): string | undefined => {
    const upper = key.toUpperCase()
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const title = messages[index]?.itemTitles?.[upper]
      if (title) return title
    }
    return itemTitles?.(key)
  }
  const providerLabel =
    jiraScope?.provider === 'trello'
      ? 'Trello'
      : jiraScope?.provider === 'azure-devops'
        ? 'Azure DevOps'
        : 'Jira'
  const draftTicketKeys = extractTicketKeys(draft)
  const draftJiraKeys = jiraScope
    ? extractProjectTicketKeys(draft, jiraScope.projectKey, 25)
    : []
  // Trello and Azure DevOps keys (CARD-12, #123) need no project match.
  const jiraDraftProblem =
    draftTicketKeys.length === 0
      ? ''
      : !jiraScope || jiraScope.provider
        ? ''
        : draftJiraKeys.length === 0
          ? `This report can check ${jiraScope.projectKey} items only. Use a matching key or load the correct project.`
          : ''

  const requestChat = async (
    nextMessages: AiConversationMessage[],
    agentApproval?: AiAgentApproval,
    board: { allow?: boolean; decline?: boolean } = {},
  ) => {
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setError('')
    setProgress(null)
    setTrail([])
    setStreamed('')
    lastProgress.current = null
    setSending(true)

    try {
      const answer = await sendAiChat(
        context,
        nextMessages,
        jiraScope,
        agentApproval,
        board.allow ?? jiraAllowedForChat,
        controller.signal,
        onProgress,
        board.decline ?? false,
        (text) => setStreamed((current) => current + text),
      )
      if (answer.confirmation) {
        setPendingConfirmation(answer.confirmation)
        return true
      }
      if (!answer.message) {
        throw new Error('The AI endpoint did not return an answer.')
      }
      setPendingConfirmation(null)
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: answer.message,
          ...(answer.card ? { card: answer.card } : {}),
          ...(answer.checkedJiraKeys.length
            ? { checkedJiraKeys: answer.checkedJiraKeys }
            : {}),
          ...(answer.unavailableJiraKeys.length
            ? { unavailableJiraKeys: answer.unavailableJiraKeys }
            : {}),
          ...(answer.jiraLookupMode
            ? { jiraLookupMode: answer.jiraLookupMode }
            : {}),
          ...(answer.jiraLookupSource
            ? { jiraLookupSource: answer.jiraLookupSource }
            : {}),
          ...(answer.omittedJiraKeys
            ? { omittedJiraKeys: answer.omittedJiraKeys }
            : {}),
          ...(answer.skill ? { skill: answer.skill } : {}),
          ...(answer.itemTitles && Object.keys(answer.itemTitles).length
            ? { itemTitles: answer.itemTitles }
            : {}),
        },
      ])
      return true
    } catch (caught) {
      if (!controller.signal.aborted) setError(errorMessage(caught))
      return false
    } finally {
      if (!controller.signal.aborted) setSending(false)
    }
  }

  const ask = async (question: string) => {
    const content = question.trim()
    if (!content || !configured || sending) return
    const userMessage: AiConversationMessage = { role: 'user', content }
    const nextMessages: AiConversationMessage[] = [
      ...messages,
      userMessage,
    ].slice(-AI_CONVERSATION_HISTORY_LIMIT)
    setMessages(nextMessages)
    setPendingConfirmation(null)
    setDraft('')
    const completed = await requestChat(nextMessages)
    if (!completed) {
      setMessages(nextMessages.slice(0, -1))
      setDraft(content)
    }
  }

  const startInvestigation = useEffectEvent((prompt: string) => {
    void ask(prompt)
  })

  useEffect(() => {
    if (
      !draftRequest?.autoSend ||
      !configured ||
      sending ||
      startedInvestigation.current === draftRequest.id
    )
      return
    startedInvestigation.current = draftRequest.id
    startInvestigation(draftRequest.prompt)
  }, [draftRequest, configured, sending])

  const resolveConfirmation = async (allowJira: boolean) => {
    if (!pendingConfirmation || sending) return
    if (allowJira) {
      setJiraAllowedForChat(true)
      rememberBoardReading(readingKey, true)
      setReadingRemembered(true)
    }
    setPendingConfirmation(null)
    // The planner's proposal is approved as a plan; the agent simply asks
    // again with board reading allowed, or answers without it.
    if (pendingConfirmation.plan) {
      const approval: AiAgentApproval = {
        plan: pendingConfirmation.plan,
        allowJira,
      }
      await requestChat(messages, approval)
      return
    }
    await requestChat(
      messages,
      undefined,
      allowJira ? { allow: true } : { decline: true },
    )
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void ask(draft)
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      !shouldSendAiChatMessage({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing,
      })
    ) {
      return
    }
    event.preventDefault()
    if (!draft.trim() || sending || jiraDraftProblem) return
    void ask(draft)
  }

  if (!open) {
    return (
      <button
        ref={launcherRef}
        type="button"
        className="glass-button ai-chat-launcher"
        data-variant="primary"
        data-state={error ? 'attention' : sending ? 'busy' : 'ready'}
        aria-label={
          sending
            ? 'Open Steerloom AI chat, response in progress'
            : error
              ? 'Open Steerloom AI chat, attention needed'
              : 'Open Steerloom AI chat'
        }
        onClick={() => setOpen(true)}
      >
        <SteerloomMark
          className="ai-chat-launcher__icon"
          tone="white"
          size={15}
          trail={false}
        />
        <span>{sending ? 'Thinking…' : 'Ask Steerloom AI'}</span>
      </button>
    )
  }

  return (
    <aside
      ref={panelRef}
      className="ai-chat-dock"
      tabIndex={-1}
      role="complementary"
      aria-labelledby="ai-chat-title"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        setOpen(false)
      }}
    >
      <GlassPanel className="ai-chat" elevation="floating">
        <div className="ai-chat__header">
          <div className="ai-chat__heading">
            <h2 id="ai-chat-title" className="ai-chat__title">
              <SteerloomMark className="ai-chat__title-mark" size={16} />
              Ask Steerloom AI
            </h2>
            <p className="ai-chat__subtitle">
              Answers from this briefing&apos;s evidence
            </p>
          </div>
          <div className="ai-chat__header-actions">
            {checking ? (
              <StatusBadge tone="neutral">Checking setup</StatusBadge>
            ) : !configured ? (
              <StatusBadge tone="warning">Setup needed</StatusBadge>
            ) : jiraAllowedForChat ? (
              <StatusBadge tone="neutral">
                {providerLabel} read-only
              </StatusBadge>
            ) : null}
            <GlassButton
              className="ai-chat__minimize"
              variant="icon"
              size="compact"
              aria-label="Minimize Steerloom AI chat"
              title="Minimize chat"
              onClick={() => setOpen(false)}
            >
              <UiIcon icon={Minus} />
            </GlassButton>
          </div>
        </div>

        {draftRequest?.fallback && ((!checking && !configured) || error) && (
          <StatusMessage title="Rule-based guidance" variant="info">
            {draftRequest.fallback}
          </StatusMessage>
        )}

        {!checking && !configured && configuration && (
          <div
            className="ai-chat__setup"
            data-form={keyForm ? 'true' : undefined}
          >
            {keyForm ?? (
              <StatusMessage
                variant="info"
                title="Add an AI key to ask questions"
              >
                A workspace owner or admin can connect an Anthropic, OpenAI,
                Gemini, Grok or company AI key under AI assistant on the
                workspace page. The report, signals and evidence work without
                it.
              </StatusMessage>
            )}
          </div>
        )}

        {configured && (
          <>
            <div
              ref={conversationRef}
              className="ai-chat__conversation"
              role="log"
              aria-live="polite"
              aria-label="Steerloom AI conversation"
            >
              <TeamNotes notes={teamNotes} onSave={onTeamNotesChange} />
              {readingRemembered && jiraScope && (
                <p className="ai-chat__board-access">
                  Reads {providerLabel} when a question needs it, read-only.{' '}
                  <button
                    type="button"
                    onClick={() => {
                      rememberBoardReading(readingKey, false)
                      setReadingRemembered(false)
                      setJiraAllowedForChat(false)
                    }}
                  >
                    Turn off
                  </button>
                </p>
              )}
              {messages.length === 0 && !pendingConfirmation && !sending && (
                <div className="ai-chat__welcome">
                  <h3>What would you like to know?</h3>
                  <p>
                    Steerloom AI answers from this briefing&apos;s evidence
                    {jiraScope
                      ? ` and can check ${providerLabel} read-only when you allow it`
                      : ''}
                    . Pick a starting point or ask in your own words.
                  </p>
                  <ul className="ai-chat__starters">
                    {[
                      ...AI_STARTER_QUESTIONS,
                      jiraScope
                        ? 'Who holds the oldest items, and what do their latest comments say?'
                        : 'Explain how the usual limit (P85) is calculated.',
                    ].map((question) => (
                      <li key={question}>
                        <button
                          type="button"
                          className="ai-chat__starter"
                          onClick={() => {
                            setDraft(question)
                            inputRef.current?.focus()
                          }}
                        >
                          {question}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {messages.map((message, index) => (
                <article
                  className="ai-chat__message"
                  data-role={message.role}
                  key={`${message.role}-${index}-${message.content.slice(0, 24)}`}
                >
                  <p className="ai-chat__message-role">
                    {message.role === 'user'
                      ? 'You'
                      : `Steerloom AI${message.skill ? ` · ${message.skill.name}` : ''}`}
                  </p>
                  {message.role === 'assistant' && (
                    <button
                      type="button"
                      className="ai-chat__copy"
                      aria-label={copied === index ? 'Copied' : 'Copy answer'}
                      title={copied === index ? 'Copied' : 'Copy answer'}
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(message.content.replace(/\*\*/g, ''))
                          .then(() => setCopied(index))
                          .catch(() => undefined)
                      }}
                    >
                      <UiIcon
                        icon={copied === index ? Check : Copy}
                        size={14}
                      />
                    </button>
                  )}
                  {message.role === 'assistant' && message.card ? (
                    <AnswerCard
                      card={message.card}
                      links={itemLinks}
                      titles={titleOf}
                      azureKeys={jiraScope?.provider === 'azure-devops'}
                    />
                  ) : (
                    <AiMessageContent
                      message={message}
                      links={itemLinks}
                      titles={titleOf}
                      azureKeys={jiraScope?.provider === 'azure-devops'}
                    />
                  )}
                  {message.role === 'assistant' &&
                    (message.unavailableJiraKeys?.length ||
                      message.omittedJiraKeys) && (
                      <p className="ai-chat__jira-result">
                        {message.unavailableJiraKeys?.length
                          ? `Not available: ${message.unavailableJiraKeys.join(', ')}.`
                          : ''}
                        {message.omittedJiraKeys
                          ? ` ${message.omittedJiraKeys} more ${message.omittedJiraKeys === 1 ? 'item was' : 'items were'} outside the ${message.jiraLookupMode ?? 'Jira'} check limit.`
                          : ''}
                      </p>
                    )}
                </article>
              ))}

              {pendingConfirmation && (
                <article className="ai-chat__agent-confirmation" role="status">
                  {pendingConfirmation.requests ? (
                    <>
                      <p className="ai-chat__message-role">
                        To answer, Steerloom AI would like to read{' '}
                        {providerLabel}, read-only
                      </p>
                      <ul className="ai-chat__agent-requests">
                        {pendingConfirmation.requests.map((request) => (
                          <li key={request}>{request}</li>
                        ))}
                      </ul>
                      <p className="ai-chat__agent-note">
                        Allowing it lets the assistant read the items it needs
                        from now on, on every board; you can turn it off in this
                        panel. It never changes anything.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="ai-chat__message-role">
                        Proposed skill: {pendingConfirmation.skill.name}
                      </p>
                      {pendingConfirmation.lookup && (
                        <p>
                          {jiraLookupSummary(
                            pendingConfirmation.lookup,
                            providerLabel,
                          )}
                        </p>
                      )}
                    </>
                  )}
                  <div className="ai-chat__agent-confirmation-actions">
                    <GlassButton
                      variant="quiet"
                      size="compact"
                      onClick={() => void resolveConfirmation(false)}
                      disabled={sending}
                    >
                      Continue without {providerLabel}
                    </GlassButton>
                    <GlassButton
                      variant="primary"
                      size="compact"
                      onClick={() => void resolveConfirmation(true)}
                      disabled={sending}
                    >
                      Allow {providerLabel}
                    </GlassButton>
                  </div>
                </article>
              )}

              {sending && (
                <>
                  <AgentActivity
                    event={
                      streamed.trim() && progress
                        ? { ...progress, label: 'Writing' }
                        : progress
                    }
                    history={trail}
                  />
                  {streamed.trim() && (
                    <StreamingAnswer
                      text={streamed}
                      plain={(text) => (
                        <AiMessageContent
                          message={{ role: 'assistant', content: text }}
                          links={itemLinks}
                          titles={titleOf}
                          azureKeys={jiraScope?.provider === 'azure-devops'}
                        />
                      )}
                      links={itemLinks}
                      titles={titleOf}
                      azureKeys={jiraScope?.provider === 'azure-devops'}
                    />
                  )}
                </>
              )}
            </div>

            <form className="ai-chat__composer" onSubmit={submit}>
              <label htmlFor="ai-chat-question" className="sr-only">
                Ask a question about this report
              </label>
              <textarea
                ref={inputRef}
                id="ai-chat-question"
                className="glass-input ai-chat__input"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value)
                  if (error) setError('')
                }}
                onKeyDown={handleComposerKeyDown}
                placeholder="Ask about this briefing…"
                maxLength={AI_USER_MESSAGE_CHAR_LIMIT}
                rows={1}
                disabled={sending}
                aria-describedby={
                  jiraDraftProblem ? 'ai-chat-jira-intent' : undefined
                }
              />
              {jiraDraftProblem && (
                <p
                  id="ai-chat-jira-intent"
                  className="ai-chat__jira-intent"
                  data-tone="warning"
                  role="alert"
                >
                  {jiraDraftProblem}
                </p>
              )}
              <div className="ai-chat__composer-actions">
                <span>
                  {draft.length.toLocaleString()} /{' '}
                  {AI_USER_MESSAGE_CHAR_LIMIT.toLocaleString()} characters ·
                  Shift+Enter for a new line
                </span>
                {messages.length > 0 && (
                  <GlassButton
                    variant="quiet"
                    size="compact"
                    onClick={() => {
                      activeRequest.current?.abort()
                      setMessages([])
                      setDraft('')
                      setSending(false)
                      setError('')
                      setPendingConfirmation(null)
                      setJiraAllowedForChat(readingRemembered)
                    }}
                  >
                    Clear chat
                  </GlassButton>
                )}
                <GlassButton
                  type="submit"
                  variant="primary"
                  disabled={
                    !draft.trim() || sending || Boolean(jiraDraftProblem)
                  }
                >
                  {sending ? 'Thinking…' : 'Send'}
                </GlassButton>
              </div>
            </form>
          </>
        )}

        {error && (
          <div className="ai-chat__error">
            <StatusMessage variant="error" role="alert">
              {error}
            </StatusMessage>
          </div>
        )}
      </GlassPanel>
    </aside>
  )
}

const AI_CHAT_DOCKED_CLASS = 'ai-chat-docked'

const AI_STARTER_QUESTIONS = [
  'What should the team focus on today?',
  'Which items are most at risk, and why?',
  'How has our flow changed compared with the previous period?',
]

function errorMessage(caught: unknown): string {
  return caught instanceof Error
    ? caught.message
    : 'The AI request could not be completed.'
}

function jiraLookupSummary(lookup: AiJiraLookup, provider = 'Jira'): string {
  const preview = lookup.keys.slice(0, 4).join(', ')
  const remaining = Math.max(0, lookup.keys.length - 4)
  const selection = remaining ? `${preview} + ${remaining} more` : preview
  const evidence =
    provider === 'Trello'
      ? lookup.mode === 'overview'
        ? 'card titles and current status'
        : 'card titles, current status, and observed list history'
      : lookup.mode === 'overview'
        ? 'ownership, status, priority, summary, and update dates'
        : 'bounded details, comments, history, and relationships'
  return `Read-only ${provider} ${lookup.mode}: ${lookup.availableCount} ${lookup.source} (${selection}). Checking ${evidence}.${lookup.omittedCount ? ` This check is limited to the first ${lookup.keys.length}.` : ''}`
}

export function AiMessageContent({
  message,
  links,
  titles,
  azureKeys = false,
}: {
  message: AiConversationMessage
  links?: (key: string) => string | undefined
  titles?: (key: string) => string | undefined
  /** Azure DevOps boards: #1234 is an item key too. */
  azureKeys?: boolean
}) {
  if (message.role === 'user') {
    return <p className="ai-chat__message-content">{message.content}</p>
  }
  return (
    <div className="ai-chat__message-content ai-chat__formatted-response">
      {formatAiResponse(message.content).map((block, index) => {
        if (block.type === 'heading') {
          return (
            <p
              className="ai-chat__response-heading"
              key={`${index}-${block.text}`}
            >
              {block.text}
            </p>
          )
        }
        if (block.type === 'list') {
          return (
            <ul key={`${index}-${block.items[0] ?? 'list'}`}>
              {block.items.map((item) => (
                <li key={item}>
                  <RichText
                    text={item}
                    links={links}
                    titles={titles}
                    azureKeys={azureKeys}
                  />
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={`${index}-${block.text.slice(0, 24)}`}>
            <RichText
              text={block.text}
              links={links}
              titles={titles}
              azureKeys={azureKeys}
            />
          </p>
        )
      })}
    </div>
  )
}
