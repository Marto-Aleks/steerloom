import type { FlowBoardSnapshot } from '../../types'

/**
 * Where an item key opens. Items on the board carry their own link; keys the
 * AI mentions that are not on the board (a parent, a linked issue, an item
 * from a lookup) get one built the same way, from the shape of the links the
 * board already has: Jira …/browse/KEY and Azure …/_workitems/edit/ID. Trello
 * card links cannot be built from a key, so only known cards link there.
 */
export function itemLinkResolver(
  snapshot: Pick<FlowBoardSnapshot, 'issues'>,
): (key: string) => string | undefined {
  const known = new Map<string, string>()
  let jiraBase = ''
  let azureBase = ''
  for (const issue of snapshot.issues) {
    const url = issue.browseUrl
    if (!url?.startsWith('https://')) continue
    known.set(issue.key.trim().toUpperCase(), url)
    if (!jiraBase) {
      const browse = /^(https:\/\/[^?#]*\/browse\/)[^/?#]+$/.exec(url)
      if (browse) jiraBase = browse[1]!
    }
    if (!azureBase) {
      const edit = /^(https:\/\/[^?#]*\/_workitems\/edit\/)\d+$/.exec(url)
      if (edit) azureBase = edit[1]!
    }
  }
  return (key) => {
    const trimmed = key.trim()
    const found = known.get(trimmed.toUpperCase())
    if (found) return found
    if (jiraBase && /^[A-Z][A-Z0-9_]{1,29}-\d{1,7}$/i.test(trimmed))
      return `${jiraBase}${encodeURIComponent(trimmed.toUpperCase())}`
    if (azureBase && /^#\d{1,9}$/.test(trimmed))
      return `${azureBase}${trimmed.slice(1)}`
    return undefined
  }
}

/** At most this many keys go into one tracker search link. */
const LIST_LINK_LIMIT = 200

/**
 * One link that opens a set of items in their tracker: a Jira search
 * (…/issues/?jql=key in (…)) or an Azure DevOps query (…/_queries/query/?wiql=…),
 * built from the shape of the items' own links. Trello has no such search.
 */
export function itemListLink(
  items: Array<{ item: string; browseUrl?: string }>,
): { href: string; tracker: 'Jira' | 'Azure DevOps'; count: number } | null {
  const sample = items.find((item) => item.browseUrl?.startsWith('https://'))
  if (!sample?.browseUrl) return null
  const keys = items.slice(0, LIST_LINK_LIMIT).map((item) => item.item.trim())
  const jira = /^(https:\/\/[^?#]*)\/browse\/[^/?#]+$/.exec(sample.browseUrl)
  if (jira) {
    const jql = `key in (${keys.map((key) => `"${key.replace(/"/g, '')}"`).join(', ')})`
    return {
      href: `${jira[1]}/issues/?jql=${encodeURIComponent(jql)}`,
      tracker: 'Jira',
      count: keys.length,
    }
  }
  const azure = /^(https:\/\/[^?#]*)\/_workitems\/edit\/\d+$/.exec(
    sample.browseUrl,
  )
  if (azure) {
    const ids = keys
      .map((key) => key.replace(/^#/, ''))
      .filter((id) => /^\d+$/.test(id))
    if (!ids.length) return null
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (${ids.join(', ')})`
    return {
      href: `${azure[1]}/_queries/query/?wiql=${encodeURIComponent(wiql)}`,
      tracker: 'Azure DevOps',
      count: ids.length,
    }
  }
  return null
}
