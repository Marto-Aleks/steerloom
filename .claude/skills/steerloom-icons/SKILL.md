---
name: steerloom-icons
description: Steerloom's icon system — how to audit, redesign, replace and animate icons so they match the Steerloom design system. Use this skill whenever a Steerloom task touches icons in any way, including "rework the icons", "these icons don't match", adding an icon to a button, nav item, signal card, feature tile, empty state, badge or the landing page, choosing an icon library, creating a new icon, or making icons animate. Use it together with steerloom-design-system, which defines the tokens.
---

# Steerloom icons

Icons must feel like they come from the same hand as the rest of Steerloom: soft, rounded, calm, and meaningful. Most icon inconsistency comes from mixing libraries, stroke weights and styles (3D blobs next to flat line icons next to emoji). This skill fixes that with **two families and strict rules**.

Read `steerloom-design-system` first for tokens; this skill only covers icons.

## The two families

| Family | What it is | Where |
|---|---|---|
| **UI icons** | Line icons, 24px grid, 1.75px stroke, round caps and joins, `currentColor` | Buttons, nav, inputs, menus, tables, inline text, badges |
| **Spot icons** | A 48px rounded tile (radius 14) with a status/brand gradient, soft top highlight and a white line glyph (2.25px stroke) | Signal cards, bento/metric tiles, feature points, empty states, onboarding, the trust section |

Never mix them in one role: all signal cards use spot icons, all nav items use UI icons, and so on. Never use 3D/clay renders, emoji, filled icons from a different library, or icons with their own multi-color palettes.

Full specs: `references/icon-spec.md`. Concept → icon mapping: `references/icon-map.md`. Ready-made spot icons: `assets/spot-icons.svg` (preview in `assets/preview.png`).

## Workflow for "rework the icons"

1. **Inventory.** Search the codebase for every icon: SVG files, inline `<svg>`, icon library imports (lucide, heroicons, phosphor, fontawesome, material, react-icons), emoji used as icons, and image icons (png/webp). List each with file, location, current style and role.
2. **Classify.** Mark each as UI or spot by its role (see table above). Flag mismatches: wrong family for the role, wrong stroke, wrong color, a different library, 3D/clay style, decorative status colors.
3. **Map.** Use `references/icon-map.md` so the same concept always gets the same icon everywhere. If a concept isn't listed, choose one, then add it to the map.
4. **Replace.**
   - UI icons: standardize on **one** library (default: Lucide, `strokeWidth={1.75}`, `size={20}` in UI, 16 inline). Remove every other icon library from dependencies when done.
   - Spot icons: use the sprite symbols from `assets/spot-icons.svg` or the `SpotIcon` component (spec in `icon-spec.md`). New spot icons are built from the same tile + a 24px glyph that follows the UI icon rules at 2.25px stroke.
5. **Gallery.** Create (or update) a dev-only icon gallery page (`/dev/icons` or a Storybook story) showing every icon in both families at all sizes, on light, gradient and dark backgrounds. This is how drift gets caught later.
6. **Verify.** Run the checklist at the bottom of `icon-spec.md` and show before/after screenshots or a summary table of what changed.

## Key rules (quick version)

- Status meaning comes from the **tile color**, never from a random icon color. At risk = risk gradient, Bottleneck/Aging = warn, Rework/features = blue, On track = ok, trust/infrastructure = ink.
- One concept = one icon. "Forecast" is always the calendar glyph, everywhere.
- Icons never carry meaning alone: always pair with a text label or `aria-label`.
- Decorative icons get `aria-hidden="true"`.
- Animate icons only where the motion rules allow it (see `icon-spec.md` → Motion). Quiet screens: no icon animation beyond hover color.
- The sprite must not be hidden with `display:none`, or its gradients disappear. Use the 0×0 absolute style already in the file.
