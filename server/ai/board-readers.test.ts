import { describe, expect, it, vi } from 'vitest'
import type { JiraClient } from '../jira/jira-client'
import { jiraSearchJql } from './board-reader'
import { jiraReader } from './board-readers'

/** A Jira client that answers only what the reader asks. */
function fakeClient(boards: string[], onBoard: string[]) {
  const aiItems = vi.fn(
    async (projects: string | readonly string[], keys: string[]) => ({
      items: [],
      unavailable: keys.filter(
        (key) =>
          !(typeof projects === 'string' ? [projects] : projects).some((p) =>
            key.startsWith(`${p}-`),
          ),
      ),
    }),
  )
  const aiSearch = vi.fn<
    (
      projects: string | readonly string[],
      query: unknown,
    ) => Promise<{
      items: never[]
      total: number
      more: boolean
    }>
  >(async () => ({ items: [], total: 0, more: false }))
  const client = {
    listBoards: vi.fn(async () =>
      boards.map((id) => ({ id, name: `Board ${id}`, type: 'scrum' })),
    ),
    boardProjects: vi.fn(async () => onBoard),
    aiItems,
    aiSearch,
  } as unknown as JiraClient
  return { client, aiItems, aiSearch }
}

describe('Steerloom AI reads every project on the report’s board', () => {
  it('searches the board’s projects together', () => {
    expect(jiraSearchJql(['WEB', 'KIT'], { text: 'grid' }, true)).toMatch(
      /^project in \("WEB", "KIT"\) AND text ~ "grid"/,
    )
    expect(jiraSearchJql('WEB', {}, true)).toMatch(/^project = "WEB"/)
  })

  it('reads items from the board’s other projects, never from elsewhere', async () => {
    const { client, aiItems, aiSearch } = fakeClient(['42'], ['WEB', 'KIT'])
    const reader = jiraReader(client, 'WEB', '42')
    expect(reader.normaliseKey('kit-31')).toBe('KIT-31')
    expect(reader.normaliseKey('12')).toBe('WEB-12')
    const result = await reader.items(['KIT-31', 'HR-7'], true)
    expect(aiItems).toHaveBeenCalledWith(
      ['WEB', 'KIT'],
      ['KIT-31', 'HR-7'],
      true,
      undefined,
    )
    expect(result.unavailable).toEqual(['HR-7'])
    await reader.search({ text: 'header' })
    expect(aiSearch.mock.calls[0]![0]).toEqual(['WEB', 'KIT'])
  })

  it('ignores a board that is not one of the connected project’s boards', async () => {
    const { client, aiItems } = fakeClient(['42'], ['WEB', 'HR'])
    const reader = jiraReader(client, 'WEB', '99')
    const result = await reader.items(['HR-7', 'WEB-1'], false)
    expect(aiItems.mock.calls[0]![0]).toEqual(['WEB'])
    expect(result.unavailable).toEqual(['HR-7'])
  })

  it('stays inside the connected project without a board', async () => {
    const { client, aiItems } = fakeClient(['42'], ['WEB', 'KIT'])
    await jiraReader(client, 'WEB').items(['KIT-1'], false)
    expect(aiItems.mock.calls[0]![0]).toEqual(['WEB'])
  })
})
