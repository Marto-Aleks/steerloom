/*
 * The version of Steerloom this build is, and what is new in it. The hosted
 * site serves it at /api/hosted/version; installed copies carry the version
 * they were built with and compare it with that answer to offer an update.
 *
 * Raise the version (YYYY.MM.DD, with .2, .3 … for more releases that day)
 * when a change is worth installing, and say what is new in plain words.
 */
export const RELEASE = {
  version: '2026.11.12.3',
  notes: [
    'Update from inside Steerloom: “Update now” does it in one click, saves a copy of your boards and settings first, and reopens by itself. No terminal',
    'A shorter briefing header: each fact once, with the detail one hover away',
    '“Ask AI” and the Steerloom mark now start every link that opens Steerloom AI',
    'A first briefing starts from the stages your Jira marks as in progress, whatever they are called; on other boards, from the columns between the first and the last instead of the backlog',
    'One unexpected error no longer closes Steerloom: it is logged and the app keeps running',
    'The hosted site limits how much one account can ask in an hour, so one busy account cannot slow it for everyone or run up a workspace’s AI bill',
    'A Jira or Trello connection that fails on its way back now says so, instead of returning you to step one without a word',
    'Connecting Jira asks for the link first; token fields appear only when your Jira needs them',
    'Steerloom AI says up front that it needs an AI key of your own, and that a ChatGPT or Claude subscription does not include one',
    'Sign-in is better protected against repeated attempts, and the library Steerloom uses to reach your board and AI service is updated',
    'Steerloom AI with an Anthropic key answers questions that read the board again, instead of stopping with “each thinking block must contain thinking”',
    'Boards behind a company VPN load reliably: a Jira or GitHub request the network cuts off or leaves unanswered is tried again, instead of failing the whole board',
    'Items with no branch or pull request naming them now read “no linked code”: the code may exist under another name, so Steerloom no longer says there is none',
    'GitHub: failing checks show on the item (“approved, checks fail”), and a signal names approved work held only by a red build',
    'A signal when approved pull requests wait days to be merged; pull requests untouched for a month count as abandoned, not waiting',
    'Large pull requests: when changes over 400 lines take at least twice as long to merge, the briefing shows how much longer, from your own history',
    'Steerloom AI knows each pull request’s size and build result, names failing checks as a cause only when the timing fits, and writes item keys in full, one point per sentence',
    'The demo board shows a fictional code trail, so the open demo shows the GitHub view without a token: code notes on late items, the Code box and its signals',
    'A new cut of the film: Steerloom AI investigates the board and the code, and shows its reasoning',
    'Answer cards name the right source when a fact cites a pull request, and read more naturally',
    'Steerloom AI answers appear as they are written: the verdict and next step first, the checked reasons and options when it finishes',
    'A new Steerloom logo and app icon: a ticket moving from one stack to the next on a board. It also marks every place you can ask Steerloom AI',
    'Answer cards always weigh two or three options, so you choose the way forward',
    'Why and what-to-do questions get an answer card: the verdict and the next step first, the reasoning one click away, with what supports it, what was ruled out and the options weighed',
    'Steerloom checks each card before you see it: claims about items it did not read are marked, vague options are removed, and the confidence shows which sources agree',
    'While Steerloom AI works, a short running log shows what it reads and what it is doing now',
    'Copy any answer from the icon in its corner',
    'Steerloom AI sees the whole board when you ask a broad question: what to raise today, where the board and the code disagree, whether review is the bottleneck; blockers come first',
    'When nothing on the board explains a delay, Steerloom AI says so and asks, instead of guessing; an item that is not on the board gets a one-line answer',
    'Steerloom AI answers end with a clear “Next step”, in the board’s words',
    'While Steerloom AI works, it shows what it has done so far: each read, from which system, and what it rests on while it weighs the answer',
    'Steerloom AI reads an item’s whole code trail when you ask about it: branch, pull requests and review timing, from what Steerloom already loaded; nothing is written to GitHub',
    'Steerloom AI answers end on a full sentence, name a single item once, and suggest asking its owner rather than assuming who wrote the code',
    'GitHub as one code trail: branch, commits, pull request, review and merge read together, so each item says “no code yet”, “coding”, “no first look”, “approved” or “merged”, and “quiet” when nothing has moved for a week',
    'The Code box groups every active item by what its code says, and lists where the board and the code disagree; Steerloom AI reasons over the same trail',
    'GitHub reads go through company proxies more reliably, and say plainly when GitHub cannot be reached',
    'Code review, from GitHub: a box under “Where work sits now” shows what the review stage holds today, grouped by where each pull request stands; choose a group to see its items and ask Steerloom AI about them',
    'Status lines say only what GitHub adds to the board, in a short label (“PR quiet 101d”), with the full sentence on hover',
    'The At risk box shows as many late items as fit, and crowded stage columns stay visible',
    'GitHub repositories are set on the GitHub card, next to the token, and checked when you save: each shows how many pull requests it had and how many name an item key',
    'GitHub tokens: Steerloom only ever sends read queries, refuses classic tokens with more than “repo” or without an expiry, and shows when the token expires',
    'When the company network answers instead of Jira, Steerloom now says the likely cause: the company’s proxy tool is missing on this computer',
    'GitHub: connect it on the workspace page and the briefing shows where each item’s pull request stands, what happens inside Review, and when reviews are the real queue',
    'Steerloom AI reads pull requests next to the board: where an item’s time really went, and where the board and the code disagree',
    'Company Jira on a proxied laptop: Steerloom now skips the proxy for the addresses your computer does, so an internal Jira no longer answers with a web page',
    'Daily and weekly reviews read the same 90 days, so an item is late in both or in neither',
    'Work in a “Won’t do” or “Cancelled” column no longer counts as finished, so throughput and cycle time may shift slightly',
    'Ask Steerloom AI how a number is calculated and it answers with the formula and your numbers',
    'Plainer signals: what the board shows, without guessing why',
    '“Flagged last week” opens closed, with the headline only; click it to see the items',
    'Causes next to symptoms: “Where work sits now” shows started against finished and where finished work spent its time per stage; a new signal fires when the team starts more than it finishes',
    'Signals are one-line rows: what fired, which items, why, and what to do, with the pile-up signal back in the list',
    '“Flagged last week”: what the briefing named seven days ago and what happened to each item since, replayed from the board history',
    '“How it’s calculated” in plain words: what each number means, how it was read off your items, and which items set it',
    'The close button stays in view while a dialog scrolls',
    'The fictional “Investigation preview” inside Active work is gone; Ask Steerloom AI does the real investigation',
    'The demo board now has six months of believable history: a slow start, a faster recent quarter, and trends with something to compare against',
    'A simpler briefing: each fact once, the trend at a glance, every active item one click away',
    'Ask Steerloom AI: “What to raise today” and “Summarise this period” replace the stand-up and weekly review buttons',
    'Steerloom AI coaches in short: why work is stuck and who it waits on, from the tickets',
    'It reads the board itself on Jira, Trello and Azure DevOps; you allow it once, for every board',
    'Item keys in its answers show their titles and open the item',
  ],
} as const

export interface ReleaseInfo {
  version: string
  notes: string[]
}

/** Compares YYYY.MM.DD[.n] versions; positive when a is newer. */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.split('.').map((part) => Number(part))
  const left = parts(a)
  const right = parts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference) return difference
  }
  return 0
}

/** A release answer from steerloom.app, checked before it is shown. */
export function readRelease(value: unknown): ReleaseInfo | null {
  if (!value || typeof value !== 'object') return null
  const { version, notes } = value as { version?: unknown; notes?: unknown }
  if (
    typeof version !== 'string' ||
    !/^\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d{1,3})?$/.test(version)
  )
    return null
  return {
    version,
    notes: Array.isArray(notes)
      ? notes
          .filter((note): note is string => typeof note === 'string')
          .map((note) => note.slice(0, 200))
          .slice(0, 6)
      : [],
  }
}
