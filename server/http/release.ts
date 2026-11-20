/*
 * The version of Steerloom this build is, and what is new in it. The hosted
 * site serves it at /api/hosted/version; installed copies carry the version
 * they were built with and compare it with that answer to offer an update.
 *
 * Raise the version (YYYY.MM.DD, with .2, .3 … for more releases that day)
 * when a change is worth installing, and say what is new in plain words.
 */
export const RELEASE = {
  version: '2026.11.20.5',
  notes: [
    'Steerloom AI keeps story points and items apart. It gets each sprint’s planned points beside its finished points, and no longer sets points against a number of items',
    'Steerloom AI reads work carried into a later sprint as a plan larger than what gets finished, and recommends a smaller plan. It used to call it churn and recommend a scope freeze',
    'Answers use plain words where the AI copied Steerloom’s internal names, such as “carried over” for carriedOver, in plain answers as well as in cards. Times under a day read as hours',
    'A draft is the message alone, with nothing before or after it',
    'On a board without sprints, Steerloom AI no longer speaks of sprints',
    'A ticket comment addressed to an AI assistant is set aside, and what it says about a person is not repeated',
    'The open demo: both teams’ recorded Steerloom AI answers are new',
    'Flow briefing: Steerloom AI knows where the time goes. It gets each stage’s share of finished work’s time, the same number the briefing shows as “40% of time”',
    'Flow briefing: Steerloom AI knows “Flagged last week”: what the briefing named a week ago, and whether each item finished, moved, still waits or went back',
    'The Ask AI buttons ask one short question. The chat shows that question, where it used to show Steerloom’s own instructions and a block of data as if you had typed them',
    'Steerloom AI can recommend a change to how the board works, such as a limit on a stage, with the number that should move. Such options were being removed for not naming a ticket',
    'The open demo: both teams’ recorded Steerloom AI answers are new',
    'Sprint tab: a sprint is as long as its dates in Jira say. Four weeks are 28 days, where Steerloom showed 29',
    'Sprint tab: unfinished work is told apart by where it went. Work that continued in a later sprint is carried over, whether Jira moved it when the sprint was completed or someone took it out and added it to the next sprint. Only work taken out for good counts as removed. Click a sprint in the chart to see both lists',
    'Steerloom AI reads carried-over work as a plan larger than what gets finished, not as a change of scope, and says how much of each sprint was carried over and how much went back to the backlog',
    'The open demo’s Scrum team: its recorded Steerloom AI answers are new, with the reasons and options the Sprint tab questions now get',
    'Sprint tab: “What to descope” no longer fails with “Enter a valid AI chat request” on a large sprint or a long goal. The questions the Sprint tab asks Steerloom AI are now one sentence; the sprint’s facts travel with the briefing',
    'Steerloom AI: an answer about the last sprints keeps its reasons. They were being removed because they named sprints instead of items, which left a thin answer',
    'Steerloom AI offers changes to the next planning as options you can weigh, each with the number that should move in the next sprint',
    'Steerloom AI is no longer sent to read old items when its answer rests on the sprint numbers alone. When an answer names items it has not read, it is sent to read exactly those',
    'A long sprint goal, sprint name or status can no longer make AI questions on that board fail',
    'Steerloom AI costs less per question with a Claude key: the briefing and the conversation so far are kept by the provider between steps and read back at a fraction of the price',
    'Steerloom AI gives Claude and Gemini models more room to think, so a long investigation no longer runs out and starts over',
    'Steerloom AI reads several items from the board side by side: the same reads, a shorter wait',
    'When the AI provider is busy or over its rate limit, Steerloom waits a moment and asks again instead of failing',
    'On steerloom.app, a long answer no longer loses its connection while the model is thinking',
    'The app’s log notes what each AI answer took (time, requests, tokens, board reads), in counts only: never the question, the answer or an item',
    'The open demo has two teams: a Kanban team and a Scrum team, with a switch at the top (or steerloom.app/?demo=1&team=scrum). The Scrum team’s Sprint tab answers its questions with recorded Steerloom AI answers, as the Kanban demo does',
    'Sprint tab: sprint days are calendar days, like every other number in Steerloom (“day 10 of 14”), and items added mid-sprint say on which day',
    'Steerloom AI chat accepts item keys from every project on the board, as the assistant already reads them',
    'Sprint tab: “What to raise today”, the same wording as the briefing',
    'Sprint tab: the next sprint’s plan sits under the chart of the last sprints, and shows only when the next sprint is planned in Jira',
    'Sprint tab: ask Steerloom AI what the last sprints tell you, for the next planning',
    'Steerloom AI: sprint questions such as “Will we meet the goal?” answer as a card, the verdict and next step first and the reasoning on demand; long plain answers show their opening, with the rest one click away',
    'Steerloom AI knows the Sprint tab: the running sprint, each item’s chance, scope changes, rolled-over work, the planning check and whether points predict time',
    'Steerloom AI reads items from every project on a board that spans several, not only the connected project',
    'Sprint tab: ask Steerloom AI what to raise today, whether the sprint will meet its goal, and what to descope',
    'Steerloom AI treats velocity as the team’s own planning range, never a target or a comparison, and does not read small estimates as small work where points do not predict time',
    'Sprint tab: the forecast card groups items like the code card, one chip each: at risk, not started, in progress, on track, done. Items at risk and not started are listed under it; choose a group to list its items instead',
    'Sprint tab: work that went back to the backlog is aged from when it was picked up again, so ages and the forecast are not stretched by an old start',
    'Sprint tab: “Do your points predict time?” scales to what most items take, and the code card says so plainly when no branch or pull request names the sprint’s items',
    'Boards that show work from several Jira projects now load all of it, not only the connected project’s items',
    'Sprint tab: items added on a sprint’s first day count as planned, and the plan is read from when the sprint was really started',
    'Sprint tab: the forecast learns from items that went from started to done, whatever the briefing’s measured stages; with too little history it shows what is done instead of calling open work on track',
    'Sprint tab: the planning check and “Do your points predict time?” always show on boards that estimate in points, and say what they still need when there is not enough to go on yet',
    'Scrum boards open on a Sprint tab: how many sprint items are likely done by the end, each open item’s chance, and the code behind them from GitHub. Kanban boards keep the flow briefing; it stays one click away on Scrum boards too',
    'Sprint decisions: work added or removed after the sprint started, and items that keep rolling into the next sprint',
    'Planning check: the next sprint’s points against what the team finished in its last sprints, and whether the board’s story points actually predict how long work takes',
    'The last five sprints, planned against finished, in the same chart as items finished each week: hover a sprint for its numbers, click it to pin its items',
    'On steerloom.app, Jira projects connected before this release ask to be connected again once to show sprints; it updates the existing connection',
    'The open demo: Steerloom AI answers its starter questions and the dashboard’s Ask AI buttons, replaying answers the real assistant gave on the demo board, with no account or AI key needed',
    'The demo board reads like a real team: owners, comments, a blocker from another team, and work in Review',
    'Steerloom AI answers no longer slide sideways and cut off text at the panel’s edges',
    'Where work sits now: each stage’s percentage says it is the share of finished items’ time (“40% of time”), not of today’s items',
    'GitHub: connecting now shows why pull requests do not link to the board: the key only in the description or commits, a bare number, a bot, or nothing',
    'Company AI gateways: Claude on Google Vertex AI now connects. Enter the gateway’s Google address and a Claude model, or paste your AI team’s example request',
    'Every briefing shows all its numbers: cycle time, the usual limit, throughput, their trends and the late work. The Daily and Weekly choice, which hid some of them, is gone',
    'Security hardening after a full review: a saved AI key is never sent to a new endpoint address without being typed again, and answers from boards and AI services are size-limited',
    'A new password can only be chosen from the reset link in your email, and wrong guesses from elsewhere no longer lock you out of your account',
    'On your computer: the link that signs you in from the app icon works once, update checks answer only to Steerloom’s own page, and update backups leave out sign-in files',
    'The installer never replaces a folder named “node” that is not Steerloom’s own',
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
