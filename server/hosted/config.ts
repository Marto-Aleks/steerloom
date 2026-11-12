export interface HostedConfig {
  origin: string
  supabaseUrl: string
  publishableKey: string
  credentialKey: Buffer
}

// Server-only: the hosted origin is explicit, never inferred from proxy headers.
export function loadHostedConfig(
  env: NodeJS.ProcessEnv = process.env,
): HostedConfig {
  const parseOrigin = (value: string | undefined, label: string): string => {
    let url: URL
    try {
      url = new URL(value ?? '')
    } catch {
      throw new Error(`Configure ${label} with an HTTPS origin.`)
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error(`Configure ${label} with an HTTPS origin.`)
    return url.origin
  }
  const origin = parseOrigin(
    env.STEERLOOM_PUBLIC_ORIGIN,
    'STEERLOOM_PUBLIC_ORIGIN',
  )
  const supabaseUrl = parseOrigin(
    env.STEERLOOM_SUPABASE_URL,
    'STEERLOOM_SUPABASE_URL',
  )
  const publishableKey = env.STEERLOOM_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!publishableKey || !publishableKey.startsWith('sb_publishable_'))
    throw new Error(
      'Configure STEERLOOM_SUPABASE_PUBLISHABLE_KEY with a publishable key, never a secret key.',
    )
  const encodedKey = env.STEERLOOM_CREDENTIAL_KEY ?? ''
  if (!/^[a-fA-F0-9]{64}$/.test(encodedKey))
    throw new Error(
      'Configure STEERLOOM_CREDENTIAL_KEY with 32 random bytes encoded as hexadecimal.',
    )
  return {
    origin,
    supabaseUrl,
    publishableKey,
    credentialKey: Buffer.from(encodedKey, 'hex'),
  }
}
