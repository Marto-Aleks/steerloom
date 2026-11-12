/*
 * The one question Loomy asks from the feedback button: "Was this briefing
 * useful?" on a real board, "Does this look useful for your team?" on the
 * demo. Each is asked once per browser, after the briefing has been on screen
 * for a while; a page requests it and the feedback button shows it.
 */
export type FeedbackTopic = 'briefing' | 'demo'

const ASKED_KEY: Record<FeedbackTopic, string> = {
  briefing: 'steerloom:feedback-asked',
  demo: 'steerloom:feedback-asked-demo',
}
/** How long a briefing is on screen before the question. */
const ASK_AFTER_MS = 20_000
/** How soon to look again when the moment was wrong. */
const RETRY_MS = 10_000
const listeners = new Set<(topic: FeedbackTopic) => void>()

function alreadyAsked(topic: FeedbackTopic): boolean {
  try {
    return localStorage.getItem(ASKED_KEY[topic]) !== null
  } catch {
    // Without storage the question could repeat on every visit: stay quiet.
    return true
  }
}

function rememberAsked(topic: FeedbackTopic) {
  try {
    localStorage.setItem(ASKED_KEY[topic], new Date().toISOString())
  } catch {
    // Nothing to remember it in.
  }
}

/** Asks the question unless this browser has seen it before. */
export function askForFeedbackOnce(topic: FeedbackTopic = 'briefing') {
  // No feedback button on this page (the installed app): nothing to ask with.
  if (listeners.size === 0 || alreadyAsked(topic)) return
  rememberAsked(topic)
  askForFeedbackAgain(topic)
}

/** Asks the question again, for the design preview. */
export function askForFeedbackAgain(topic: FeedbackTopic = 'briefing') {
  for (const listener of listeners) listener(topic)
}

/** A dialog is open, an AI answer is being written, or the tab is hidden. */
function wrongMoment(): boolean {
  return (
    document.hidden ||
    document.querySelector('dialog[open], [aria-busy="true"]') !== null
  )
}

/**
 * Asks once a briefing has been on screen for a while, waiting out anything
 * the person is in the middle of. Returns how to call it off.
 */
export function askForFeedbackSoon(
  topic: FeedbackTopic = 'briefing',
): () => void {
  let timer = window.setTimeout(function attempt() {
    if (wrongMoment()) timer = window.setTimeout(attempt, RETRY_MS)
    else askForFeedbackOnce(topic)
  }, ASK_AFTER_MS)
  return () => window.clearTimeout(timer)
}

export function onFeedbackAsk(
  listener: (topic: FeedbackTopic) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
