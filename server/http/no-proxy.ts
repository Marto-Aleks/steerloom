/**
 * Whether NO_PROXY says to reach this address directly, read the way curl
 * and undici read it: "*" for everything, a host and its subdomains
 * ("jira.example.com", ".example.com", "*.example.com"), an optional port,
 * and "10.*" style address prefixes as Windows writes them.
 */
export function bypassesProxy(
  target: string,
  noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? '',
): boolean {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const port = url.port || (url.protocol === 'http:' ? '80' : '443')
  return noProxy
    .split(/[,\s]+/)
    .filter(Boolean)
    .some((raw) => {
      if (raw === '*') return true
      const [entry = '', entryPort] = raw.toLowerCase().split(/:(?=\d+$)/)
      if (entryPort && entryPort !== port) return false
      if (entry.endsWith('.*')) return host.startsWith(entry.slice(0, -1))
      const name = entry.replace(/^\*?\./, '')
      return host === name || host.endsWith(`.${name}`)
    })
}
