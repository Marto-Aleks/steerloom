import { describe, expect, it } from 'vitest'
import { parseJiraConnectionUrl } from './jira-url'

describe('Jira link setup', () => {
  it('extracts instance prefixes and project keys without forwarding UI paths', () => {
    expect(
      parseJiraConnectionUrl(
        'https://jira.example.invalid/instance/projects/DEMO/summary?selectedItem=board',
      ),
    ).toEqual({
      baseUrl: 'https://jira.example.invalid/instance',
      edition: 'data-center',
      projectKey: 'DEMO',
    })
    expect(
      parseJiraConnectionUrl(
        'https://jira.example.invalid/browse/DEMO-12#comments',
      ),
    ).toEqual({
      baseUrl: 'https://jira.example.invalid',
      edition: 'data-center',
      projectKey: 'DEMO',
    })
    expect(
      parseJiraConnectionUrl(
        'https://jira.example.invalid/jira/secure/RapidBoard.jspa?rapidView=12&projectKey=DEMO',
      ),
    ).toEqual({
      boardId: '12',
      baseUrl: 'https://jira.example.invalid/jira',
      edition: 'data-center',
      projectKey: 'DEMO',
    })
    expect(
      parseJiraConnectionUrl('https://jira.example.invalid/custom/').baseUrl,
    ).toBe('https://jira.example.invalid/custom')
  })
  it('identifies Cloud without mistaking its UI routes for an instance prefix', () => {
    expect(
      parseJiraConnectionUrl(
        'https://fictional.atlassian.net/jira/software/c/projects/DEMO/boards/12',
      ),
    ).toEqual({
      boardId: '12',
      baseUrl: 'https://fictional.atlassian.net',
      edition: 'cloud',
      projectKey: 'DEMO',
    })
    expect(
      parseJiraConnectionUrl('https://atlassian.net.example.invalid/').edition,
    ).toBe('data-center')
  })
  it('rejects unsafe or incomplete links and ignores non-project query parameters', () => {
    for (const link of [
      'not a link',
      'http://jira.example.invalid',
      'https://person:secret@jira.example.invalid',
      'https://127.0.0.1',
      'https://jira.local',
    ])
      expect(() => parseJiraConnectionUrl(link)).toThrow()
    expect(
      parseJiraConnectionUrl(
        'https://jira.example.invalid/secure/RapidBoard.jspa?projectKey=invalid-key',
      ).projectKey,
    ).toBeUndefined()
  })
})
