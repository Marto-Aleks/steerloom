import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AnswerCard } from './AnswerCard'

afterEach(cleanup)

it('names a single item once: in the verdict, not on every reason', () => {
  render(
    <AnswerCard
      card={{
        verdict: '**FICT-12** is stuck in rework.',
        confidence: 'likely',
        basis: 'GitHub and Jira agree',
        sources: ['GitHub', 'Jira'],
        reasons: [
          {
            kind: 'supports',
            source: 'GitHub',
            keys: ['FICT-12'],
            fact: 'Changes requested; quiet 16 days.',
          },
          {
            kind: 'supports',
            source: 'Jira',
            keys: ['FICT-12'],
            fact: 'Reopened on 9 Oct.',
          },
        ],
        next: 'Ask the assignee whether the changes still apply.',
      }}
    />,
  )
  expect(screen.getByText('Likely · GitHub + Jira')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Show reasoning/ }))
  expect(screen.getAllByText('FICT-12')).toHaveLength(1)
})
