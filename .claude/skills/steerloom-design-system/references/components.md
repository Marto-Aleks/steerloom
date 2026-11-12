# Components

Build every component from tokens. Each entry lists anatomy, states, and how it changes by volume.

## Contents
1. Buttons & links
2. Cards & panels
3. Bento tile
4. Metric
5. Signal card
6. Story tabs (vertical stepper)
7. Tabs & segmented control
8. Badges & status chips
9. Task chip
10. Forms
11. Tables & lists
12. Empty states
13. Modals, menus, toasts
14. Navigation

---

## 1. Buttons & links

- **Primary.** `--blue-600` bg, white text 600 weight, `--radius-sm`, height 44px (40 in Quiet), padding 0 20px, `--shadow-button`. Hover: `--blue-700` and 1px lift. Press: scale 0.98. Loud only: a subtle light sweep across on hover.
- **Secondary.** White surface, `--line-strong` border, `--ink-900` text.
- **Text link / tertiary.** `--blue-600`, 600 weight, optional trailing "→" that nudges 3px right on hover.
- **Destructive.** `--risk-600` text on a secondary button; filled red only inside confirmation dialogs.
- Labels describe the user's action ("Connect my board", "Export briefing"), never "Submit" or "Click here".
- One primary button per view.

## 2. Cards & panels

- **Card.** `--surface`, `--radius-lg`, `--shadow-md`, 1px `rgba(255,255,255,.7)` inner highlight border. Padding by volume (32 / 24 / 16–20).
- **Showcase panel** (Loud/Focused). `--radius-xl`, `--gradient-card`, `--shadow-lg`, plus one or two blurred gradient blobs inside (mint top-left, lavender bottom-right).
- **Interactive card hover.** translateY(-4px), shadow step up, `--dur-ui` `--ease-out`.
- No heavy borders. Separate with space or a 1px `--line` divider.

## 3. Bento tile

For feature or metric overviews (Loud, and Focused dashboards).
- Grid of 3 columns on desktop; exactly one hero tile spans 2×2 or 2×1.
- Anatomy: label (sm, `--ink-500`) → big value (metric) → one-line meaning → mini visual.
- Hover reveals a secondary link ("How it's calculated →").
- Collapses to 1 column on mobile with the hero tile first.

## 4. Metric

- Value in display font, `--text-metric-xl` (hero) or `--text-metric`, tabular numerals, `--ink-900`.
- Unit smaller and `--ink-500` ("4.2 *days*").
- Optional delta chip: ↑/↓ with status color and words ("2 days slower than usual"). Never color alone.
- Optional "Shows its working" affordance: an ⓘ or "How" link opening the calculation. Every number in the product should be explainable.

## 5. Signal card

The briefing's core unit (At risk / Bottleneck / Rework / On track).
- White card, `--radius-lg`, 3px top border in the status color.
- Left: 40px status icon on a soft tinted base (status `-100` bg, `-600` glyph).
- Right: title (h3), one-sentence finding with real specifics, then meta row (affected items, since when) and an action link.
- Copy pattern: **what + evidence + so-what**. "Checkout redesign: 9 days in progress, 3× the usual. Likely to slip the Nov 14 release."
- Ordering: at risk → bottleneck → rework → info.

## 6. Story tabs (vertical stepper)

Landing pattern also usable in onboarding and product tours.
- Vertical 2px `--line` rail with dots. Active item: white card, `--ring-active`, title + description; dot turns `--blue-600` with a soft halo. Inactive: title only in `--ink-500`.
- Loud: auto-advance (~6s) with the rail filling as a progress bar; pause on hover.
- Focused (onboarding): user-driven, no autoplay.

## 7. Tabs & segmented control

- Horizontal pill tabs on `--surface-sunken` track; active pill white with `--shadow-sm`; indicator slides between options (`--dur-ui`).
- Underline tabs for page-level navigation: 2px `--blue-600` underline that slides.

## 8. Badges & status chips

- Pill, `--text-xs` 600, status `-100` background with `-600` text, optional 6px dot.
- Labels: "At risk", "Bottleneck", "Aging", "On track", "Rework". Keep vocabulary identical everywhere.

## 9. Task chip

The rounded "pill blocks" in the kanban illustration.
- `--radius-sm`, glossy gradient (`--gradient-chip-blue` healthy, `--gradient-chip-warn` aging), subtle top highlight.
- Used in illustrations and compact board visualizations. In real data tables, use badges instead.

## 10. Forms

- Inputs: 44px height, `--radius-md`, white, 1px `--line-strong`; focus = `--blue-600` border + `--ring-focus`.
- Labels above inputs, `--text-sm` 600 `--ink-700`. Help text `--text-xs` `--ink-500`.
- Errors: `--risk-600` text below field plus icon; say what to do ("Paste the full board URL, starting with https://").
- Group long forms into cards with a short heading each.
- Toggles: pill track, blue when on, thumb slides with `--ease-out`.

## 11. Tables & lists

- Quiet volume. Header row `--surface-sunken`, `--text-xs` uppercase `--ink-500`.
- Rows 52px, `--line` dividers, hover `--blue-50`.
- Numbers right-aligned, tabular. Status as badges. Aging values can show a tiny inline bar.
- No zebra stripes, no vertical borders.

## 12. Empty states

Empty states are a Focused moment: they are where the product sells itself inside the app.
- Small illustration in landing style (task chips, soft gradient blob) — not generic clip-art.
- Headline that promises the outcome ("Your first briefing is a click away"), one sentence, one primary button.
- Optional preview of what will appear (a faded sample signal card).

## 13. Modals, menus, toasts

- Modal: `--radius-xl`, `--shadow-lg`, backdrop `rgba(15,23,42,.35)` with 4px blur. Enters with fade + scale 0.97→1.
- Menus/popovers: `--radius-md`, `--shadow-lg`, 6px offset, `--dur-ui`.
- Toasts: bottom-center, dark (`--dark-bg`, `--dark-ink`) for contrast, auto-dismiss 4s, include an undo when relevant.

## 14. Navigation

- Marketing: transparent top bar becoming `--surface` with blur and `--shadow-sm` after scroll.
- App: left sidebar on `--bg-base`, items 40px, active item white pill with `--shadow-sm` and `--ink-900` text; icons 20px line style, 1.75px stroke.
- Page header in app: title (display, `--text-h1` scaled down to ~2rem), one-line description, primary action on the right.
- Logo: always the `Wordmark` component (mark + "Steerloom" in Sora semibold, −0.04em). The mark alone is `SteerloomMark`: two stacks of tickets, one moved ticket in the brand gradient with a fading trail. Use `tone="white"` on filled brand buttons and drop the trail below 16px. Every "Ask Steerloom AI" entry point carries the mark instead of a chat icon. Files and app icons: `public/brands/README.md`.

## 15. Showing the AI at work (motion)

Steerloom's AI has no character, no glowing line and no face. Its work shows through the product surfaces themselves, and the only pointer on screen is a person's cursor. (An earlier "Thread of light" motif was tried in the film and retired: it decorated the evidence instead of being it, and read as dated.)

**How the board shows Steerloom reading and judging** (reference: the product film on the landing page):

| Beat | What the viewer sees |
|---|---|
| reading | a soft band of light crosses the board once; cards brighten as it passes, then it is gone |
| aging | a card's edge warms gradually from blue-grey to `--warn-400` over the scene |
| bottleneck | the column swells and its cards compress |
| at risk | a soft `--risk-600` glow on the card |
| surfacing an item | the card lifts toward the camera on a spring; the rest of the board rack-focuses to blur; the card flips to show its plain-language reason on the back |
| forecast | a confidence band sweeps across an unlabeled calendar with "likely" and "very likely" zones |
| a decision | the manager's cursor (normal pointer plus a small name pill) drags the card to a reviewer; the avatar ring-pulses and the card's owner changes |

**No numbers.** The film never shows dates, percentages, day counts, item counts, ticket IDs, clock times or metric values. Evidence is plain language ("Waiting the longest in Review").

**In the app.** Prefer the same vocabulary over spinners and glowing lines: a brightening sweep while a board loads, a warming edge for age, a lift-and-reason on hover for a surfaced item. Keep it Focused-volume: once per state change, under 500 ms, replaced by fades under `prefers-reduced-motion`. The landing hero's static ribbon behind the film card is a decorative brand element, not an AI indicator.
