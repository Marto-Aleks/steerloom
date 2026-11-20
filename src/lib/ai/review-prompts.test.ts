import { describe, expect, it } from 'vitest'
import { demoSnapshot } from '../workspace/demo'
import { collectAgingWork } from '../statistics/aging-work'
import { AI_USER_MESSAGE_CHAR_LIMIT } from './conversation'
import {
  periodSummaryPrompt,
  raiseTodayPrompt,
  selectedWorkPrompt,
} from './review-prompts'

const items = collectAgingWork(demoSnapshot(), ['stage-1', 'stage-2'])
describe('the briefing’s questions for Steerloom AI', () => {
  it('asks about the selected items by key, in a sentence', () => {
    const prompt = selectedWorkPrompt(items.slice(0, 2))
    expect(prompt).toBe(
      `Why are ${items[0]!.item} and ${items[1]!.item} taking so long, and what should happen next?`,
    )
    expect(selectedWorkPrompt(items.slice(0, 1))).toBe(
      `Why is ${items[0]!.item} taking so long, and what should happen next?`,
    )
    // No data in the question: ages and stages travel with the briefing.
    expect(prompt).not.toMatch(/[{[]|ageDays|browseUrl|enteredAt/)
  })
  it('names five items at most and counts the rest, however long the keys', () => {
    const oversized = Array.from({ length: 12 }, (_, index) => ({
      ...items[0]!,
      item: `VERY-LONG-SOURCE-IDENTIFIER-${'X'.repeat(60)}-${index}`,
    }))
    const prompt = selectedWorkPrompt(oversized)
    expect(prompt.length).toBeLessThan(700)
    expect(prompt.length).toBeLessThan(AI_USER_MESSAGE_CHAR_LIMIT)
    expect(prompt).toContain('(and 7 more selected)')
  })
  it('asks what to raise today without assuming a meeting', () => {
    expect(raiseTodayPrompt).toBe('What should the team raise today?')
    expect(raiseTodayPrompt).not.toMatch(/stand-?up/i)
  })
  it('keeps the period summary a bounded draft', () => {
    expect(periodSummaryPrompt.length).toBeLessThan(AI_USER_MESSAGE_CHAR_LIMIT)
    expect(periodSummaryPrompt).toContain('at most 150 words')
  })
})
