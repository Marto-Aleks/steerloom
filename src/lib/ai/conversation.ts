export const AI_CONVERSATION_MESSAGE_LIMIT = 16
export const AI_CONVERSATION_HISTORY_LIMIT = 40
export const AI_CONVERSATION_SUMMARY_CHAR_LIMIT = 6_000
export const AI_USER_MESSAGE_CHAR_LIMIT = 2_000
export const AI_ASSISTANT_MESSAGE_CHAR_LIMIT = 16_000
export const AI_CHAT_REQUEST_BYTE_LIMIT = 524_288

interface SummarizedConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export function buildAiConversationSummary(
  messages: SummarizedConversationMessage[],
): string | undefined {
  const olderMessages = messages.slice(0, -AI_CONVERSATION_MESSAGE_LIMIT)
  if (!olderMessages.length) return undefined

  const entries = olderMessages.map((message) => {
    const label = message.role === 'user' ? 'User' : 'Steerloom AI'
    const compact = message.content.replace(/\s+/g, ' ').trim()
    const bounded =
      compact.length > 700 ? `${compact.slice(0, 697)}...` : compact
    return `${label}: ${bounded}`
  })
  const summary = entries.join('\n')
  return summary.slice(
    Math.max(0, summary.length - AI_CONVERSATION_SUMMARY_CHAR_LIMIT),
  )
}
