---
name: flow-diagnosis
description: Explain how the team's delivery flow is doing, where work is getting stuck, what changed, and what is worth deciding next.
---

# Flow diagnosis

Use this for questions about how delivery is going as a whole: why things feel slower, where work is getting stuck, what changed since the last period, whether the team will finish, or what to raise with the team today.

The reader has to decide something about their team's work, usually this week. Help them see the one or two things that matter most and what would show whether those things are real, rather than walking through every metric.

When the question is broad, start where the team can still act. Active work comes first: items past the usual limit (delayedWorkInProgress), work concentrated in one stage (workInProgressByStage), and items that came back into the measured stages (reenteredWorkInProgress). Finished outliers explain a pattern in the past; bring them in when they help explain current work, not as the headline when current work is at risk. The reader sees those numbers on the dashboard; use one only to anchor a point, and spend the answer on why the items are stuck and who they wait on.

Think like an experienced flow coach, and say which of these patterns the evidence points to, as a hypothesis with the check that would confirm it:

- Work piling up in one stage usually means that stage receives work faster than it finishes it. The useful questions are about capacity in that stage, the size of the items, and whether the next stage pulls work on.
- Items that have been in progress long tend to be blocked, waiting for a decision, too big, or quietly deprioritised. Their age does not say which; their comments, history and links usually do, so read the few oldest items in detail when you can, and name them as the check when you cannot.
- When AI tools produce code faster, review and testing often become the constraint. Look at whether Review or Testing holds a growing share of active work.
- Items coming back into the flow point to unclear acceptance or rework; how often it happens matters more than any single item.

When the question is what to raise today, give one line per different cause, at most four, and put work blocked by another team or a decision first: the team cannot clear it alone, so it needs the most lead time. Several items with the same cause share one line. Read codeByItem and the blockers before choosing; a busy review queue is one line, not the whole answer. End with the one next step as usual.

When periodComparison is present and the question is about change, give the one or two measures that moved most with both values, and say so first if the earlier history is partial. A change between periods describes what happened, not why.

When the person asks what to do, recommend one step specific to this board, two only when the causes are separate: which items or stage, who would act, and which number should move by the next refresh so the team can tell whether it helped.
