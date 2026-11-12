import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
} from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import type { SupabaseTokens } from './auth-provider'

export interface StoredSession {
  tokens: SupabaseTokens
  expires: number
}
export interface SessionPersistence {
  load(): Array<[string, StoredSession]>
  save(sessions: Iterable<[string, StoredSession]>): void
}
// One Node process on one persistent disk. Refresh promises and OAuth flows are
// deliberately ephemeral. Only hashed cookie IDs and encrypted tokens persist.
export function diskSessionStore(
  file: string,
  key: Buffer,
): SessionPersistence {
  if (!isAbsolute(file) || key.length !== 32)
    throw new Error('Configure an absolute session file and a 32-byte key.')
  const aad = Buffer.from('steerloom:hosted-sessions:v1')
  return {
    load() {
      if (!existsSync(file)) return []
      try {
        const [iv, tag, ciphertext] = readFileSync(file, 'utf8')
          .split('.')
          .map((value) => Buffer.from(value, 'base64'))
        const decipher = createDecipheriv('aes-256-gcm', key, iv!)
        decipher.setAAD(aad)
        decipher.setAuthTag(tag!)
        const value: unknown = JSON.parse(
          Buffer.concat([
            decipher.update(ciphertext!),
            decipher.final(),
          ]).toString('utf8'),
        )
        if (!Array.isArray(value) || value.length > 1000) throw new Error()
        return value
          .map((entry: unknown): [string, StoredSession] => {
            if (!Array.isArray(entry) || entry.length !== 2) throw new Error()
            const [digest, stored] = entry as unknown[]
            if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))
              throw new Error()
            const session = stored as StoredSession | undefined
            if (
              !session ||
              !Number.isFinite(session.expires) ||
              typeof session.tokens?.accessToken !== 'string' ||
              typeof session.tokens.refreshToken !== 'string' ||
              !Number.isFinite(session.tokens.expiresAt)
            )
              throw new Error()
            return [
              digest,
              { expires: session.expires, tokens: session.tokens },
            ]
          })
          .filter(([, session]) => session.expires > Date.now())
      } catch {
        // Sessions are disposable: everyone signs in again. Refusing to
        // start would take the whole site down over a changed credential
        // key or a damaged file. The file is kept aside, so a key changed
        // by mistake can be put back and the sessions restored.
        const aside = `${file}.unreadable`
        try {
          renameSync(file, aside)
        } catch {
          // The next save replaces the file anyway.
        }
        console.error(
          `Hosted sessions could not be read (changed credential key or damaged file). Starting with no sessions; the old file is kept at ${aside}.`,
        )
        return []
      }
    },
    save(sessions) {
      const value = Array.from(sessions, ([id, { expires, tokens }]) => [
        id,
        { expires, tokens },
      ])
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(aad)
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
      ])
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      const temporary = `${file}.tmp`
      writeFileSync(
        temporary,
        [iv, cipher.getAuthTag(), encrypted]
          .map((item) => item.toString('base64'))
          .join('.'),
        { mode: 0o600 },
      )
      renameSync(temporary, file)
    },
  }
}
