import { expect, it } from 'vitest'
import { workspaceRequestPath } from './request-path'
const id = '20000000-0000-4000-8000-000000000001'
const search = `?hosted=1&workspace=${id}`
it('routes hosted session, board, Jira and AI requests to the selected workspace', () => {
  for (const [path, suffix] of [
    ['/api/auth/session', '/session'],
    ['/api/auth/providers', '/providers'],
    ['/api/auth/atlassian/start', '/atlassian/start'],
    ['/api/workspace/connections', '/connections'],
    ['/api/ai/chat', '/ai/chat'],
    [
      '/api/jira/connections/test/projects/DEMO/boards/1/overview',
      '/jira/connections/test/projects/DEMO/boards/1/overview',
    ],
  ])
    expect(workspaceRequestPath(path!, search)).toBe(
      `/api/hosted/workspaces/${id}${suffix}`,
    )
  expect(workspaceRequestPath('/api/auth/logout', search)).toBe(
    '/api/hosted/auth/logout',
  )
})
it('keeps local and account-setup routes unchanged and never falls back for unknown hosted routes', () => {
  expect(workspaceRequestPath('/api/auth/session', '')).toBe(
    '/api/auth/session',
  )
  expect(workspaceRequestPath('/api/hosted/session', search)).toBe(
    '/api/hosted/session',
  )
  expect(workspaceRequestPath('/api/auth/google/start', search)).toBe(
    `/api/hosted/workspaces/${id}/unsupported`,
  )
  expect(() =>
    workspaceRequestPath(
      '/api/workspace/connections',
      '?hosted=1&workspace=invalid',
    ),
  ).toThrow(/valid workspace/)
})
