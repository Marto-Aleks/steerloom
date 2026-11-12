/*
 * The questions Steerloom AI must keep getting right on the fictional test
 * board, each with what a good answer has to say and must never say. Checks
 * are deliberately loose about wording and strict about substance: the right
 * cause, the right items, no invented facts, no generic coaching.
 */

export interface EvalCase {
  id: string
  question: string
  /** What a good answer gets right, in one line: for people reading results. */
  expect: string
  /** Item keys the answer must name. */
  mention?: string[]
  /** Each pattern must match: one per idea the answer has to carry. */
  says?: Array<{ idea: string; pattern: RegExp }>
  /** None may match: wrong causes and invented facts for this question. */
  never?: Array<{ idea: string; pattern: RegExp }>
  /** Must match the verdict: the answer's first line, where the cause is named. */
  verdictSays?: Array<{ idea: string; pattern: RegExp }>
  /** May not match the verdict; other lines may mention it as context. */
  verdictNever?: Array<{ idea: string; pattern: RegExp }>
  /** Items the AI must read on the board before answering. */
  read?: string[]
}

/** Never acceptable in any answer. */
export const ALWAYS_NEVER: Array<{ idea: string; pattern: RegExp }> = [
  {
    idea: 'data field names',
    pattern:
      /\b(codeQuietDays|boardDisagrees|branchLastCommitDaysAgo|nocode)\b|code state(\s+is|:)?\s*[“"']/i,
  },
  {
    idea: 'fractions of a day',
    pattern: /\b0\.\d+\s*days?\b/i,
  },
  { idea: 'old "Move:" label', pattern: /^\s*(-\s*)?(One )?move:/im },
  {
    idea: 'generic coaching',
    pattern:
      /\b(hold a retro|run a retrospective|improve (team )?communication|align with stakeholders|best practices?|consider implementing|foster|synerg)/i,
  },
  {
    idea: 'assumes who writes code',
    pattern:
      /\b\w+ (pushes|updates|fixes|rebases) (the )?(requested )?(changes|pull request|PR|branch)/i,
  },
  {
    idea: 'judges a person',
    pattern:
      /\b(lazy|underperform\w*|not pulling (their|his|her) weight|(is|are) (too )?slow (to|at) (review|respond|deliver)\w*)\b/i,
  },
]

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'rework-quiet',
    question: 'Why is EVAL-101 late?',
    expect:
      'Rework that went quiet: reopened from Done, changes requested 16 days ago, nothing since. Not a slow reviewer.',
    mention: ['EVAL-101'],
    says: [
      {
        idea: 'changes were requested',
        pattern: /changes?\s+(were\s+)?request|requested changes/i,
      },
      {
        idea: 'it went quiet',
        pattern:
          /quiet|no (activity|movement|commits?|progress)|nothing (has )?(moved|happened)|stalled|16\s*d/i,
      },
      { idea: 'it was reopened', pattern: /reopen|back from done|rework/i },
    ],
    never: [
      {
        idea: 'blames waiting for a first review',
        pattern:
          /waiting for (a |its )?first (review|look)|no(t| one has)? review(ed)? (it )?yet/i,
      },
    ],
    read: ['EVAL-101'],
  },
  {
    id: 'blocked-dependency',
    question: 'Why is EVAL-102 late?',
    expect: 'Blocked by EVAL-150, the Logistics team’s API; no date from them.',
    mention: ['EVAL-102', 'EVAL-150'],
    says: [
      {
        idea: 'blocked or dependent',
        pattern: /block|depend|waiting (on|for) (the )?logistics/i,
      },
      { idea: 'names the other team', pattern: /logistics/i },
    ],
    never: [
      {
        idea: 'blames code review',
        pattern: /waiting for (a )?review|review queue/i,
      },
    ],
    read: ['EVAL-102'],
  },
  {
    id: 'no-first-look',
    question: 'Why is EVAL-103 late?',
    expect: 'Its pull request has waited 9 days for a first review.',
    mention: ['EVAL-103'],
    says: [
      {
        idea: 'nobody has reviewed it',
        pattern:
          /no (first )?(review|look)|not (been )?reviewed|first (review|look)|without (a )?review|unreviewed/i,
      },
    ],
    verdictNever: [
      {
        idea: 'invents requested changes',
        pattern: /changes (were )?requested|requested changes|rework/i,
      },
    ],
  },
  {
    id: 'approved-not-merged',
    question: 'Why is EVAL-104 still not done?',
    expect: 'Approved 6 days ago; the merge is held for a release window.',
    mention: ['EVAL-104'],
    says: [
      { idea: 'it is approved', pattern: /approved/i },
      { idea: 'the merge is what waits', pattern: /merg/i },
    ],
    never: [
      {
        idea: 'says it needs review',
        pattern: /needs? (a )?review|waiting for (a )?review/i,
      },
    ],
  },
  {
    id: 'board-without-code',
    question: 'EVAL-105 has been in Code Review for 11 days. What is going on?',
    expect:
      'No branch or pull request names it: the board and the code disagree; ask whether the code exists under another name or the card is wrong.',
    mention: ['EVAL-105'],
    says: [
      {
        idea: 'no code or pull request',
        pattern:
          /no (linked )?(code|branch|pull request|PR)|without (a |any )?(branch|pull request|PR)|nothing in GitHub/i,
      },
    ],
    never: [{ idea: 'invents a pull request', pattern: /acme\/web#\d+/i }],
  },
  {
    id: 'merged-card-stale',
    question: 'Why is EVAL-106 late?',
    expect: 'Its code was merged 5 days ago; the card was never moved.',
    mention: ['EVAL-106'],
    says: [
      { idea: 'the code is merged', pattern: /merged/i },
      {
        idea: 'the board is behind',
        pattern:
          /move (the )?card|card (is |was )?(still|never)|update the board|board (is )?(behind|out of date|stale)|still (shows|says|in) In Progress|(stayed|remains|sits|sat) (in )?In Progress|exits? In Progress|out of (the )?(measured columns|In Progress)/i,
      },
    ],
  },
  {
    id: 'scope-growth',
    question: 'Why is EVAL-107 taking so long?',
    expect:
      'Scope grew twice (weekend slots, bank holidays); it is too big for one item: split it.',
    mention: ['EVAL-107'],
    says: [
      { idea: 'scope grew', pattern: /scope|added|grew|growing|kept adding/i },
      {
        idea: 'split it',
        pattern:
          /split|separate (item|stor)|new (item|stor)|follow-?up|later (item|release)/i,
      },
    ],
    never: [
      { idea: 'calls it blocked', pattern: /\bblocked\b/i },
      {
        idea: 'calls the code quiet',
        pattern: /code (is |has gone )?quiet|no (recent )?commits/i,
      },
    ],
    read: ['EVAL-107'],
  },
  {
    id: 'thin-evidence',
    question: 'Why is EVAL-109 late?',
    expect:
      'The board shows no cause: no comments, no code. Say so and ask, without inventing one.',
    mention: ['EVAL-109'],
    verdictSays: [
      {
        idea: 'admits the cause is unknown',
        pattern:
          /not (clear|known|show|say)|no (comment|evidence|sign|record|cause)|nothing (on the board |in the (tickets?|board) )?(says|shows|explains)|doesn['’]t (show|say)|unclear|can['’]?not tell|possibl|likely|ask/i,
      },
    ],
    never: [
      {
        idea: 'invents a blocker',
        pattern:
          /blocked by|waiting (on|for) (the )?(design|API|another team)/i,
      },
    ],
    read: ['EVAL-109'],
  },
  {
    id: 'unknown-item',
    question: 'Why is EVAL-199 late?',
    expect: 'EVAL-199 is not on this board: say so, invent nothing.',
    says: [
      {
        idea: 'says it cannot find it',
        pattern:
          /not (on|in|part of|found|find)|couldn['’]?t find|can['’]?not find|no (item|such)|does(n['’]t| not) (exist|appear)|unavailable|isn['’]t (on|in)/i,
      },
    ],
    never: [
      {
        idea: 'invents a cause',
        pattern: /EVAL-199 is (late|stuck|blocked) because|likely cause/i,
      },
      {
        idea: 'answers about other items instead',
        pattern: /EVAL-1[01]\d/,
      },
    ],
  },
  {
    id: 'review-bottleneck',
    question: 'Is code review our bottleneck right now?',
    expect:
      'Partly: EVAL-103 and EVAL-108 wait for a first look, EVAL-104 waits to merge; EVAL-101 is rework, not the reviewers.',
    mention: ['EVAL-103', 'EVAL-108'],
    says: [
      {
        idea: 'first reviews are the wait',
        pattern: /first (review|look)|not (been )?reviewed|no review/i,
      },
    ],
  },
  {
    id: 'standup',
    question: 'What should we raise at stand-up today?',
    expect:
      'A few concrete items with a move each, among the blocker (EVAL-102), the stale card (EVAL-106), the unreviewed PRs (EVAL-103, EVAL-108) and the quiet rework (EVAL-101).',
    mention: ['EVAL-102'],
    says: [
      {
        idea: 'names at least two late items',
        pattern: /EVAL-10[1-8][\s\S]*EVAL-10[1-8]/,
      },
      { idea: 'ends with a next step', pattern: /next step:/i },
    ],
    never: [{ idea: 'raises the healthy item', pattern: /EVAL-110/ }],
  },
  {
    id: 'board-vs-code',
    question:
      'Where do the board and the code disagree, and what should we do?',
    expect:
      'EVAL-105 (Code Review, no code) and EVAL-106 (merged, still In Progress), each with its own move.',
    mention: ['EVAL-105', 'EVAL-106'],
  },
]

export interface EvalScore {
  pass: boolean
  failures: string[]
}

/** Checks one answer against its case. Pure, so it is tested without a model. */
export function scoreAnswer(
  test: EvalCase,
  answer: string,
  readKeys: ReadonlySet<string>,
): EvalScore {
  const failures: string[] = []
  if (!answer.trim()) failures.push('no answer')
  for (const key of test.mention ?? [])
    if (!new RegExp(`\\b${key}\\b`).test(answer))
      failures.push(`does not name ${key}`)
  const verdict = answer.trim().split('\n')[0] ?? ''
  for (const { idea, pattern } of test.verdictSays ?? [])
    if (!pattern.test(verdict)) failures.push(`verdict misses: ${idea}`)
  for (const { idea, pattern } of test.verdictNever ?? [])
    if (pattern.test(verdict)) failures.push(`verdict says: ${idea}`)
  for (const { idea, pattern } of test.says ?? [])
    if (!pattern.test(answer)) failures.push(`missing: ${idea}`)
  // What an answer rules out or could not check is not what it claims.
  const claims = answer
    .split('\n')
    .filter((line) => !/^- (Ruled out|Not checked):/.test(line))
    .join('\n')
  for (const { idea, pattern } of [...(test.never ?? []), ...ALWAYS_NEVER])
    if (pattern.test(claims)) failures.push(`says: ${idea}`)
  for (const key of test.read ?? [])
    if (!readKeys.has(key)) failures.push(`answered without reading ${key}`)
  return { pass: failures.length === 0, failures }
}
