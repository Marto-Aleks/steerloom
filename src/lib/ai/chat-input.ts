export interface AiChatKeyIntent {
  key: string
  shiftKey: boolean
  isComposing: boolean
}

export function shouldSendAiChatMessage(intent: AiChatKeyIntent): boolean {
  return intent.key === 'Enter' && !intent.shiftKey && !intent.isComposing
}
