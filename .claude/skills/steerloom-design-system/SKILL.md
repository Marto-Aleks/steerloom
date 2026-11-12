---
name: steerloom-design-system
description: Steerloom's design system — visual style, tokens, components, motion, data-viz and copy voice for every Steerloom surface. Use this skill for ANY Steerloom UI or copy work, including the landing page, marketing sections, dashboards, the briefing view, forecasts, settings, onboarding, empty states, emails, modals, forms and tables — even when the request is small ("add a button", "fix this card", "make a settings page", "write an error message"). Also use it whenever someone asks to make a screen "match the landing page", "feel consistent", "on brand", or "less boring".
---

# Steerloom design system

Steerloom turns a team's board history into a short, honest briefing. The design has to feel the same way the product works: **calm, clear, and confident, with moments of proof.** Airy light surfaces, navy type, one blue accent, warm colors reserved for problems, and motion that tells a story instead of decorating.

The landing page is the reference implementation. Every other surface uses the same DNA at a different volume.

## 1. Source of truth

1. If the codebase has a tokens file (CSS variables, Tailwind config, theme.ts), **that file wins.** Use its names. If its values differ from `assets/tokens.css`, follow the codebase and mention the difference.
2. If no tokens exist yet, copy `assets/tokens.css` into the project and build on it.
3. Never hard-code a hex value, shadow, radius or duration in a component. Always reference a token. Hard-coded values are how consistency dies.

## 2. Pick the volume before designing anything

Same tokens, same components, different intensity. Decide which level the screen is, then follow it.

| Volume | Where | Feel |
|---|---|---|
| **Loud** | Landing page, marketing sections, launch pages, onboarding welcome, upgrade/CTA moments | Big type, bento grids, hero visuals, gradient blobs, scroll-triggered storytelling, dark contrast sections |
| **Focused** | Briefing view, forecast, signal detail, onboarding steps, empty states | One hero element per screen (the key number, the top signal), soft gradient background, purposeful entrance motion |
| **Quiet** | Tables, settings, forms, admin, long lists, dense dashboards | Plain surfaces, minimal motion (state changes only), status color carries the signal |

Why: an app that is as loud as its landing page becomes exhausting to use daily, and a landing page as quiet as settings won't sell. Users should feel they're in the same product, not that every screen is shouting.

## 3. Core rules (apply at every volume)

- **Show, don't define.** Prefer a real number, a mini chart or a real ticket name over a sentence that describes it. No grey skeleton bars in finished designs.
- **One hero per view.** Every screen or section has one element that is clearly more important (bigger, bolder, or animated). Equal-weight grids are the main cause of "conservative" designs.
- **Color has meaning.** Blue = Steerloom/action/healthy flow. Orange = bottleneck/aging. Red = at risk. Never use warm colors decoratively. See `references/data-viz.md`.
- **Navy type, muted body.** Headings in ink-900 with tight tracking; body in ink-600; meta text ink-500.
- **Rounded and soft.** Large radii, soft layered shadows, translucent white cards on gradient backgrounds.
- **Numbers are first-class.** Display metrics in the display font, large, with tabular numerals, and count them up on first appearance (Loud/Focused only).
- **Honest copy.** Plain words, concrete outcomes, "X, not Y" contrast. See `references/voice.md`.
- **Accessible always.** Text contrast ≥ 4.5:1, never color alone for status (add icon or label), visible focus rings, `prefers-reduced-motion` respected.

## 4. Workflow

1. Identify the surface and its **volume** (section 2).
2. Read the references you need:
   - `references/tokens.md` — colors, type, spacing, radii, shadows, gradients (always read)
   - `references/components.md` — buttons, cards, bento tiles, signal cards, metrics, tabs, forms, tables, badges, empty states (read when building UI)
   - `references/motion.md` — easing, durations, choreography per volume (read when anything moves)
   - `references/data-viz.md` — status colors, charts, forecast visuals (read for any chart, metric or status)
   - `references/surfaces.md` — layout recipes for landing, briefing, dashboard, settings, onboarding, auth, emails (read for page-level work)
   - `references/voice.md` — copy rules and vocabulary (read whenever writing any text)
3. Reuse existing components before creating new ones. If a new pattern is needed, build it from tokens and describe it so it can be added to `components.md`.
4. Before finishing, run `references/review-checklist.md` and fix anything that fails.

## 5. When the request conflicts with the system

If someone asks for something off-system (a new color, a different font, a flashy effect on a quiet screen), do it if they insist, but say briefly which rule it breaks and offer the on-system alternative. Consistency is the goal, not rigidity.
