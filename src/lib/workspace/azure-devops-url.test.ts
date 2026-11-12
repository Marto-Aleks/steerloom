import { describe, expect, it } from 'vitest'
import { looksLikeAzureDevOps, parseAzureDevOpsUrl } from './azure-devops-url'

describe('parseAzureDevOpsUrl', () => {
  it('reads organisation, project and team from a board link', () => {
    expect(
      parseAzureDevOpsUrl(
        'https://dev.azure.com/contoso/Fabrikam%20Web/_boards/board/t/Fabrikam%20Web%20Team/Stories',
      ),
    ).toEqual({
      orgUrl: 'https://dev.azure.com/contoso',
      edition: 'cloud',
      project: 'Fabrikam Web',
      team: 'Fabrikam Web Team',
    })
  })

  it('reads a work item link and an organisation-only link', () => {
    expect(
      parseAzureDevOpsUrl(
        'https://dev.azure.com/contoso/Web/_workitems/edit/42',
      ),
    ).toEqual({
      orgUrl: 'https://dev.azure.com/contoso',
      edition: 'cloud',
      project: 'Web',
    })
    expect(parseAzureDevOpsUrl('https://dev.azure.com/contoso/')).toEqual({
      orgUrl: 'https://dev.azure.com/contoso',
      edition: 'cloud',
    })
    // Settings pages are not projects.
    expect(
      parseAzureDevOpsUrl('https://dev.azure.com/contoso/_usersSettings/tokens')
        .project,
    ).toBeUndefined()
  })

  it('reads legacy visualstudio.com and backlog links', () => {
    expect(
      parseAzureDevOpsUrl(
        'https://contoso.visualstudio.com/DefaultCollection/Web/_backlogs/backlog/Web%20Team/Stories',
      ),
    ).toEqual({
      orgUrl: 'https://contoso.visualstudio.com/DefaultCollection',
      edition: 'cloud',
      project: 'Web',
      team: 'Web Team',
    })
  })

  it('reads Azure DevOps Server collections', () => {
    expect(
      parseAzureDevOpsUrl(
        'https://tfs.example.com/tfs/Main/Platform/_boards/board/t/Core/Backlog%20items',
      ),
    ).toEqual({
      orgUrl: 'https://tfs.example.com/tfs/Main',
      edition: 'server',
      project: 'Platform',
      team: 'Core',
    })
  })

  it('explains links it cannot use', () => {
    expect(() => parseAzureDevOpsUrl('dev.azure.com/contoso')).toThrow(
      /starting with https/,
    )
    expect(() => parseAzureDevOpsUrl('https://dev.azure.com/')).toThrow(
      /organisation/,
    )
  })

  it('recognises cloud links', () => {
    expect(looksLikeAzureDevOps('https://dev.azure.com/contoso')).toBe(true)
    expect(looksLikeAzureDevOps('https://jira.example.com')).toBe(false)
  })
})
