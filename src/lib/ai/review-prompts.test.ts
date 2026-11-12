import { describe, expect, it } from 'vitest'
import { demoSnapshot } from '../workspace/demo'
import { collectAgingWork } from '../statistics/aging-work'
import { AI_USER_MESSAGE_CHAR_LIMIT } from './conversation'
import {
  selectedWorkPrompt,
  standupPrompt,
  periodSummaryPrompt,
} from './review-prompts'

const items = collectAgingWork(demoSnapshot(), ['stage-1', 'stage-2'])
describe('guided review evidence', () => {
  it('includes only selected items and never sends histories or source URLs in the draft', () => {
    const prompt = selectedWorkPrompt(items.slice(0, 2), 10)
    expect(prompt).toContain(items[0]!.item)
    expect(prompt).toContain(items[1]!.item)
    expect(prompt).not.toContain(items[2]!.item)
    expect(prompt).toContain('2 of 2 items supplied')
    expect(prompt).toContain('10 days')
    expect(prompt).not.toMatch(/browseUrl|enteredAt/)
  })
  it('caps review drafts within chat limits even with long escaped source names', () => {
    const oversized = items.map((item) => ({
      ...item,
      column: '"\\'.repeat(300),
      currentStatus: '"\\'.repeat(300),
    }))
    for (const prompt of [
      selectedWorkPrompt(oversized, null),
      standupPrompt(oversized, null),
      periodSummaryPrompt,
    ]) {
      expect(prompt.length).toBeLessThanOrEqual(AI_USER_MESSAGE_CHAR_LIMIT)
    }
    expect(selectedWorkPrompt(oversized, null)).toContain(
      '5 of 7 items supplied',
    )
    expect(selectedWorkPrompt(oversized, null)).toContain('P85: unavailable')
  })
  it('samples the oldest items for stand-up and explains empty scope without an all-clear claim', () => {
    const prompt = standupPrompt([...items].reverse(), 7)
    expect(prompt.indexOf(items[0]!.item)).toBeLessThan(
      prompt.indexOf(items[1]!.item),
    )
    expect(prompt).toContain('7 active items')
    expect(prompt).not.toContain(items[6]!.item)
    expect(standupPrompt([], null)).toContain('No active items were observed')
  })
})
