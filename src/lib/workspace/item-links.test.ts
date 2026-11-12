import { expect, it } from 'vitest'
import { itemLinkResolver, itemListLink } from './item-links'

const issue = (key: string, browseUrl?: string) => ({
  id: key,
  key,
  issueTypeId: '1',
  issueTypeName: 'Story',
  createdAt: '2026-01-01T00:00:00Z',
  ...(browseUrl ? { browseUrl } : {}),
})

it('links known items and builds Jira links for keys the board has not loaded', () => {
  const link = itemLinkResolver({
    issues: [
      issue('ABC-1', 'https://jira.example.invalid/tracker/browse/ABC-1'),
    ],
  })
  expect(link('ABC-1')).toBe(
    'https://jira.example.invalid/tracker/browse/ABC-1',
  )
  expect(link('abc-1')).toBe(
    'https://jira.example.invalid/tracker/browse/ABC-1',
  )
  expect(link('XYZ-42')).toBe(
    'https://jira.example.invalid/tracker/browse/XYZ-42',
  )
  expect(link('#42')).toBeUndefined()
  expect(link('not a key')).toBeUndefined()
})

it('builds Azure DevOps links from the work item address', () => {
  const link = itemLinkResolver({
    issues: [
      issue('#7', 'https://dev.azure.com/contoso/Web/_workitems/edit/7'),
    ],
  })
  expect(link('#99')).toBe(
    'https://dev.azure.com/contoso/Web/_workitems/edit/99',
  )
  expect(link('ABC-1')).toBeUndefined()
})

it('never invents links without a board link to copy, or from plain http', () => {
  expect(
    itemLinkResolver({ issues: [issue('ABC-1')] })('ABC-2'),
  ).toBeUndefined()
  expect(
    itemLinkResolver({
      issues: [issue('ABC-1', 'http://jira.example.invalid/browse/ABC-1')],
    })('ABC-1'),
  ).toBeUndefined()
})

it('builds one tracker link for a set of items', () => {
  expect(
    itemListLink([
      { item: 'ABC-1', browseUrl: 'https://jira.example.invalid/browse/ABC-1' },
      { item: 'ABC-2' },
    ]),
  ).toEqual({
    href: `https://jira.example.invalid/issues/?jql=${encodeURIComponent('key in ("ABC-1", "ABC-2")')}`,
    tracker: 'Jira',
    count: 2,
  })
  expect(
    itemListLink([
      {
        item: '#7',
        browseUrl: 'https://dev.azure.com/contoso/Web/_workitems/edit/7',
      },
      { item: '#9' },
    ]),
  ).toEqual({
    href: `https://dev.azure.com/contoso/Web/_queries/query/?wiql=${encodeURIComponent('SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (7, 9)')}`,
    tracker: 'Azure DevOps',
    count: 2,
  })
  expect(
    itemListLink([{ item: 'CARD-1', browseUrl: 'https://trello.com/c/x' }]),
  ).toBeNull()
  expect(itemListLink([{ item: 'ABC-1' }])).toBeNull()
})
