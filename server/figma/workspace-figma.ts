import {
  FIGMA_FILE_LIMIT,
  isFigmaFileKey,
  type WorkspaceFigmaSettings,
} from '../../src/lib/workspace/model'
import { FigmaClient } from './client'

/** Stored encrypted; only the server ever reads the token. */
export interface FigmaSecret {
  token: string
}

/** Validates an owner's Figma form. A blank token keeps the stored one. */
export function readFigmaInput(
  input: Record<string, unknown>,
  existing?: FigmaSecret,
): FigmaSecret {
  const typed = typeof input.token === 'string' ? input.token.trim() : ''
  if (typed.length > 400) throw new Error('This token is too long.')
  const token = typed || existing?.token || ''
  if (!token) throw new Error('Paste a Figma token.')
  return { token }
}

export function figmaSummary(): WorkspaceFigmaSettings {
  return { connected: true }
}

/** Checks the token once before it is saved. */
export async function connectFigma(
  secret: FigmaSecret,
  network: { proxyUrl?: string },
  signal?: AbortSignal,
): Promise<FigmaSecret> {
  await new FigmaClient({ ...secret, ...network }).verify(signal)
  return secret
}

/** The file keys a request names, checked as a saved dashboard's are. */
export function readFigmaFiles(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > FIGMA_FILE_LIMIT ||
    !value.every(isFigmaFileKey)
  )
    throw new Error(`Name up to ${FIGMA_FILE_LIMIT} Figma files.`)
  return value
}
