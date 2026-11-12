import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CircleCheck } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import {
  GlassButton,
  GlassInput,
  GlassPanel,
  GlassSelect,
  SegmentedControl,
  StatusBadge,
  StatusMessage,
} from '../../components/ui'
import { workspaceRequest } from '../../lib/workspace/api'
import type { WorkspaceSession } from '../../lib/workspace/model'
import {
  AI_PRESETS,
  aiChoiceOf,
  aiProviderOf,
  type AiChoice,
} from '../../lib/workspace/ai-choices'
import { AiProviderMarks } from './AiProviderMarks'
import { parseAiExample, type AiExample } from '../../lib/workspace/ai-example'

interface AiModelOption {
  id: string
  label: string
}

const providers: ReadonlyArray<{ value: AiChoice; label: string }> = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'grok', label: 'Grok' },
  { value: 'custom', label: 'Company' },
]

const providerNames: Record<AiChoice, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  grok: 'xAI Grok',
  custom: 'Company endpoint',
}

const keyHelp: Record<AiChoice, { text: string; href?: string }> = {
  anthropic: {
    text: 'Create a key in the Anthropic Console',
    href: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    text: 'Create a key on the OpenAI platform',
    href: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    text: 'Create a key in Google AI Studio',
    href: 'https://aistudio.google.com/apikey',
  },
  grok: {
    text: 'Create a key in the xAI Console',
    href: 'https://console.x.ai',
  },
  custom: {
    text: 'A company AI gateway, Azure OpenAI, OpenRouter or a local model server, speaking OpenAI, Anthropic or Gemini style.',
  },
}

const OTHER_MODEL = '__other__'

const modelPlaceholder: Record<AiChoice, string> = {
  anthropic: 'Optional: Claude Sonnet unless you name another',
  openai: 'Optional: found automatically',
  gemini: 'Optional: found automatically',
  grok: 'Optional: found automatically',
  custom: 'Optional: found automatically',
}

/** Stored by the server when a gateway answers with its own default model. */
const GATEWAY_DEFAULT_MODEL = '(gateway default)'
const modelName = (model: string) =>
  model === GATEWAY_DEFAULT_MODEL ? 'the gateway’s default model' : model

/**
 * Workspace AI key: owners and admins connect one provider key for the whole
 * team. The key goes to the server once and is never shown again.
 */
export function AiKeySettings({
  session,
  onSession,
  disabled,
  compact = false,
  onSaved,
}: {
  session: WorkspaceSession
  onSession: (session: WorkspaceSession) => void
  disabled?: boolean
  /**
   * Inside the AI panel: no card chrome or heading, the form open from the
   * start, so a key can be connected without leaving the briefing.
   */
  compact?: boolean
  /** A key was checked and saved. */
  onSaved?: () => void
}) {
  const current = session.ai
  const editing = session.workspaceRole !== 'member'
  const [open, setOpen] = useState(compact)
  const currentChoice = current ? aiChoiceOf(current) : undefined
  // What the person picked; Gemini and Grok are saved as known endpoints.
  const [provider, setProvider] = useState<AiChoice>(
    currentChoice ?? 'anthropic',
  )
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(
    current?.model === GATEWAY_DEFAULT_MODEL ? '' : (current?.model ?? ''),
  )
  const [typedEndpoint, setEndpoint] = useState('')
  // From a pasted example request: the exact format and key header, which
  // the server then uses instead of working them out.
  const [example, setExample] = useState('')
  const [hints, setHints] = useState<AiExample | null>(null)
  const applyExample = (text: string) => {
    setExample(text)
    if (!text.trim()) {
      setHints(null)
      return
    }
    const parsed = parseAiExample(text)
    setHints(parsed)
    if (parsed.endpoint && !parsed.unsupported) setEndpoint(parsed.endpoint)
    if (parsed.model && !parsed.unsupported) setModel(parsed.model)
  }
  const endpoint =
    provider === 'gemini' || provider === 'grok'
      ? AI_PRESETS[provider].endpoint
      : typedEndpoint
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const keepsKey = !!current && currentChoice === provider
  const [models, setModels] = useState<AiModelOption[]>([])
  const [modelsState, setModelsState] = useState<
    'idle' | 'loading' | 'ready' | 'failed'
  >('idle')
  const [customModel, setCustomModel] = useState(false)
  const modelInput = useRef<HTMLInputElement>(null)

  // Ask the provider which models this key can use, once a key (or the saved
  // key) and, for company endpoints, an address are available.
  const canList =
    open &&
    (apiKey.trim().length >= 20 || keepsKey) &&
    (provider !== 'custom' || endpoint.trim().length > 8 || keepsKey)
  useEffect(() => {
    if (!canList) {
      setModels([])
      setModelsState('idle')
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setModelsState('loading')
      workspaceRequest<{ models: AiModelOption[] }>(
        '/api/workspace/ai-models',
        'POST',
        { provider: aiProviderOf(provider), apiKey, endpoint },
        controller.signal,
      )
        .then(({ models: listed }) => {
          setModels(listed)
          setModelsState(listed.length ? 'ready' : 'failed')
          setModel((chosen) =>
            listed.some((item) => item.id === chosen)
              ? chosen
              : provider === 'anthropic'
                ? (listed.find((item) => item.id.includes('sonnet'))?.id ??
                  listed[0]?.id ??
                  '')
                : '',
          )
          setCustomModel(false)
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setModels([])
          setModelsState('failed')
        })
    }, 600)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [canList, provider, apiKey, endpoint])

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await workspaceRequest<{ session: WorkspaceSession }>(
        '/api/workspace/ai-settings',
        'PUT',
        {
          provider: aiProviderOf(provider),
          apiKey,
          model,
          endpoint,
          ...(provider === 'custom' && hints?.format && !hints.unsupported
            ? { format: hints.format, keyHeader: hints.keyHeader }
            : {}),
        },
      )
      setApiKey('')
      setOpen(false)
      const answered = result.session.ai?.model
      setNotice(
        answered
          ? `Saved. The key works, using ${modelName(answered)}.`
          : 'Saved. The key works.',
      )
      onSession(result.session)
      onSaved?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save.')
      // The endpoint needs a model name Steerloom could not find: ask for it.
      if (
        (caught as { reason?: unknown } | null)?.reason === 'ai-model-required'
      ) {
        setCustomModel(true)
        window.requestAnimationFrame(() => modelInput.current?.focus())
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await workspaceRequest<{ session: WorkspaceSession }>(
        '/api/workspace/ai-settings',
        'DELETE',
        {},
      )
      setModel('')
      setNotice('Removed.')
      onSession(result.session)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove.')
    } finally {
      setBusy(false)
    }
  }

  const help = keyHelp[provider]
  const Wrapper = compact ? 'section' : GlassPanel
  return (
    <Wrapper
      id="ai-assistant"
      className={compact ? 'home-ai home-ai--compact' : 'home-ai'}
      {...(compact
        ? { 'aria-label': 'Connect an AI key' }
        : { elevation: 'base' as const, 'aria-labelledby': 'ai-key-title' })}
    >
      <div className="home-ai__intro">
        <div className="home-ai__lead">
          <div className="home-ai__heading">
            <div>
              {compact ? (
                <p className="field-label">Connect your team’s AI key</p>
              ) : (
                <h3 id="ai-key-title" className="home-ai__title">
                  AI assistant
                </h3>
              )}
              <p className="metadata-copy">
                {current
                  ? `${providerNames[currentChoice ?? current.provider]} · ${modelName(current.model)}${current.endpointHost && currentChoice === 'custom' ? ` · ${current.endpointHost}` : ''}`
                  : compact
                    ? `Takes a minute. The key works for everyone in ${session.workspaceName}, and you can change it on the workspace page.`
                    : 'Ask questions about your briefings with your team’s own AI key.'}
              </p>
            </div>
            {!compact && (
              <StatusBadge tone={current ? 'success' : 'neutral'}>
                {current ? 'Connected' : 'Not connected'}
              </StatusBadge>
            )}
          </div>
          {!editing && !current && (
            <p className="body-copy">
              Ask a workspace owner or admin to connect an AI key.
            </p>
          )}
          {editing && !open && (
            <div className="home-ai__actions">
              <GlassButton
                size="compact"
                disabled={disabled || busy}
                onClick={() => {
                  setOpen(true)
                  setNotice('')
                }}
              >
                {current ? 'Change key' : 'Connect an AI key'}
              </GlassButton>
              {current && (
                <GlassButton
                  variant="quiet"
                  size="compact"
                  disabled={disabled || busy}
                  onClick={() => void remove()}
                >
                  Remove key
                </GlassButton>
              )}
            </div>
          )}
        </div>
        {!open && (
          <AiProviderMarks
            active={currentChoice}
            disabled={disabled || busy}
            onPick={
              editing
                ? (choice) => {
                    setProvider(choice)
                    if (choice !== currentChoice) setModel('')
                    setOpen(true)
                    setNotice('')
                    setError('')
                  }
                : undefined
            }
          />
        )}
      </div>
      {editing && open && (
        <form
          className="workspace-form home-form home-ai__form"
          onSubmit={(event) => void save(event)}
          aria-busy={busy}
        >
          <SegmentedControl
            label="AI provider"
            options={providers}
            value={provider}
            onChange={(value) => {
              setProvider(value)
              setError('')
              if (value !== currentChoice) setModel('')
            }}
          />
          <p className="metadata-copy home-form__hint">
            {help.href ? (
              <>
                <a href={help.href} target="_blank" rel="noreferrer">
                  {help.text}
                </a>
                . An API key is not part of a ChatGPT or Claude subscription:
                the provider bills it by use.
              </>
            ) : (
              help.text
            )}
          </p>
          {provider === 'custom' && (
            <>
              <label>
                Endpoint address
                <GlassInput
                  type="url"
                  value={typedEndpoint}
                  onChange={(event) => {
                    setEndpoint(event.target.value)
                    // A hand-edited address means the example no longer applies.
                    setHints(null)
                    setExample('')
                  }}
                  placeholder={
                    keepsKey
                      ? `Leave empty to keep ${current?.endpointHost ?? 'the saved endpoint'}`
                      : 'https://ai-gateway.yourcompany.com/v1'
                  }
                  required={!keepsKey}
                  maxLength={300}
                  aria-describedby="ai-endpoint-help"
                />
              </label>
              <p id="ai-endpoint-help" className="metadata-copy">
                The base address is enough, as your AI team or the provider
                gives it, for example{' '}
                <code>https://ai-gateway.yourcompany.com/v1</code> or{' '}
                <code>
                  https://your-name.openai.azure.com/openai/deployments/gpt-4o
                </code>
                . Steerloom adds the rest and works out how the gateway wants
                the key sent.
              </p>
              <details className="home-ai__example" open={!!example}>
                <summary>
                  Have an example request from your AI team? Paste it here
                </summary>
                <label>
                  Example request
                  <textarea
                    className="glass-input home-ai__example-text"
                    value={example}
                    onChange={(event) => applyExample(event.target.value)}
                    placeholder={
                      'curl https://… -H "api-key: …" -d \'{"model": …}\''
                    }
                    rows={4}
                    spellCheck={false}
                  />
                </label>
                <p className="metadata-copy" aria-live="polite">
                  {!hints
                    ? 'Steerloom reads the address, the key header, the API style and the model from it. Your key is never taken from the example: paste it below.'
                    : hints.unsupported
                      ? `This example uses ${hints.unsupported}, which Steerloom does not speak yet. Ask your AI team for a chat-completions, Anthropic messages or Gemini example.`
                      : hints.format
                        ? `Recognised: ${{ openai: 'OpenAI style', anthropic: 'Anthropic style', gemini: 'Gemini style' }[hints.format]}${hints.keyHeader ? `, key in ${hints.keyHeader === 'authorization' ? 'Authorization' : hints.keyHeader}` : ''}${hints.model ? `, model ${hints.model}` : ''}. Paste your key below and save.`
                        : 'Steerloom could not read a request from this. Paste the full curl example, including the address and headers.'}
                </p>
              </details>
            </>
          )}
          <label>
            API key
            <GlassInput
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={keepsKey ? 'Leave empty to keep the saved key' : ''}
              autoComplete="off"
              required={!keepsKey}
              maxLength={400}
            />
          </label>
          {modelsState === 'ready' && !customModel ? (
            <label>
              Model
              <GlassSelect
                value={model}
                onChange={(event) => {
                  if (event.target.value === OTHER_MODEL) {
                    setCustomModel(true)
                    setModel('')
                    return
                  }
                  setModel(event.target.value)
                }}
              >
                <option value="">Let Steerloom choose</option>
                {models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label === item.id
                      ? item.id
                      : `${item.label} (${item.id})`}
                  </option>
                ))}
                <option value={OTHER_MODEL}>Other…</option>
              </GlassSelect>
            </label>
          ) : (
            <label>
              Model
              <GlassInput
                ref={modelInput}
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={modelPlaceholder[provider]}
                maxLength={100}
              />
            </label>
          )}
          <p className="metadata-copy" aria-live="polite">
            {modelsState === 'loading'
              ? 'Checking which models this key can use…'
              : modelsState === 'ready'
                ? `${models.length} models available to this key.`
                : modelsState === 'failed'
                  ? 'Steerloom finds the model when you save. If it can’t, it will say where to look.'
                  : 'Paste the key to see the models it can use.'}
          </p>
          <p className="metadata-copy">
            Usage is billed to this key&apos;s account. Steerloom checks the key
            once, stores it encrypted on the server and never shows it again.
          </p>
          {error && <StatusMessage variant="error">{error}</StatusMessage>}
          <div className="home-ai__actions">
            <GlassButton type="submit" variant="primary" disabled={busy}>
              {busy ? 'Checking key…' : 'Check and save'}
            </GlassButton>
            <GlassButton
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setApiKey('')
                setError('')
              }}
            >
              Cancel
            </GlassButton>
          </div>
        </form>
      )}
      <p className="home-saved" role="status">
        {notice && (
          <>
            <UiIcon icon={CircleCheck} size={16} className="home-saved__icon" />
            {notice}
          </>
        )}
      </p>
      {!open && error && <StatusMessage variant="error">{error}</StatusMessage>}
    </Wrapper>
  )
}
