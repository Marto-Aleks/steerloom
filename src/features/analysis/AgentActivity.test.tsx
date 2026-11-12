import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AgentActivity } from './AgentActivity'

afterEach(cleanup)

it('logs each read in one short line, and ends on what it does now', () => {
  render(
    <AgentActivity
      event={{
        type: 'progress',
        step: 'plan',
        label: 'Thinking',
        detail: '1 item · 1 code trail',
      }}
      history={[
        {
          type: 'progress',
          step: 'note',
          label: 'I will read the item first.',
        },
        {
          type: 'progress',
          step: 'jira',
          label:
            'Read FICT-12 in detail: description, comments, history and links',
          detail: 'Read-only · Jira',
        },
      ]}
    />,
  )
  const log = screen.getByRole('status')
  expect(log).toHaveTextContent('I will read the item first.')
  // One short line per read: the action and its source.
  expect(log).toHaveTextContent('Read FICT-12 in detail · Jira')
  expect(log).not.toHaveTextContent('description, comments')
  expect(log).toHaveTextContent('Thinking…')
  expect(log).toHaveTextContent('1 item · 1 code trail')
  // A log, not a checklist.
  expect(log.querySelector('svg')).toBeNull()
})
