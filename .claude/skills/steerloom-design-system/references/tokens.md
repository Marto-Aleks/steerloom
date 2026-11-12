# Tokens: how to use them

The values live in `assets/tokens.css`. This file explains **when** to use each one.

## Color

- **Backgrounds.** Page = `--gradient-page`. Cards on top = `--surface` (translucent white) with `--shadow-md` or `--shadow-lg`. Inner wells and table headers = `--surface-sunken`. Quiet screens may use flat `--bg-base` instead of the gradient.
- **Text.** Headings and key numbers `--ink-900`. Body `--ink-600`. Captions, meta, inactive tabs `--ink-500`. Never use pure black.
- **Action.** All primary actions, links, selected states and focus rings use the blue scale. There is only one accent color; do not introduce a second brand color.
- **Status.** `--risk-*` (at risk), `--warn-*` (bottleneck, aging), `--ok-*` (on track), blue (rework/info). Only for meaning. Full rules in `data-viz.md`.
- **Dark section.** `--dark-*` only for one contrast section per marketing page (usually trust/security) or a dark CTA. Not used in the app.

## Typography

| Role | Font | Size token | Weight | Tracking |
|---|---|---|---|---|
| Landing H1 | display | `--text-hero` | 800 | `--tracking-display` |
| Page / section title | display | `--text-h1` | 750–800 | `--tracking-display` |
| Subsection | display | `--text-h2` | 700 | `--tracking-heading` |
| Card title | display | `--text-h3` | 700 | `--tracking-heading` |
| Metric (hero) | display | `--text-metric-xl` | 800, tabular-nums | `--tracking-display` |
| Lead paragraph | body | `--text-lead` | 400, `--ink-600` | 0 |
| Body | body | `--text-body` | 400 | 0 |
| Label / meta | body | `--text-sm` / `--text-xs` | 500–600 | 0 (uppercase labels +0.06em) |

- Headings ≥ 2.5× body size on Loud screens; ≥ 1.75× on Focused; Quiet screens can go smaller but keep the display font for titles.
- Body line length ≤ `--prose-max`.
- Always `font-variant-numeric: tabular-nums` for numbers in tables, metrics and charts.

## Spacing

- 4px grid only. Prefer the named steps.
- Section spacing: `--section-gap-loud` on marketing, `--section-gap-app` in product.
- Card padding: 32px (Loud), 24px (Focused), 16–20px (Quiet).
- Generous whitespace is part of the brand. When in doubt, add space rather than borders.

## Radii

- `--radius-xl` showcase panels and CTA card → `--radius-lg` cards and tiles → `--radius-md` inputs, menus, nested cards → `--radius-sm` buttons, chips → `--radius-pill` badges, tabs, toggles.
- Nested elements always have a smaller radius than their container.

## Shadows

- Resting card `--shadow-md`; elevated/hero card `--shadow-lg`; hover adds 4px lift and moves one shadow step up.
- Primary button `--shadow-button`.
- Active/selected item (like the active tab on the landing page): white surface + `--ring-active` outline.
