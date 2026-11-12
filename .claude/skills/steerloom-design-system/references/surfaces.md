# Surface recipes

Layout recipes for each kind of screen. Each lists its volume, hero element and structure.

## Landing / marketing page — Loud
Rhythm: hero → story tabs showcase → bento metrics → dark trust section → CTA card → footer.
- Hero: centered H1 (`--text-hero`), lead paragraph ≤ 25 words, audience line, primary + text-link CTA.
- Alternate section backgrounds (gradient / plain / dark) so no two neighbors look the same.
- Each section: one heading that promises an outcome, one hero element, max one supporting row.
- CTA card: most saturated element on the page, product preview peeking in, trust line ("Read-only · No credit card · Self-host option").

## Briefing (main app view) — Focused
The product's signature screen; it should feel like the landing page delivered on its promise.
- Header: greeting/date + one-line summary verdict ("2 things need you today").
- Hero: forecast card (date + confidence) or the top at-risk signal, whichever matters most today.
- Below: signal cards ordered by severity; each links to the work behind it.
- Side or lower: compact metrics row (throughput, cycle time, aging) with mini sparklines.
- Background: `--gradient-page`; cards `--surface`.

## Metric / analysis pages — Focused → Quiet
- Page header with metric name, plain definition, time-range control.
- Hero chart full width in a showcase panel, insight annotated on the chart.
- Breakdown table below (Quiet styling).
- "How this is calculated" panel available via side drawer.

## Forecast page — Focused
- Hero: "85% likely by Nov 14" in display type with the forecast track.
- Confidence selector (segmented control 50/70/85/95).
- Simulation histogram + assumptions list ("Based on 12 weeks of throughput, 14 items remaining").

## Dashboard / multi-team overview — Focused
- Bento grid of team tiles; the team needing most attention gets the hero tile.
- Each tile: team name, status badge, one key number, mini visual.

## Settings, integrations, admin — Quiet
- Left section nav, content max 720px.
- Grouped cards with heading + short description; form controls inside.
- Integrations: list of connector cards (logo, name, status badge, action). Emphasize "Read-only" visibly.
- Save inline with confirmation check, not a big footer bar, unless the form is long.

## Onboarding — Focused (welcome step may be Loud)
- Story-tabs/stepper on the left, step content on the right, same as the landing showcase.
- Step 1 welcome can use a hero visual; following steps are calm.
- Progress always visible; finish with a celebratory but short moment (signal cards rising in) leading into the first briefing.

## Auth (sign in / sign up) — Focused
- Split layout: form card on the left; right side a showcase panel with a looping product vignette (briefing preview) on gradient.
- Mobile: form only, small gradient header.

## Emails & notifications
- White background, single column 600px, display-font heading, signal cards as simple bordered blocks with colored top border, one blue button.
- Subject lines follow voice rules: specific and calm ("2 items need a decision before Thursday").

## Error, loading & offline states
- Loading: skeletons shaped like the real content, gently shimmering (Quiet) — the only place skeleton bars are allowed.
- Errors: plain explanation + next step + retry button; never blame the user.
- 404: small kanban-chip illustration, one sentence, link back to the briefing.

## Responsive
- Breakpoints: 640 / 1024 / 1280.
- Bento and grids collapse to one column, hero first. Vertical story tabs become a horizontal pill row above the panel.
- Touch targets ≥ 44px.
