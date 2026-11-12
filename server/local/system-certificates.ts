import tls from 'node:tls'

/*
 * Company networks often inspect HTTPS with their own certificate, which the
 * computer trusts but Node.js does not, so requests to AI services or Jira
 * fail with a certificate error. The local app adds the computer's trusted
 * certificates to Node's own list, as a browser would. Needs Node 22.15+
 * (the installer ships a newer 22); older versions keep their own list.
 */
type CertificateApi = {
  getCACertificates?: (type: 'default' | 'system') => string[]
  setDefaultCACertificates?: (certificates: string[]) => void
}

export function trustSystemCertificates(api: CertificateApi = tls): number {
  if (!api.getCACertificates || !api.setDefaultCACertificates) return 0
  try {
    const system = api.getCACertificates('system')
    if (!system.length) return 0
    api.setDefaultCACertificates([
      ...new Set([...api.getCACertificates('default'), ...system]),
    ])
    return system.length
  } catch {
    // Unreadable system store: keep Node's own list.
    return 0
  }
}
