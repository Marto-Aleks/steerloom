export type AiResponseBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }

const headingPattern =
  /^(?:bottom line|evidence|what this means|recommendation|decision needed|watch next|unknowns?|ticket view|verified blockers|confidence|options?|next steps?|assumptions?)(?::)?$/i
const inlineHeadingPattern =
  /^(bottom line|evidence|what this means|recommendation|decision needed|watch next|unknowns?|ticket view|verified blockers|confidence|options?|next steps?|assumptions?):\s*(.+)$/i

export function formatAiResponse(content: string): AiResponseBlock[] {
  const lines = content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
  const blocks: AiResponseBlock[] = []
  let paragraph: string[] = []
  let list: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }
  const flushList = () => {
    if (!list.length) return
    blocks.push({ type: 'list', items: list })
    list = []
  }

  lines.forEach((line) => {
    if (!line) {
      flushParagraph()
      flushList()
      return
    }
    const inlineHeading = line.match(inlineHeadingPattern)
    if (inlineHeading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', text: inlineHeading[1] ?? '' })
      paragraph.push(inlineHeading[2] ?? '')
      return
    }
    if (headingPattern.test(line)) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', text: line.replace(/:$/, '') })
      return
    }
    if (/^[-•]\s+/.test(line)) {
      flushParagraph()
      list.push(line.replace(/^[-•]\s+/, ''))
      return
    }
    flushList()
    paragraph.push(line)
  })

  flushParagraph()
  flushList()
  return blocks
}
