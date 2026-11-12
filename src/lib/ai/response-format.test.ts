import { describe, expect, it } from 'vitest'
import { formatAiResponse } from './response-format'

describe('AI response formatting', () => {
  it('turns approved section labels and bullets into structured blocks', () => {
    expect(
      formatAiResponse(`Bottom line:
Delayed WIP is the immediate risk.

Evidence:
- DEMO-12 is 24 days old.
- Throughput fell to 2 per week.

Recommendation:
Review DEMO-12 before pulling new work.`),
    ).toEqual([
      { type: 'heading', text: 'Bottom line' },
      { type: 'paragraph', text: 'Delayed WIP is the immediate risk.' },
      { type: 'heading', text: 'Evidence' },
      {
        type: 'list',
        items: ['DEMO-12 is 24 days old.', 'Throughput fell to 2 per week.'],
      },
      { type: 'heading', text: 'Recommendation' },
      {
        type: 'paragraph',
        text: 'Review DEMO-12 before pulling new work.',
      },
    ])
  })

  it('preserves an ordinary conversational reply as paragraphs', () => {
    expect(
      formatAiResponse('The report is stable.\nReview it again next week.'),
    ).toEqual([
      {
        type: 'paragraph',
        text: 'The report is stable. Review it again next week.',
      },
    ])
  })

  it('supports optional conversational labels without requiring them', () => {
    expect(
      formatAiResponse(
        'Options:\n- Inspect the oldest tickets.\n- Compare ownership.\n\nNext step: Choose the question that would change your decision.',
      ),
    ).toEqual([
      { type: 'heading', text: 'Options' },
      {
        type: 'list',
        items: ['Inspect the oldest tickets.', 'Compare ownership.'],
      },
      { type: 'heading', text: 'Next step' },
      {
        type: 'paragraph',
        text: 'Choose the question that would change your decision.',
      },
    ])
  })

  it('separates a section label when the model puts content on the same line', () => {
    expect(
      formatAiResponse(
        'Bottom line: DEMO-12 needs attention.\n\nRecommendation: Review its evidence.',
      ),
    ).toEqual([
      { type: 'heading', text: 'Bottom line' },
      { type: 'paragraph', text: 'DEMO-12 needs attention.' },
      { type: 'heading', text: 'Recommendation' },
      { type: 'paragraph', text: 'Review its evidence.' },
    ])
  })
})
