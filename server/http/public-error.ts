/*
 * The text of an error that may be shown to the person. Steerloom's own
 * errors are written for people ("Sign in to continue."); anything else, such
 * as a programming slip (TypeError), a parse failure or a Node network error,
 * can carry file paths, hostnames or request details, so it is logged on the
 * server and replaced with the fallback.
 */
const INTERNAL_NAMES = new Set([
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
  'AggregateError',
])

export function publicMessage(caught: unknown, fallback: string): string {
  if (!(caught instanceof Error)) return fallback
  const code = (caught as { code?: unknown }).code
  const internal =
    INTERNAL_NAMES.has(caught.name) ||
    (typeof code === 'string' && /^(E[A-Z0-9_]+|ERR_|UND_ERR)/.test(code)) ||
    !caught.message.trim() ||
    caught.message.length > 400
  if (!internal) return caught.message
  console.error('[hidden error]', caught)
  return fallback
}
