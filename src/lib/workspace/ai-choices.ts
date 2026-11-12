import type { AiProvider, WorkspaceAiSettings } from './model'

/**
 * The AI services people pick from. Gemini and Grok offer OpenAI-compatible
 * APIs, so they are stored as a company endpoint with a known address; the
 * server needs no provider of its own for them.
 */
export type AiChoice = 'anthropic' | 'openai' | 'gemini' | 'grok' | 'custom'

export const AI_PRESETS = {
  gemini: {
    endpoint:
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    host: 'generativelanguage.googleapis.com',
  },
  grok: {
    endpoint: 'https://api.x.ai/v1/chat/completions',
    host: 'api.x.ai',
  },
} as const

/** The four services shown as marks, in the order they appear. */
export const AI_MARKS = [
  { choice: 'anthropic', name: 'Claude', file: 'ai-claude.svg' },
  { choice: 'openai', name: 'OpenAI', file: 'ai-openai.svg' },
  { choice: 'gemini', name: 'Gemini', file: 'ai-gemini.svg' },
  { choice: 'grok', name: 'Grok', file: 'ai-grok.svg' },
] as const satisfies ReadonlyArray<{
  choice: AiChoice
  name: string
  file: string
}>

export function aiChoiceOf(settings: WorkspaceAiSettings): AiChoice {
  if (settings.provider !== 'custom') return settings.provider
  if (settings.endpointHost === AI_PRESETS.gemini.host) return 'gemini'
  if (settings.endpointHost === AI_PRESETS.grok.host) return 'grok'
  return 'custom'
}

/** What the server stores for a choice. */
export function aiProviderOf(choice: AiChoice): AiProvider {
  return choice === 'gemini' || choice === 'grok' ? 'custom' : choice
}
