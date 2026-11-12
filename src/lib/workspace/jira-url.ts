export interface JiraConnectionUrl {
  baseUrl: string
  edition: 'cloud' | 'data-center'
  boardId?: string
  projectKey?: string
}

// Shared browser/server parsing: never fetch a pasted project page or attach
// credentials until its instance root has been established.
export function parseJiraConnectionUrl(input: string): JiraConnectionUrl {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Paste a complete HTTPS link from your Jira site.')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !url.hostname.includes('.') ||
    url.hostname.endsWith('.local') ||
    /^[\d.]+$/.test(url.hostname)
  )
    throw new Error(
      'Use your HTTPS Jira site link without embedded credentials.',
    )
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    throw new Error('This Jira link contains invalid characters.')
  }
  const cloud = url.hostname.endsWith('.atlassian.net')
  const project =
    /\/projects\/([A-Za-z][A-Za-z0-9_]*)(?:\/|$)/i.exec(path)?.[1] ??
    /\/browse\/([A-Za-z][A-Za-z0-9_]*)-\d+(?:\/|$)/i.exec(path)?.[1] ??
    url.searchParams.get('projectKey') ??
    undefined
  const projectKey =
    project && /^[A-Za-z][A-Za-z0-9_]{1,29}$/.test(project)
      ? project.toUpperCase()
      : undefined
  const candidateBoard =
    /\/boards\/(\d+)(?:\/|$)/i.exec(path)?.[1] ??
    url.searchParams.get('rapidView')
  const boardId =
    candidateBoard && /^\d{1,12}$/.test(candidateBoard)
      ? candidateBoard
      : undefined
  const marker = /\/(?:projects|browse|secure|rest|plugins)(?:\/|$)/i.exec(path)
  // Jira Cloud's UI paths (/jira/software/...) aren't installation prefixes.
  url.pathname = cloud
    ? '/'
    : marker
      ? path.slice(0, marker.index) || '/'
      : path
  url.search = ''
  url.hash = ''
  return {
    baseUrl: url.href.replace(/\/$/, ''),
    edition: cloud ? 'cloud' : 'data-center',
    ...(boardId ? { boardId } : {}),
    ...(projectKey ? { projectKey } : {}),
  }
}
