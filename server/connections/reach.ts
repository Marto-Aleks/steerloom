import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { fetch, type Dispatcher } from 'undici'
import { publicAddress, publicJiraDispatcher } from '../hosted/public-network'
import { JIRA_HEADERS } from '../jira/jira-client'

/**
 * Whether the hosted site can reach a pasted board address, checked before
 * anyone looks for a token. No credentials are sent: one request to an
 * endpoint only the product itself answers, and only to public addresses.
 * An address that is private, unknown on the internet, silent from here, or
 * that answers with a company sign-in page instead of the product (a public
 * gateway in front of an internal Jira) is reported as inside a company
 * network, without ever connecting to a private address.
 */
export type Reach = 'reachable' | 'company-network'
export type ReachProduct = 'jira' | 'azure-devops'

/** Anonymous endpoints that answer even when access needs a sign-in. */
const PROBE: Record<ReachProduct, string> = {
  jira: '/rest/api/2/serverInfo',
  'azure-devops': '/_apis/connectionData',
}

/**
 * The product answered, not a gateway's sign-in page: its own headers, or
 * data rather than a web page (an API gateway refusing without a key still
 * answers with data, and is handled at connect time).
 */
export function productAnswered(
  status: number,
  headers: Headers,
  product: ReachProduct,
): boolean {
  if (status >= 300 && status < 400) return false
  if (product === 'jira' && JIRA_HEADERS.some((name) => headers.has(name)))
    return true
  if (
    product === 'azure-devops' &&
    [...headers.keys()].some((name) => /^x-(tfs|vss)-/i.test(name))
  )
    return true
  return /json/i.test(headers.get('content-type') ?? '')
}

export interface ReachDependencies {
  lookup?: (host: string) => Promise<Array<{ address: string }>>
  request?: (
    url: URL,
    dispatcher: Dispatcher,
  ) => Promise<{ status: number; headers: Headers }>
}

const TIMEOUT_MS = 6000
/** One connection pool for every check, not one per request. */
let shared: Dispatcher | undefined

export async function checkReach(
  link: string,
  product: ReachProduct,
  {
    lookup = (host) => dnsLookup(host, { all: true, verbatim: true }),
    request = (url, dispatcher) =>
      fetch(url, {
        method: 'GET',
        redirect: 'manual',
        dispatcher,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).then(async (response) => {
        await response.body?.cancel()
        return {
          status: response.status,
          headers: response.headers as unknown as Headers,
        }
      }),
  }: ReachDependencies = {},
): Promise<Reach> {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    throw new Error('Paste a full link, starting with https://')
  }
  // Only the public web on its standard port: the hosted site can connect
  // to nothing else, so the check must not probe anything else either.
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password
  )
    throw new Error('Paste the https:// address of your board.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  let addresses: string[]
  if (isIP(host)) addresses = [host]
  else {
    try {
      addresses = (await lookup(host)).map((item) => item.address)
    } catch {
      // Names that exist only on a company's own DNS are unknown out here.
      return 'company-network'
    }
  }
  if (!addresses.length || addresses.some((address) => !publicAddress(address)))
    return 'company-network'
  const root = url
    .toString()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
  try {
    const answer = await request(
      new URL(`${root}${PROBE[product]}`),
      (shared ??= publicJiraDispatcher()),
    )
    return productAnswered(answer.status, answer.headers, product)
      ? 'reachable'
      : 'company-network'
  } catch {
    // Public names that only answer company addresses stay silent.
    return 'company-network'
  }
}
