import { createHash, randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export const SESSION_LIFETIME = 8 * 60 * 60 * 1000
interface Session {
  userId: string
  expires: number
}

// Only hashes of random application-session cookies are persisted. Google
// tokens and ongoing OAuth transactions never enter this file.
export class LocalSessions {
  private readonly file: string
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.file = join(directory, 'sessions.json')
  }
  get(token: string): Session | undefined {
    if (!/^[a-f0-9]{64}$/.test(token)) return undefined
    return this.read()[this.digest(token)]
  }
  set(token: string, session: Session) {
    if (
      !/^[a-f0-9]{64}$/.test(token) ||
      !session.userId ||
      !Number.isFinite(session.expires) ||
      session.expires <= Date.now() ||
      session.expires > Date.now() + SESSION_LIFETIME
    )
      throw new Error('Could not create a valid session.')
    const sessions = this.read()
    if (Object.keys(sessions).length >= 1000)
      throw new Error(
        'Too many active sessions. Sign out of an existing session or try again later.',
      )
    sessions[this.digest(token)] = {
      userId: session.userId,
      expires: session.expires,
    }
    this.write(sessions)
  }
  delete(token: string) {
    const sessions = this.read()
    const digest = this.digest(token)
    if (!(digest in sessions)) return
    delete sessions[digest]
    this.write(sessions)
  }
  private digest(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }
  private read(): Record<string, Session> {
    const sessions = Object.create(null) as Record<string, Session>
    if (!existsSync(this.file)) return sessions
    try {
      if (statSync(this.file).size > 1024 * 1024) return sessions
      const value: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return sessions
      for (const [key, entry] of Object.entries(value)) {
        if (!/^[a-f0-9]{64}$/.test(key) || !entry || typeof entry !== 'object')
          continue
        const item = entry as Record<string, unknown>
        if (
          typeof item.userId !== 'string' ||
          !item.userId ||
          item.userId.length > 100 ||
          typeof item.expires !== 'number' ||
          !Number.isFinite(item.expires) ||
          item.expires <= Date.now() ||
          item.expires > Date.now() + SESSION_LIFETIME
        )
          continue
        sessions[key] = { userId: item.userId, expires: item.expires }
      }
      return Object.keys(sessions).length <= 1000
        ? sessions
        : (Object.create(null) as Record<string, Session>)
    } catch {
      return sessions
    } // Corrupt/unreadable session files fail closed.
  }
  private write(sessions: Record<string, Session>) {
    const temporary = `${this.file}.${randomBytes(8).toString('hex')}.tmp`
    writeFileSync(temporary, JSON.stringify(sessions), {
      mode: 0o600,
      flag: 'wx',
    })
    renameSync(temporary, this.file)
  }
}
