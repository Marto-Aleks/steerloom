import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Context binds ciphertext to its workspace and connection, including version.
export function credentialVault(key: Buffer) {
  if (key.length !== 32)
    throw new Error('A 32-byte credential key is required.')
  const context = (workspaceId: string, connectionId: string) => {
    const uuid =
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
    if (!uuid.test(workspaceId) || !uuid.test(connectionId))
      throw new Error('Invalid credential scope.')
    return Buffer.from(`steerloom:v1:${workspaceId}:${connectionId}`)
  }
  return {
    encrypt(value: string, workspaceId: string, connectionId: string): string {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(context(workspaceId, connectionId))
      const encrypted = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
      ])
      return [iv, cipher.getAuthTag(), encrypted]
        .map((part) => part.toString('base64'))
        .join('.')
    },
    decrypt(value: string, workspaceId: string, connectionId: string): string {
      try {
        const parts = value.split('.')
        if (parts.length !== 3) throw new Error('Invalid envelope')
        const [iv, tag, encrypted] = parts.map((part) =>
          Buffer.from(part, 'base64'),
        )
        if (iv!.length !== 12 || tag!.length !== 16)
          throw new Error('Invalid envelope')
        const decipher = createDecipheriv('aes-256-gcm', key, iv!)
        decipher.setAAD(context(workspaceId, connectionId))
        decipher.setAuthTag(tag!)
        return Buffer.concat([
          decipher.update(encrypted!),
          decipher.final(),
        ]).toString('utf8')
      } catch {
        throw new Error(
          'Could not decrypt this connection. Reconnect the provider.',
        )
      }
    },
  }
}
