import { execFileSync } from 'node:child_process'

/*
 * The proxy the computer's own network settings use. Browsers follow these
 * settings; Node does not. When Steerloom is started from its app icon there
 * is no terminal environment either, so without this, sites outside the
 * company network (AI providers, Jira Cloud, Trello) would be unreachable on
 * networks that only allow the web through a proxy. Automatic proxy files
 * (PAC) cannot be followed here; a fixed proxy set beside them is used.
 */

/** macOS: from `scutil --proxy`. HTTPS proxy first, then HTTP. */
export function parseScutilProxy(output: string): string {
  const value = (key: string) =>
    new RegExp(`^\\s*${key}\\s*:\\s*(\\S+)\\s*$`, 'm').exec(output)?.[1] ?? ''
  for (const scheme of ['HTTPS', 'HTTP']) {
    if (value(`${scheme}Enable`) !== '1') continue
    const host = value(`${scheme}Proxy`)
    const port = value(`${scheme}Port`)
    if (/^[\w.-]+$/.test(host) && /^\d{1,5}$/.test(port))
      return `http://${host}:${port}`
  }
  return ''
}

/** Windows: from Internet Settings (`reg query`), "host:port" or "https=host:port;…". */
export function parseWindowsProxy(output: string): string {
  const enabled = /ProxyEnable\s+REG_DWORD\s+0x0*1\b/i.test(output)
  const server = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(output)?.[1] ?? ''
  if (!enabled || !server) return ''
  const parts = Object.fromEntries(
    server.split(';').map((part) => {
      const [scheme, address] = part.includes('=')
        ? part.split('=', 2)
        : ['', part]
      return [scheme!.toLowerCase(), address ?? '']
    }),
  ) as Record<string, string>
  const address = parts.https || parts.http || parts[''] || ''
  const clean = address.replace(/^https?:\/\//i, '')
  return /^[\w.-]+:\d{1,5}$/.test(clean) ? `http://${clean}` : ''
}

/**
 * The addresses the computer reaches without its proxy, as a NO_PROXY list.
 * Company sites such as an internal Jira are usually listed here: browsers
 * skip the proxy for them, and the proxy itself often answers them with a
 * web page instead of passing them on.
 */
export function parseScutilBypass(output: string): string {
  const block = /ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/.exec(output)?.[1]
  if (!block) return ''
  return [...block.matchAll(/^\s*\d+\s*:\s*(\S+)\s*$/gm)]
    .map((match) => match[1]!)
    .join(',')
}

/** Windows: ProxyOverride, "a;b;<local>"; <local> has no NO_PROXY form. */
export function parseWindowsBypass(output: string): string {
  const list = /ProxyOverride\s+REG_SZ\s+(\S+)/i.exec(output)?.[1] ?? ''
  return list
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry.toLowerCase() !== '<local>')
    .join(',')
}

export function systemProxySettings(platform = process.platform): {
  proxy: string
  bypass: string
} {
  try {
    if (platform === 'darwin') {
      const output = execFileSync('scutil', ['--proxy'], {
        encoding: 'utf8',
        timeout: 3000,
      })
      return {
        proxy: parseScutilProxy(output),
        bypass: parseScutilBypass(output),
      }
    }
    if (platform === 'win32') {
      const output = execFileSync(
        'reg',
        [
          'query',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
        ],
        { encoding: 'utf8', timeout: 3000 },
      )
      return {
        proxy: parseWindowsProxy(output),
        bypass: parseWindowsBypass(output),
      }
    }
  } catch {
    /* No readable system proxy: connect directly. */
  }
  return { proxy: '', bypass: '' }
}

export function systemProxy(platform = process.platform): string {
  return systemProxySettings(platform).proxy
}
