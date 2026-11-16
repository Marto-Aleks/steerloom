import { describe, expect, it, vi } from 'vitest'
import {
  contextFingerprint,
  demoAiSetup,
  recordedAnswer,
  type DemoAiRecording,
} from './demo-ai'
import recorded from './demo-ai-answers.json'

const recording = recorded as DemoAiRecording
const DAY = 86_400_000

describe("the demo's recorded Steerloom AI answers", () => {
  it('answer every demo question, recorded on today’s demo board', () => {
    const boardNow = new Date(recording.boardNow)
    // The demo board is always loaded "now", so its data is never stale.
    // Rebuild it as it was during recording, wall clock included.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(boardNow)
    const { context, questions } = demoAiSetup(boardNow)
    vi.useRealTimers()
    // A changed demo board, question or AI context needs a new recording:
    // npm run ai:demo-record
    expect(contextFingerprint(context)).toBe(recording.fingerprint)
    for (const question of questions)
      expect(
        recordedAnswer(recording, question.question),
        question.label,
      ).toBeDefined()
  })

  it('ask the same questions every day, so the buttons always match', () => {
    const start = Date.parse(recording.boardNow)
    const first = demoAiSetup(new Date(start)).questions
    for (let day = 1; day < 7; day++)
      expect(demoAiSetup(new Date(start + day * DAY)).questions).toEqual(first)
  })

  it('name no dates, which would go stale as the board moves with today', () => {
    for (const answer of recording.answers) {
      const text = `${answer.message} ${JSON.stringify(answer.card ?? {})}`
      expect(text, answer.label).not.toMatch(
        /\b\d{4}-\d\d-\d\d\b|\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}\b/,
      )
    }
  })

  it('match a question whatever its spacing', () => {
    const fake: DemoAiRecording = {
      ...recording,
      answers: [
        {
          label: 'Q',
          question: 'Why is  DEMO-36\nlate?',
          message: 'A',
          trail: [],
        },
      ],
    }
    expect(recordedAnswer(fake, 'Why is DEMO-36 late?')?.message).toBe('A')
    expect(recordedAnswer(fake, 'Why is DEMO-35 late?')).toBeUndefined()
  })
})
