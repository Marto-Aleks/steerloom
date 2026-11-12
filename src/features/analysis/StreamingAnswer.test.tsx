import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { StreamingAnswer } from './StreamingAnswer'

afterEach(cleanup)

const plain = (text: string) => <p>{text}</p>

it('types a plain answer in as it arrives', () => {
  render(<StreamingAnswer text="FICT-12 waits on **design" plain={plain} />)
  // The open bold is closed, so no stray asterisks show.
  expect(screen.getByText('FICT-12 waits on **design**')).toBeInTheDocument()
})

it('shows a card’s verdict and next step first, and nothing unchecked', () => {
  render(
    <StreamingAnswer
      text='{"verdict":"**Rework went quiet**.","next":"Ask the assignee.","reasons":[{"fact":"Unread claim"'
      plain={plain}
    />,
  )
  expect(screen.getByText('Rework went quiet')).toBeInTheDocument()
  expect(screen.getByText('Ask the assignee.')).toBeInTheDocument()
  expect(screen.queryByText(/Unread claim/)).toBeNull()
})

it('shows nothing until the verdict has started', () => {
  const { container } = render(<StreamingAnswer text='{"verd' plain={plain} />)
  expect(container).toBeEmptyDOMElement()
})
