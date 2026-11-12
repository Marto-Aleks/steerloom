import { afterEach, describe, expect, it, vi } from 'vitest'
import { JiraClient } from '../jira/jira-client'
import { TrelloClient } from '../trello/client'
import { AzureDevOpsClient } from '../azure-devops/client'
import {
  boardReader,
  forgetBoards,
  jiraConnection,
  readBoards,
  verifyNewConnection,
  type ConnectionRuntime,
} from '.'

const runtime: ConnectionRuntime = {
  proxyUrl: '',
  accessToken: async (id) => `fictional-access-${id}`,
}
const signal = new AbortController().signal
afterEach(() => vi.restoreAllMocks())

describe('new connections', () => {
  it('verifies Data Center access using the project from the pasted link', async () => {
    const boards = vi
      .spyOn(JiraClient.prototype, 'listBoards')
      .mockResolvedValue([])
    const secret = await verifyNewConnection(
      {
        provider: 'jira',
        name: ' Fictional Jira ',
        baseUrl: 'https://jira.example.invalid/projects/DEMO/summary',
        token: 'fictional-pat',
        apiKey: ' ',
      },
      runtime,
      signal,
    )
    expect(boards).toHaveBeenCalledWith('DEMO', signal)
    expect(secret).toEqual({
      provider: 'jira',
      jiraEdition: 'data-center',
      name: 'Fictional Jira',
      baseUrl: 'https://jira.example.invalid',
      projectKey: 'DEMO',
      token: 'fictional-pat',
    })
  })

  it('verifies Azure DevOps access with the project from the pasted board link', async () => {
    const verify = vi
      .spyOn(AzureDevOpsClient.prototype, 'verify')
      .mockResolvedValue('Web App')
    const secret = await verifyNewConnection(
      {
        provider: 'azure-devops',
        name: 'Fictional Boards',
        baseUrl:
          'https://dev.azure.com/contoso/web%20app/_boards/board/t/Checkout/Stories',
        token: 'fictional-pat',
      },
      runtime,
      signal,
    )
    expect(verify).toHaveBeenCalledWith(signal)
    // The project name is stored as Azure DevOps spells it.
    expect(secret).toEqual({
      provider: 'azure-devops',
      name: 'Fictional Boards',
      baseUrl: 'https://dev.azure.com/contoso',
      project: 'Web App',
      token: 'fictional-pat',
    })
  })

  it('asks for the Azure DevOps project when the link has none', async () => {
    const verify = vi.spyOn(AzureDevOpsClient.prototype, 'verify')
    await expect(
      verifyNewConnection(
        {
          provider: 'azure-devops',
          name: 'X',
          baseUrl: 'https://dev.azure.com/contoso',
          token: 'fictional-pat',
        },
        runtime,
      ),
    ).rejects.toThrow('Paste a link that includes the project')
    expect(verify).not.toHaveBeenCalled()
  })

  it('rejects unsafe or incomplete input before contacting a provider', async () => {
    const jira = vi.spyOn(JiraClient.prototype, 'listBoards')
    const trello = vi.spyOn(TrelloClient.prototype, 'boards')
    const base = {
      provider: 'jira',
      name: 'Fictional',
      baseUrl: 'https://jira.example.invalid/projects/DEMO',
      token: 'fictional-pat',
    }
    await expect(
      verifyNewConnection(
        { ...base, baseUrl: 'https://fictional.atlassian.net/browse/DEMO-1' },
        runtime,
      ),
    ).rejects.toThrow('Connect with Atlassian')
    await expect(
      verifyNewConnection({ ...base, token: 'a\r\nX-Injected: 1' }, runtime),
    ).rejects.toThrow('Invalid Jira credentials.')
    await expect(
      verifyNewConnection({ ...base, localId: 'machine' }, runtime),
    ).rejects.toThrow('Jira link and token')
    await expect(
      verifyNewConnection({ ...base, name: '' }, runtime),
    ).rejects.toThrow('Complete the required connection fields.')
    await expect(
      verifyNewConnection(
        { provider: 'trello', name: 'Board', apiKey: 'key!', token: 'tok' },
        runtime,
      ),
    ).rejects.toThrow('Trello API key')
    await expect(
      verifyNewConnection({ provider: 'other', name: 'X' }, runtime),
    ).rejects.toThrow('Choose Jira, Trello or Azure DevOps.')
    expect(jira).not.toHaveBeenCalled()
    expect(trello).not.toHaveBeenCalled()
  })
})

describe('saved Jira connections', () => {
  const dataCenter = {
    provider: 'jira' as const,
    name: 'Fictional',
    baseUrl: 'https://jira.example.invalid',
    projectKey: 'DEMO',
    token: 'fictional-pat',
  }

  it('routes Cloud through its OAuth token and validates the cloud ID', async () => {
    const cloud = jiraConnection(
      'c1',
      {
        ...dataCenter,
        jiraEdition: 'cloud',
        cloudId: 'fictional-cloud',
        token: 'stored-access',
      },
      runtime,
    )
    expect(cloud).toMatchObject({
      cloud: true,
      baseUrl: 'https://api.atlassian.com/ex/jira/fictional-cloud',
      pat: '',
      projectKeys: ['DEMO'],
    })
    expect(await cloud.accessToken!()).toBe('fictional-access-c1')
    expect(() =>
      jiraConnection(
        'c1',
        { ...dataCenter, jiraEdition: 'cloud', cloudId: '../x' },
        runtime,
      ),
    ).toThrow('Reconnect Jira Cloud.')
  })

  it('refuses legacy machine connections and private hosts when hosted', () => {
    expect(() =>
      jiraConnection('j1', { ...dataCenter, localId: 'machine' }, runtime),
    ).toThrow('removed machine configuration')
    expect(() =>
      jiraConnection(
        'j1',
        { ...dataCenter, baseUrl: 'https://127.0.0.1' },
        { ...runtime, requirePublicJira: true },
      ),
    ).toThrow()
    expect(
      jiraConnection(
        'j1',
        { ...dataCenter, baseUrl: 'https://127.0.0.1' },
        runtime,
      ).baseUrl,
    ).toBe('https://127.0.0.1')
  })

  it('keeps the assistant’s board reads inside the connection scope', () => {
    expect(() =>
      boardReader(
        'j1',
        dataCenter,
        { connectionId: 'j1', projectKey: 'OTHER' },
        runtime,
      ),
    ).toThrow('outside this connection')
    expect(() =>
      boardReader(
        'j1',
        dataCenter,
        {
          provider: 'trello',
          connectionId: 'j1',
          projectKey: 'CARD',
          boardId: 'b',
        },
        runtime,
      ),
    ).toThrow('Invalid Trello investigation scope.')
    expect(() =>
      boardReader(
        'j1',
        dataCenter,
        {
          provider: 'azure-devops',
          connectionId: 'j1',
          projectKey: 'ADO',
          boardId: '00000000-0000-0000-0000-000000000000',
        },
        runtime,
      ),
    ).toThrow('Invalid Azure DevOps investigation scope.')
  })
})

describe('recent boards', () => {
  it('serves a board loaded minutes ago from memory, unless asked to refresh', async () => {
    const load = vi
      .spyOn(JiraClient.prototype, 'loadBoard')
      .mockResolvedValue({ board: { id: '7' } } as never)
    const secret = {
      provider: 'jira' as const,
      jiraEdition: 'data-center' as const,
      name: 'Fictional',
      baseUrl: 'https://jira.example.invalid',
      projectKey: 'DEMO',
      token: 'fictional-pat',
    }
    const id = `conn-${Math.random()}`
    const steps: string[] = []
    const first = await readBoards(id, secret, runtime, '7', signal, (event) =>
      steps.push(event.step),
    )
    const again = await readBoards(id, secret, runtime, '7', signal, (event) =>
      steps.push(event.step),
    )
    expect(load).toHaveBeenCalledTimes(1)
    expect(again).toEqual(first)
    // The second answer still ends the progress so the browser moves on.
    expect(steps.at(-1)).toBe('done')
    await readBoards(id, secret, runtime, '7', signal, undefined, true)
    expect(load).toHaveBeenCalledTimes(2)
    forgetBoards(id)
    await readBoards(id, secret, runtime, '7', signal)
    expect(load).toHaveBeenCalledTimes(3)
  })
})
