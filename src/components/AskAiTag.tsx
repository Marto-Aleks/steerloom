import { SteerloomMark } from './SteerloomMark'

/**
 * Marks a link that hands a question to Steerloom AI: the mark and "Ask AI",
 * the same wherever a → opens the assistant. It starts the link's own words
 * ("Ask AI about DEMO-31") or stands before a named action
 * ("Ask AI · Raise DEMO-31 again").
 */
export function AskAiTag() {
  return (
    <span className="ask-ai-tag">
      <SteerloomMark size={13} trail={false} />
      Ask AI
    </span>
  )
}
