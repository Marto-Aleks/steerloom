/**
 * Reads any Azure Boards link people paste: an organisation, project, board,
 * backlog or work item link. Shared by the connect form and the server, so
 * both resolve the same organisation, project and team.
 *
 *   https://dev.azure.com/{org}/{project}/_boards/board/t/{team}/Stories
 *   https://{org}.visualstudio.com/{project}/_workitems/edit/123
 *   https://tfs.company.com/tfs/{collection}/{project}/...   (Azure DevOps Server)
 */
export interface AzureDevOpsLink {
  /** Organisation (cloud) or collection (Server) URL: the API root. */
  orgUrl: string
  edition: 'cloud' | 'server'
  project?: string
  team?: string
}

const CLOUD_HOST = 'dev.azure.com'

export function isAzureDevOpsCloudHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === CLOUD_HOST || host.endsWith('.visualstudio.com')
}

/** Recognises Azure DevOps cloud links, so the connect form can suggest the provider. */
export function looksLikeAzureDevOps(value: string): boolean {
  try {
    return isAzureDevOpsCloudHost(new URL(value.trim()).hostname)
  } catch {
    return false
  }
}

function segment(value: string | undefined): string | undefined {
  if (!value || value.startsWith('_')) return undefined
  try {
    const decoded = decodeURIComponent(value).trim()
    return decoded && decoded.length <= 128 ? decoded : undefined
  } catch {
    return undefined
  }
}

export function parseAzureDevOpsUrl(value: string): AzureDevOpsLink {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(
      'Paste a link from your Azure DevOps, starting with https://',
    )
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error(
      'Paste a link from your Azure DevOps, starting with https://',
    )
  if (url.username || url.password)
    throw new Error('Remove the user name or password from the link.')
  const parts = url.pathname.split('/').filter(Boolean)
  const host = url.hostname.toLowerCase()
  let rootParts: string[]
  let rest: string[]
  if (host === CLOUD_HOST) {
    // dev.azure.com/{org}/{project}/...
    if (!segment(parts[0]))
      throw new Error(
        'Include your organisation in the link, like https://dev.azure.com/your-org',
      )
    rootParts = parts.slice(0, 1)
    rest = parts.slice(1)
  } else if (host.endsWith('.visualstudio.com')) {
    // {org}.visualstudio.com[/DefaultCollection]/{project}/...
    const collection = parts[0]?.toLowerCase() === 'defaultcollection'
    rootParts = collection ? parts.slice(0, 1) : []
    rest = parts.slice(rootParts.length)
  } else {
    // Azure DevOps Server: [/tfs]/{collection}/{project}/...
    const tfs = parts[0]?.toLowerCase() === 'tfs'
    const collection = parts[tfs ? 1 : 0]
    if (!segment(collection))
      throw new Error(
        'Include the collection in the link, like https://server/tfs/DefaultCollection/Project',
      )
    rootParts = parts.slice(0, tfs ? 2 : 1)
    rest = parts.slice(rootParts.length)
  }
  const orgUrl = `${url.protocol}//${url.host}${rootParts.map((part) => `/${part}`).join('')}`
  const project = segment(rest[0])
  // Team boards: /_boards/board/t/{team}/..., backlogs: /_backlogs/backlog/{team}/...
  const boards = rest.indexOf('_boards')
  const backlogs = rest.indexOf('_backlogs')
  const team =
    boards >= 0 && rest[boards + 1] === 'board' && rest[boards + 2] === 't'
      ? segment(rest[boards + 3])
      : backlogs >= 0 && rest[backlogs + 1] === 'backlog'
        ? segment(rest[backlogs + 2])
        : undefined
  return {
    orgUrl,
    edition: isAzureDevOpsCloudHost(host) ? 'cloud' : 'server',
    ...(project ? { project } : {}),
    ...(project && team ? { team } : {}),
  }
}
