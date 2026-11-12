# Icon specifications

## Contents
1. UI icons
2. Spot icons
3. SpotIcon component
4. Sizes per context
5. Color rules
6. Motion
7. Drawing new glyphs
8. Checklist

---

## 1. UI icons

- Library: one only. Default **Lucide** (rounded strokes match the brand). If the codebase already standardized on another rounded line library, keep it and match these settings.
- Grid 24×24, stroke **1.75px**, `stroke-linecap: round`, `stroke-linejoin: round`, no fills (except tiny dots).
- Color: `currentColor`, inheriting text color. Default `--ink-500`; active/hover `--ink-900`; on primary buttons white; links `--blue-600`.
- Alignment: vertically centered with text; 8px gap to label (6px at 16px size).

## 2. Spot icons

Anatomy of a 48×48 tile:
1. Rounded rect, radius 14, vertical gradient (top lighter → bottom = the token `-600` color).
2. Soft highlight overlay: white 30% at the top fading to 0 at 55% height.
3. Inner edge: 1.5px white stroke at 18% opacity.
4. Glyph: white, centered 24×24 area (offset 12,12), stroke **2.25px**, round caps/joins.
5. Outside the tile (in CSS, not in the SVG): `filter: drop-shadow(0 6px 10px rgba(20,27,45,.16))` on Loud/Focused; no shadow on Quiet.

Gradients (keep in sync with tokens.css):

| Tile | Top | Bottom (`-600` token) | Used for |
|---|---|---|---|
| risk | #E5735C | #C2412D | At risk |
| warn | #EBA552 | #C46A24 | Bottleneck, Aging |
| info / brand | #5A98F2 | #2A62D4 | Rework, all product features, assistant |
| ok | #55BB8E | #2F8F66 | On track, done, success |
| ink | #5E6B86 | #2F3A50 | Trust & infrastructure (read-only, security, self-host, calculation) |

On the dark section, use the same tiles; they already have enough contrast.

### Soft variant (Quiet screens)
For tables and settings where a full gradient tile is too loud: 32px tile, radius 10, status `-100` background, glyph in status `-600`, stroke 2px, no highlight, no shadow.

## 3. SpotIcon component

Build one component so nobody hand-rolls tiles:

```tsx
type SpotTone = "risk" | "warn" | "info" | "ok" | "ink";
type SpotIconProps = {
  name: string;            // sprite id without "spot-", e.g. "at-risk"
  size?: 32 | 40 | 48 | 64; // default 48
  variant?: "solid" | "soft"; // soft = Quiet screens
  label?: string;          // if provided → role="img" + aria-label; else aria-hidden
  animate?: boolean;       // enables the icon's micro-motion (Loud/Focused only)
};
```

- Load the sprite once at the app root (inline it in the layout).
- Render `<svg width={size} height={size}><use href={`#spot-${name}`} /></svg>`.
- The soft variant can render the matching Lucide glyph on a tinted tile instead of using the sprite.

## 4. Sizes per context

| Context | Family | Size |
|---|---|---|
| Inline text, badges, table cells | UI | 16 |
| Buttons, inputs, menus, nav | UI | 20 |
| Page header actions | UI | 20–24 |
| Signal cards | Spot | 40–44 |
| Bento/metric tiles, feature points | Spot | 48 |
| Empty states, onboarding steps | Spot | 64 |
| Landing hero features | Spot | 56–64 |
| Settings/table status | Spot soft | 32 |

Never scale a glyph without the tile; never stretch icons non-proportionally.

## 5. Color rules

- Status colors only on status tiles or status badges. A clock icon on a neutral button stays ink, not red.
- Never color a UI icon with a status color unless it sits inside a status badge.
- Spot glyphs are always white (solid) or the status `-600` color (soft).
- Check contrast: white glyph on every tile bottom color passes 3:1 for graphics.

## 6. Motion

Follow steerloom-design-system `references/motion.md`. Icon micro-motions (Loud/Focused only, run once on first reveal or on hover):

| Icon | Motion |
|---|---|
| at-risk | clock hand sweeps 90° then settles; tile does a single soft ring pulse |
| bottleneck | a 3px dot drips through the funnel neck |
| aging | hourglass flips 180° (600ms, ease-in-out) |
| rework | loop rotates −360° (700ms, ease-out) |
| on-track | check draws in (stroke-dashoffset, 300ms) |
| forecast | dot on the calendar pops in last |
| read-only | lock shackle drops shut (4px, spring) |
| shows-working | receipt lines draw in, staggered 60ms |
| runs-anywhere | cloud and server cross-fade once |
| assistant | the two text lines type in |
| UI icons on hover | color change only; trailing arrows nudge 3px right |

Tile entrance: `pop` (scale 0.8 → 1, spring). Respect `prefers-reduced-motion` (no motion, final state).

## 7. Drawing new glyphs

- 24×24 grid with 2px padding (live area 20×20); optical center, not math center.
- Build from simple geometry: circles, rounded rects (radius 2.5–3), straight segments. Prefer open shapes.
- Corner radius on shapes ~3 at 24px; no sharp interior corners.
- Max 2–3 shapes per glyph. If it needs more detail to be understood, the concept needs a label, not a busier icon.
- Test at 16px (UI) and inside a 48px tile (spot) before shipping.
- Never redraw third-party brand logos; use official assets per their brand guidelines.

## 8. Checklist

- [ ] Only one UI icon library remains in dependencies
- [ ] Every icon is UI or spot according to its role; no 3D/clay/emoji icons left
- [ ] Same concept = same icon everywhere (matches icon-map.md)
- [ ] UI stroke 1.75, spot glyph stroke 2.25, round caps/joins
- [ ] Status tile colors match meaning; no decorative status colors
- [ ] Sizes match the size table
- [ ] Icons have labels or aria-label; decorative ones aria-hidden
- [ ] Sprite not hidden with display:none; gradients render
- [ ] Gallery page updated and reviewed on light, gradient and dark backgrounds
- [ ] Motion only on Loud/Focused; reduced-motion respected
