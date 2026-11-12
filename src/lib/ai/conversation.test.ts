import { describe, expect, it } from 'vitest'
import {
  AI_CONVERSATION_MESSAGE_LIMIT,
  AI_CONVERSATION_SUMMARY_CHAR_LIMIT,
  buildAiConversationSummary,
} from './conversation'

describe('AI conversation memory', () => {
  it('keeps recent turns verbatim and creates bounded memory for older turns', () => {
    const messages = Array.from(
      { length: AI_CONVERSATION_MESSAGE_LIMIT + 2 },
      (_, index) => ({
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `Conversation detail ${index}\nwith spacing`,
      }),
    )

    const summary = buildAiConversationSummary(messages)

    expect(summary).toContain('User: Conversation detail 0 with spacing')
    expect(summary).toContain(
      'Steerloom AI: Conversation detail 1 with spacing',
    )
    expect(summary).not.toContain('Conversation detail 2')
    expect(summary!.length).toBeLessThanOrEqual(
      AI_CONVERSATION_SUMMARY_CHAR_LIMIT,
    )
  })

  it('does not add memory while every turn fits in the recent window', () => {
    expect(
      buildAiConversationSummary([
        { role: 'user', content: 'What should we discuss?' },
      ]),
    ).toBeUndefined()
  })
})
