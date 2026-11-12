// The URL chooses a workspace, never an identity or permission. The server
// verifies membership on every request. No hosted request falls back to local.
export function workspaceRequestPath(
  path: string,
  search = typeof window === 'undefined' ? '' : window.location.search,
): string {
  const params = new URLSearchParams(search)
  const id = params.get('workspace')
  if (params.get('hosted') !== '1' || !id || path.startsWith('/api/hosted/'))
    return path
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  )
    throw new Error('Choose a valid workspace.')
  const prefix = `/api/hosted/workspaces/${id}`
  if (path === '/api/auth/logout') return '/api/hosted/auth/logout'
  if (path === '/api/auth/session') return `${prefix}/session`
  if (path === '/api/auth/providers') return `${prefix}/providers`
  if (path === '/api/auth/atlassian/start') return `${prefix}/atlassian/start`
  if (path.startsWith('/api/workspace/'))
    return `${prefix}${path.slice('/api/workspace'.length)}`
  if (path.startsWith('/api/jira/') || path.startsWith('/api/ai/'))
    return `${prefix}${path.slice('/api'.length)}`
  if (path.startsWith('/api/')) return `${prefix}/unsupported`
  return path
}
