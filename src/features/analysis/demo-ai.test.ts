import { describe, expect, it, vi } from 'vitest'
import {
  contextFingerprint,
  demoAiSetup,
  recordedAnswer,
  type DemoAiRecording,
} from './demo-ai'
import recorded from './demo-ai-answers.json'
import recordedScrum from './demo-ai-answers-scrum.json'

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
        /\b\d{4}-\d\d-\d\d\b|\b\d{1,2} (?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b \d{1,2}\b/,
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

describe("the Scrum demo's recorded Steerloom AI answers", () => {
  const scrum = recordedScrum as DemoAiRecording
  const HOUR = 3_600_000

  it('answer every Sprint tab question, recorded on today’s Scrum board', () => {
    const boardNow = new Date(scrum.boardNow)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(boardNow)
    const { context, questions } = demoAiSetup(boardNow, 'scrum')
    vi.useRealTimers()
    // A changed demo team, Sprint tab question or AI context needs a new
    // recording: npm run ai:demo-record -- scrum
    expect(contextFingerprint(context)).toBe(scrum.fingerprint)
    expect(questions.length).toBeGreaterThanOrEqual(6)
    for (const question of questions)
      expect(
        recordedAnswer(scrum, question.question),
        question.label,
      ).toBeDefined()
  })

  it('ask the same questions at any day and hour: the sprint is pinned to today', () => {
    const start = Date.parse(scrum.boardNow)
    const first = demoAiSetup(new Date(start), 'scrum').questions
    for (let hours = 5; hours < 24 * 8; hours += 7)
      expect(
        demoAiSetup(new Date(start + hours * HOUR), 'scrum').questions,
      ).toEqual(first)
  })

  it('name no dates and no weekdays, which would go stale', () => {
    for (const answer of scrum.answers) {
      const text = `${answer.message} ${JSON.stringify(answer.card ?? {})}`
      expect(text, answer.label).not.toMatch(
        /\b\d{4}-\d\d-\d\d\b|\b\d{1,2} (?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b \d{1,2}\b|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/,
      )
      expect(text, answer.label).not.toMatch(/stand-?up/i)
    }
  })
})
