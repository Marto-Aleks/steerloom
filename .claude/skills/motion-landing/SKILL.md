---
name: motion-landing
description: Use when designing or animating landing pages, hero sections, feature showcases, or product illustrations. Applies motion principles, storytelling animation, and conversion-focused copy rules.
---

# Motion & landing page design rules

## Motion principles

- Every animation must tell a story: show the problem forming, then the product resolving it. Never animate just for decoration.
- Easing: ease-out cubic-bezier(0.16, 1, 0.3, 1) for entrances, ease-in for exits, springs for playful objects.
- Durations: micro 150–300ms, panels 400–600ms, never above 800ms for UI.
- Stagger groups 40–70ms. Max ~8 staggered items before it feels slow.
- Animate only transform and opacity.
- The payoff (number, date, result) animates LAST.
- Always support prefers-reduced-motion.

## Feature showcase patterns

- Tabbed/scrollytelling showcases auto-advance with a visible progress indicator and pause on hover.
- Replace skeleton/placeholder bars with real, specific micro-content (names, numbers, dates).
- Use counters for numbers, drawing strokes for lines/borders, and color shifts to show state changes (healthy → risky).

## Copy rules

- Subheads: max ~25 words, lead with the user's pain or outcome, not the feature list.
- Prefer concrete words ("ship", "stuck", "your call") over abstract ones ("delivery insights").
- Audience lines should name the pain the audience feels, not just job titles.
- Always offer 2–3 copy variants and recommend one.

## Workflow

1. Critique the current design briefly (what works, what's static or vague).
2. Propose an animation plan per section before coding.
3. Implement, then list all timing values for easy tweaking. Work on the screens one by one.

## In this repo

- Landing code: `src/features/workspace/landing/`, styles in `src/styles/redesign/landing.css`.
- Use CSS keyframes plus small React state, matching the app; no animation library.
- Verify with Puppeteer frame captures (scratchpad `shots/`), never by assumption.
