# Review checklist

Run before finishing any Steerloom design or UI change. Fix failures, then mention anything intentionally off-system.

## Consistency
- [ ] Volume chosen (Loud / Focused / Quiet) and the screen behaves like it
- [ ] Only tokens used: no stray hex values, shadows, radii or durations
- [ ] Existing components reused; any new pattern built from tokens
- [ ] Display font for headings and metrics, body font elsewhere
- [ ] One accent color (blue); warm colors only for status meaning

## Hierarchy
- [ ] One clear hero element per view
- [ ] Headings clearly larger than body (≥ 2.5× Loud, ≥ 1.75× Focused)
- [ ] One primary button per view
- [ ] No placeholder or skeleton bars in finished (non-loading) designs

## Content
- [ ] Copy follows voice.md: specific, outcome-led, no banned words
- [ ] Numbers have units, time range or sample size
- [ ] Forecast dates always paired with confidence
- [ ] Status vocabulary matches data-viz.md exactly

## Motion
- [ ] Every animation explains a change or tells the story
- [ ] Durations within limits for the volume (app ≤ 500ms)
- [ ] Payoff animates last
- [ ] transform/opacity only; prefers-reduced-motion handled

## Accessibility & responsive
- [ ] Text contrast ≥ 4.5:1 (3:1 for large text)
- [ ] Status never conveyed by color alone
- [ ] Visible focus rings on all interactive elements
- [ ] Works at 375px, 768px, 1280px; touch targets ≥ 44px
