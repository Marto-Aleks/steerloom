import { lookup } from 'node:dns'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { Agent } from 'undici'

const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4')
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) return !blocked.check(address, 'ipv4')
  // Global unicast only; exclude transition/documentation address blocks.
  return (
    isIP(address) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^200[12]:/i.test(address)
  )
}
export function publicJiraUrl(value: string) {
  const url = new URL(value)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (isIP(host) && !publicAddress(host))
  )
    throw new Error(
      'Hosted Jira connections require a public HTTPS address. Private company Jira needs a separate network setup.',
    )
  return url
}
// Validate the actual addresses used by the socket, not an earlier DNS check.
// Redirects remain disabled by the Jira client. Private networks are never reached.
const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, '', 4)
      return
    }
    if (
      !addresses.length ||
      addresses.some((item) => !publicAddress(item.address))
    ) {
      callback(
        new Error(
          'Private Jira addresses are unavailable from this hosted installation.',
        ),
        '',
        4,
      )
      return
    }
    const family = typeof options.family === 'number' ? options.family : 0
    const matching = family
      ? addresses.filter((item) => item.family === family)
      : addresses
    if (!matching.length) {
      callback(new Error('No usable public address.'), '', 4)
      return
    }
    if (options.all) callback(null, matching)
    else callback(null, matching[0]!.address, matching[0]!.family)
  })
}
export function publicJiraDispatcher() {
  return new Agent({ connect: { lookup: publicLookup } })
}
