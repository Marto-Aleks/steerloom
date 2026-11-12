/** Shown on the hosted site (and on the dev server's hosted flow). */
export function feedbackAvailable(): boolean {
  const hosted =
    document
      .querySelector('meta[name="steerloom-mode"]')
      ?.getAttribute('content') === 'hosted'
  return (
    hosted ||
    (import.meta.env.DEV &&
      new URLSearchParams(window.location.search).get('hosted') === '1')
  )
}
