import { describe, expect, it } from 'vitest'
import { shouldSendAiChatMessage } from './chat-input'

describe('AI chat keyboard intent', () => {
  it('sends with Enter', () => {
    expect(
      shouldSendAiChatMessage({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true)
  })

  it('keeps Shift+Enter as a new line', () => {
    expect(
      shouldSendAiChatMessage({
        key: 'Enter',
        shiftKey: true,
        isComposing: false,
      }),
    ).toBe(false)
  })

  it('does not submit while an input method is composing text', () => {
    expect(
      shouldSendAiChatMessage({
        key: 'Enter',
        shiftKey: false,
        isComposing: true,
      }),
    ).toBe(false)
  })
})
