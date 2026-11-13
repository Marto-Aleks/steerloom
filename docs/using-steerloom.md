# Using Steerloom

How dashboards, reviews, aging work and Steerloom AI behave, and
exactly how each metric is calculated. For connecting boards see
[providers](providers.md); for accounts see [authentication](authentication.md).

## Workspace and navigation

The top navigation contains **Workspace** and the active **Dashboard**. In
Supabase workspaces, **All workspaces** uses the same compact navigation
styling, spacing, hover and keyboard-focus treatment as the workspace tabs.

A brand-new workspace shows one clear path: **Let’s create your first
briefing**, a three-step guide (connect a board → choose what to measure → read
your briefing) and the Jira, Trello and demo choices. The AI assistant card
appears once there is a first briefing. On the hosted site, signing in with a
single workspace (or creating one) opens it directly.

Once there are dashboards, the workspace prioritizes saved dashboards and
existing connections. Expand **Add a board connection** for another provider or
the demo. Provider cards,
saved dashboards and connections use locally bundled official Jira and Trello
icons. Compact connection rows keep board selection and disconnect actions
together, with wrapping controls on small screens.

Disconnecting a source removes its saved credentials and associated dashboards.
Removing a dashboard deletes only its configuration. Neither action alters
boards.

In the installed app, an **Update available** button appears in the top bar
when steerloom.app has a newer version (`RELEASE` in `server/http/release.ts`).
It opens what is new and the update command itself, with **Copy**: paste it
into Terminal (PowerShell on Windows) and Steerloom reinstalls over itself,
keeping boards, dashboards and settings. The command comes from the public
`/api/hosted/update-command` (no account needed, limited per address; its link
lasts 30 minutes) and counts as `update_started` in the usage page. **Later**
hides the button for three days. The app checks on start, hourly, on each page
load (at most once a minute) and when the computer comes back online, sending
nothing but the request itself; offline or blocked, nothing is shown. Raise
`RELEASE.version` (YYYY.MM.DD[.n]) with each release worth installing.

Each page load starts in light mode, regardless of the operating-system theme or
a previously saved preference. Users can switch to dark mode for the current
visit.

## Dashboards and flow analysis

1. Connect Jira, Trello or Azure DevOps (Azure Boards) and select up to ten boards at a time, or explore the
   demo.
2. Configure the measured workflow stages, item types, and analysis period.
   Exiting the selected stages is the completion rule.
3. Resolve structural data-quality findings and save the dashboard.
4. Review Today, your selected cards/charts, and the evidence behind each
   metric. The dashboard omits a separate Flow summary to avoid repeating these
   insights.
5. Under the headline, one line says what the briefing measures: the stages,
   the period and the item types. Owners and admins can **Change** it there,
   in a sheet over the briefing; the numbers update when the new scope is
   saved. Target time and presets stay on the full setup screen (⋯ → Adjust
   report).
6. Return to **Workspace** to open another dashboard. A return visit opens
   the briefing read last time; Workspace stays one click away in the top
   bar. Opening a dashboard reuses a board the server loaded in the last ten
   minutes; **Refresh board** always asks the provider again. Settings are
   preserved either way.

While a board loads, Steerloom shows what it is doing: **Reading board
settings**, **Finding items on the board** (with the number found), **Reading
status history** (for example "120 of 340 items", with a progress bar) and
**Preparing your briefing**. Large Jira boards say when only items active in
the last 12 months are loaded. When several boards load together, the status
names the board, e.g. "Board 2 of 3 · Platform". Progress shows only counts and
stage names, never item titles or credentials. If a proxy holds the stream back,
the status stays on the first step until the board arrives.

Each board is measured separately. Metrics are deterministic. The agent retains
the bounded report evidence even when some metric cards are hidden. A board with
no completed sample can show current WIP, while cycle-time/P85 estimates remain
unavailable. Missing baselines never produce an all-clear signal.

The report header keeps to the headline, one summary sentence and two review
actions. Small-sample and data-quality notices appear under the actions when
they apply. The **⋯** menu beside the headline holds **Refresh board**,
**Adjust report** (owners and admins) and **How this was measured**, which
shows the measured stages, period, refresh time and source, explains the
completion rule, and exposes the data-quality checks and cohort exclusions.
Demo boards carry a **Demo data** tag in the top bar.

The briefing reads top to bottom with each fact shown once and nothing
collapsed: the headline and the items past the usual limit with **Where work
sits now** beside them; **Needs a decision today**, one row per signal; **When
current work could finish**; and **How the team is trending**, three numbers
(throughput, cycle time, usual limit) with their change against the previous
period and a small trend line, above two charts side by side: items finished
each week, and how long each finished item took. Method notes sit behind
**How it's calculated** links instead of under every card. Each one explains
the number in plain words: what it means, how it was read off this report's
items (for example, which two items sit in the middle for the median), what
counted, the finished items with the ones that set the number marked, and
what was left out and why. A "stay" in that list is one trip through the
measured columns; two stays mean the item came back. The forecast's note
says the same way what was replayed and what the dates mean.

The existing CSV parsing and mapping libraries remain available in the source,
but CSV import is not exposed in this workspace UI yet.

## Briefing headline

Each report opens with a plain-language briefing generated by fixed rules from
the report's own numbers; it never invents figures or scores people. The tone
below is not shown as a label; it decides which headline is used:

- **Insufficient**: no finished items or no median/P85 yet. The headline says
  there is not enough finished work and explicitly is not an all-clear.
- **Needs attention**: at least one active item is past the usual limit (P85),
  or a critical signal fired.
- **Watch**: a warning signal (for example work piling up in one stage or a
  throughput drop), or fewer than ten finished items.
- **Steady**: none of the above.

The summary is one sentence: the usual limit (P85) and the number of finished
items it is based on, plus how typical time changed against the previous period when it changed and both periods have
data. Other signals get one row each under **Needs a decision today**; its
count includes the hero card above it. "Where work sits now" shows active
items per measured stage and the share of finished items' time each stage
took. A stage is a pile-up when finished work spent 60% or more of its measured
time there and at least four active items sit there now; where work sits today
alone never triggers it, since a snapshot of counts is noise.

Two signals read who holds the active work (the Jira assignee, the first
member on a Trello card, Azure DevOps Assigned To). **Work piles on one
person** fires when several people hold work and one of them holds at least
40% of the active items and at least five; it names the load, never a
performance. **Active items have no owner** fires when at least three active
items are assigned to nobody, and only on boards where someone holds work, so a
team that does not use the field is never flagged. Names are read with the board for the report and never saved.

When the earlier
period has partial history, a note under **How the team is trending** says the
changes are a rough guide.

## Item keys

In the weekly chart, clicking a bar, or anywhere in its
column, freezes its tooltip in place. The item count in it is a link that opens those items in the tracker
(a Jira search `key in (…)`, or an Azure DevOps query; at most 200 keys); where
no such search exists (Trello), the first keys are listed as links. Click the
bar again, the ×, Escape, or the chart background to unpin. Hover is
unchanged.

Every item key in the briefing (oldest active work, the hero signal, finished
outliers, the evidence tables and AI answers) is a link to the item in its
source, opening in a new tab. Hovering or focusing a key shows the item's
title (Jira summary, Trello card name, Azure DevOps title), which is also
searchable in the active-work review. Titles are loaded with the board and
shown in the browser. The report the AI receives carries keys and metrics
only; when it reads items from the board it sees their titles too (see
[Steerloom AI](#steerloom-ai)). Keys the AI
mentions that are not on the board get a link built from the board's own
link shape (Jira `…/browse/KEY`, Azure `…/_workitems/edit/ID`); Trello card
links cannot be built from a key. The demo board carries fictional titles.

## One briefing, all its numbers

Every briefing shows the same things, whatever the board: Throughput (the
number and the weekly chart), Cycle time and the usual limit (P85), the chart
of each finished item, the items past the usual limit with the active-work
review, and the change against the previous period on each number. New
dashboards read the last 90 days.

Earlier versions offered a Daily or Weekly review and a choice of metrics,
which hid some of these. That choice is gone; dashboards saved with it keep
their board, stages and period, and now show everything.

Two questions for Steerloom AI sit in the briefing header under **Ask
Steerloom AI**: **What to raise today** (talking points on the oldest active
work, for any check-in) and **Summarise this period** (a flow summary for the
selected reporting period). Each opens the chat with the question ready to
send; nothing is sent automatically. Across the briefing, a blue link ending in an arrow (→) always asks
Steerloom AI; links without the arrow open something in Steerloom itself.

## Pull requests (GitHub)

Boards often have one Review stage while the waiting inside it is invisible.
On the local app, an owner or admin connects GitHub once under **Workspace
settings → GitHub** (see [providers](providers.md#github-pull-requests)): the
address, a token and the repositories (up to 10), checked together. Every
dashboard reads those repositories; a pull request counts for an item when its
title or branch names the item's key, such as `FLOW-131: fix login` or
`feature/flow-131-login`, so it shows only on that item's board. The card
lists each repository with how many pull requests it had in the last year and
how many name an item key, so a naming habit that links nothing shows at
once. Nothing new appears for items without a pull request.

- **One code trail per item.** Branch, commits, pull request, review and
  merge are read together as one code state: **no code yet** (no branch or
  pull request names the item), **coding** (a branch or a draft pull
  request), **in review** (a pull request ready for review; **no first look**
  while nobody but its author has reviewed it), **approved** (not merged) or
  **merged**. **Quiet Nd** is added when nothing has happened on the code
  (commit, push, review or comment) for a week or more.
- **Status lines.** An active item's line gets a short note only when the
  code adds something the board cannot show: no first look · 6d, coding,
  quiet 90d, in review, quiet 16d · changes asked, approved 2d, not merged,
  merged 3d ago (while the card is still at or before review), still coding
  or no code yet (while the card is in review or later). The full sentence
  shows on hover. Work that is moving and agrees with the board says nothing.
- **Code.** A box under **Where work sits now** groups every active item by
  its code state, one chip per item, coloured moving (blue), quiet for a week
  or more (amber) or waiting for a first look (orange); items with no code
  stay grey. A ring marks items where the board and the code disagree, and
  the headline counts them ("Board and code disagree on 2 items"). Choosing a
  group lists its items with a link to each and one sentence, and offers to
  ask Steerloom AI about them. One line adds how long review itself takes: a
  typical finished item's time from ready for review to merged.
  Board and code are compared against the first measured stage named like
  Review: before it is early, after it is late.
- **Pull requests wait N days for a first review** fires when the first look
  takes at least a day and at least 40% of that time.
- **N items are merged but not Done** fires when two or more active items have
  only merged pull requests, merged a day or more ago.

**Steerloom AI** gets the same code trail next to the board: each item's code state, its branch's last commit, how long its code has been quiet, whether the board disagrees, and its pull requests: for late
items, the rest of the active work and the slowest finished items (up to 30),
each with its stage and days there, and per pull request when it was ready,
first reviewed, how often changes were requested, approved, merged and last
touched. It joins the two instead of repeating the state: where an item's time
went (before any code, waiting for a first look, rework, waiting to merge, or
after the merge), where the board and the code disagree, whether work is alive
or stalled, and what several late items have in common.

For any item the summary does not cover, Steerloom AI can read its full code
trail with **get_code**, shown in the panel like its Jira reads ("Read the code
trail of MMA-1814"). It makes no new GitHub request: it looks the item up in
what the briefing already loaded, up to 200 items, and that list is never
written into the prompt; only the items it asks for are read, at most 30 per
answer.

Only timing is used. Steerloom compares authors and reviewers on the server, so
an author's own reply is not counted as a review, but never keeps or shows
who wrote or reviewed anything, and has no per-person numbers. Pull requests
are read with the board and kept in memory only. If GitHub cannot be read, the
briefing shows why and works as before.

## Designs (Figma)

In progress. On the local app, an owner or admin can connect Figma under
**Workspace settings → Figma** (see [providers](providers.md#figma-design-files))
and each dashboard can name its design files under **More options → Designs
from**. The briefing does not use them yet.

## Today signals

**Today** signals are rule-based and never score people. Each signal card offers
a single, signal-specific Steerloom AI investigation action. Selecting it opens
chat and starts a read-only investigation using the active report context and
signal evidence. Existing provider evidence confirmations still apply. If AI is
unavailable or the request fails, chat shows the rule-based guidance; failed
prompts remain available to retry.

## Where work sits now

Beside the hero, **Where work sits now** shows the active items per measured
stage, with the ones past the usual limit in their own colour. Two lines read
the causes behind the symptoms. "12 started · 4 finished in the last 14 days"
counts items that entered the measured stages against items that left them for
good over the last two complete weeks; started turns amber when it outruns
finished. "The 19 items finished in this period spent their time here" puts a
share under each stage: of all the measured time those finished items took, the
part spent in that stage. It describes what normally happens to work on this
board, from items whose story is complete, not where today's items are.

When started outruns finished clearly (at least three more, half as many
again) and active work grew, the signal **Starting more than finishing** fires
with the decision it points at: finish before starting.

## Needed attention last week

Below the signals, **Needed attention last week** answers "did it move?". Steerloom
replays the briefing as it would have read seven days ago, from the same board
history and the same rules, and lists the items it named then: those past the
usual limit and those that had come back into the flow. For each one it says
what happened since: finished, moved to another column, still where it was,
went back or was cancelled. The headline counts how many moved within two days, and the last line compares the usual limit then with the usual limit
now. Nothing is recorded and nobody has to press anything; the section appears
as soon as the history reaches back a week and something was flagged then, and
stays away otherwise. It opens closed, showing only the headline; click it to
see the items, so a board where nothing moves does not fill the page. "Raise …
again" opens Steerloom AI with the items that have not moved.

## Aging work

**Aging work** includes every observed, non-archived item currently in the
selected stages, including items at age zero or without a completed P85
baseline. It respects item-type filters, but not the completed reporting window.
The Aging work selection also shows a distinct current-WIP count.

The hero shows up to six items past the usual limit. **Review all active
items** on it, or **Show these** in the headline, opens the full review in a
panel over the briefing. Search by key/status/stage and
filter by current stage or P85 comparison. Results are grouped by stage and
ordered oldest first; load more after each 50 results. Expand an item to see
observed status visits and open its source link.

Age rules:

- Accumulated age adds all measured visits, including re-entry.
- Current-stage age measures only the latest continuous visit to that stage.
  Status changes inside the same column do not reset stage age; leaving and
  returning does.
- Invalid and future events are excluded at snapshot time; repeated status
  records do not reset age.
- All ages use loadedAt and 24-hour calendar days, without business-day or
  holiday adjustments.
- P85 compares against completed history and does not prove a blocker or predict
  remaining time. Samples below ten observations carry a caution; no sample
  produces an explicit unavailable baseline.

Select up to five items and choose **Ask about selected work**, or use **What to raise
today** / **Summarise this period**. These actions open editable agent drafts;
they never send automatically. Selection remains when filtering, with a count of
selected items outside the visible results. **What to raise today** drafts include up to five
oldest active items and the total active count; selected-item drafts include
only the selected keys, current stages/statuses, and ages. Text is bounded to
the chat limit. Changing or refreshing the report clears this temporary
selection.

## Team service expectation

In **Adjust report**, optionally set a team service expectation: a calendar-day
threshold and the percentage of completions expected within it. It is saved per
dashboard and retained when switching review presets. Clear the days field to
disable it. Existing dashboards have no agreed expectation until configured.

The expectation panel reports completed attainment (observations at or below
the threshold divided by valid completed observations), alongside active items
already beyond the threshold. Active work never enters the completed
denominator. No completed sample means unavailable attainment, not zero or
success. Historical P85 is labeled separately; neither value predicts remaining
time. Expectations use accumulated time in measured stages, including repeat
visits and excluding time outside those stages. AI receives the validated team
expectation with the report scope; investigations remain read-only.

## Steerloom AI

Steerloom AI is optional and uses the workspace's own AI key (see
[AI key](providers.md#ai-key)). The demo and all metrics work without it.
Without a key, the panel shows the key form itself to owners and admins (the
same form as the workspace page's AI assistant card, in a compact layout), so
a key can be connected without leaving the briefing; once it is checked and
saved the panel turns into the chat. Members see who can add one.

Open **Ask Steerloom AI** from a generated report. It docks as a side panel on
the right, without dimming the page, so the dashboard stays readable and
clickable while you chat; on narrow screens it becomes a bottom sheet. Escape
(with focus in the chat) or minimize returns to the launcher; minimizing
preserves the conversation and any running investigation. An empty chat offers
starter questions; choosing one fills the message box without sending it. When
no key is connected, the chat explains that a workspace owner or admin can add
one.

It can explain metrics, compare periods, prioritize risks, investigate items on
the board, and continue natural follow-up conversations. Each answer builds on
the conversation instead of repeating the report's headline.

Answers lead with the answer in one sentence, its key phrase in bold, then only
the evidence and the one move that matter: facts in a sentence or two, why and
what-to-do in about 80 words, drafts with nothing around them. Copy leaves the
bold markers out.

**Team notes** sit at the top of the chat: a few facts the AI should always
know about this team, such as "We don't run stand-ups", "Review limit is 4" or
"The API team is external". They are saved with the briefing (up to 600
characters), everyone in the workspace sees them, and owners and admins edit
them. The AI reads them with every question on that board as facts about the
team; they never override its rules on people and evidence.

Steerloom AI works as an agent on Jira, Trello and Azure DevOps boards. When
a question depends on what is in or happening to items (what an item is about,
who holds it, its latest comments, what changed and when, what blocks it, an
epic's children, work that has gone quiet), the model reads the board itself
with two read-only tools, a few calls at a time, and follows what it finds,
for example from a stuck item to the item blocking it:

- **Read items**: title, status, assignee, priority, type and dates for up to
  25 items; with detail, also the description, recent comments, the history of
  status and assignee changes, parent, children and links for up to 5. On
  Trello, detail adds the card description, checklists, comments, list moves
  and member changes; on Azure DevOps, the description, acceptance criteria,
  comments, state and assignee history and work item links.
- **Search items**: by words in the title, status or list, assignee (or
  unassigned), type or label, parent or epic, open or finished, and changed
  within or unchanged for a number of days. Searches stay inside the board's
  project and are built from these filters, never from text the model writes.

The first time a question needs the board, the panel lists what the
assistant wants to read. **Allow Jira** (or Trello, or Azure DevOps) lets it
read boards from then on, in this browser: you are asked once, not per
board or per chat,
and the top of the panel says "Reads Jira when a question needs it, read-only"
with **Turn off** next to it. **Continue without** answers from the report
alone and is never remembered. When a question asks about each item in a set,
the assistant reads all of them, five in detail at a time. Each answer is
limited to eight rounds of reading, eight searches and 30 items read in
detail; when a limit stops it, the unread keys are listed once at the end.
Under each answer, the panel lists the items that were checked.

Item keys in answers work like keys everywhere else in Steerloom: they link
to the item and show its title on hover, including items the assistant read
that are not in the briefing.

Company AI gateways that do not accept tool definitions are detected on the
first question and answered with the earlier planner instead: it proposes one
bounded check (named keys, delayed work, outliers, re-entered items or a
stage), which the person allows the same way.

Neither the agent nor the planner writes its own JQL or WIQL, sees
credentials, or writes to the board. Transient enterprise gateway 502/503/504
errors receive one retry.

Conversation history exists only in browser memory. Steerloom sends the latest
16 messages plus a bounded recap of older turns and clears everything on reload
or report change. AI receives a minimized report snapshot and bounded,
authorized provider evidence; credentials, emails, attachments, worklogs, and
arbitrary custom fields are excluded. Model-service retention is governed by
the configured enterprise provider.

### Forecast

When you ask Steerloom AI "when will we finish the current work?" or "how much
will we finish in the next two weeks?", the answer comes from a forecast that
Steerloom calculates, not from the AI's own arithmetic. The AI only explains
it. The same forecast appears on the dashboard as **When current work could
finish**, under **Where work sits now**: the 85% date as the headline, all four
confidence levels on a timeline, and how many items are likely to finish in the
next 14 days (including current work).

How it works: Steerloom looks at how many items left the selected columns on
each calendar day of the last eight weeks (days with nothing finished count
too). It then plays out 10,000 possible futures by drawing random days from that
history. The result is a range with confidence levels:

- **Finish the current work**: the dates by which the items now in the selected
  columns are finished in 50%, 70%, 85%, and 95% of the simulated futures.
  Anything later than a year is reported as "beyond a year".
- **Next two weeks**: at least X items with 85% confidence, and about Y items
  as the typical (50%) outcome.

The AI states the basis it used: the sampled dates, the number of days, and the
number of finished items. The same board data always gives the same forecast.

What it means and what it does not:

- It assumes the next weeks look like the sampled weeks. Holidays, team changes,
  or a shift in the kind of work are not known to it.
- It counts items, not size, and does not know which items are blocked or
  waiting on someone else.
- It is a range, not a promise. Plan against the 85% date when a commitment
  matters; the 50% date is a coin flip.
- It is not shown when there is too little history: fewer than 14 days of
  history or fewer than 10 finished items in the sampled window.

## Metric definitions

| Metric                 | Meaning                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| Cycle time             | Calendar time accumulated across visits to selected columns.                    |
| Completed observations | Tickets whose latest qualifying exit is in the period; current WIP is excluded. |
| Median                 | Middle completed cycle time.                                                    |
| P85                    | Time within which approximately 85% completed.                                  |
| Exit throughput        | Qualifying exits divided by weeks in the selected period.                       |
| Delayed WIP            | Current work older than the usual limit (completed-ticket P85).                 |

- **What counts as finished.** Columns are read in board order. An item is
  finished when it moves past the last selected column (for example into
  Testing or Done). Moving back before the first selected column (To do) is
  "returned": neither finished nor in progress. An unselected column between
  selected ones (for example Blocked) pauses the clock: the item stays in
  progress, but that time does not count. Statuses that are not on the board
  follow their Jira category (Done = finished, To Do = returned, In Progress =
  paused). Logic: `src/lib/statistics/journey.ts`.
- **Cancelled work is not delivered.** Items that finish with a Jira resolution
  such as Won't Do, Won't Fix, Duplicate, Cannot Reproduce, Declined, Rejected,
  Cancelled, Abandoned, Obsolete, Invalid or Not a Bug are left out of cycle
  time and throughput and counted on the data checks.
- **Rework.** An item that moves back from a later column into a selected one
  re-enters the flow and is flagged; it counts once, on its latest finish, and
  its cycle time adds every visit. Earlier weeks can lose that item when it is
  reopened.
- **Sub-tasks and epics** are left out unless their types are chosen under
  Item types, so parts and containers of work do not double-count it.
- **Trello** cards archived while still in a selected or paused list count as
  removed, not finished.
- Period comparisons are descriptive and do not prove causation.
- Historical P85 uses linear interpolation at sorted-sample index
  `0.85 × (n − 1)`; small samples may not have exactly 85% of observations below
  that threshold.
- Weekly throughput includes zero-completion UTC weeks (Monday starts). Fixed
  periods include every intersecting week; boundary weeks may be partial and
  only count exits in the report window. The headline weekly rate remains
  completed items divided by selected days times seven.
- All-history charts span the first to last observed completion and do not imply
  coverage outside that span. Throughput uses straight segments to avoid
  suggesting interpolated activity.
- Trello supports current WIP, cycle-time trends, and throughput, but not
  period-end WIP comparisons; see [Trello history](providers.md#history-limits).
