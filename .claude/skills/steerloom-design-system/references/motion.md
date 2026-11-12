# Motion

Motion in Steerloom explains what changed or tells the product's story (problem forms → Steerloom resolves it). If an animation does neither, cut it.

## Fundamentals

- Entrances: `--ease-out`. Exits: `--ease-in`, about 70% of the entrance duration. Moves between states: `--ease-in-out`. Playful objects (task chips, dots): spring (stiffness ~260, damping ~22).
- Durations: `--dur-micro` hover/press, `--dur-ui` menus/tabs/tooltips, `--dur-panel` panel or page changes, `--dur-story` landing story beats. Nothing in the app exceeds 500ms.
- Stagger groups by `--stagger` (60ms); cap at ~8 items, then reveal the rest together.
- Animate `transform` and `opacity` only (plus SVG stroke-dashoffset for line draws).
- The payoff (number, date, verdict) always lands **last**.
- `prefers-reduced-motion`: replace movement with short fades; no autoplay, no count-ups (show final value).

## By volume

**Loud (marketing)**
- Scroll-triggered reveals, once per element (rise 16px + fade).
- Headline word-by-word reveal; counters count up; chart lines draw; story sequences (chips piling up, noise collapsing into signals, simulation dots stacking into a histogram).
- Ambient: gradient blobs drift slowly (20–30s loops, very low amplitude).
- Story tabs auto-advance with progress rail.

**Focused (briefing, forecast, onboarding, empty states)**
- First load: hero element enters first, then the rest staggers in.
- Hero metric counts up once per session, not on every visit.
- Signal cards stagger in; status top-border draws left→right.
- Forecast: marker travels along the track and settles on the selected confidence with a ring pulse.
- No ambient motion.

**Quiet (tables, settings, forms)**
- Only state feedback: hover, press, toggle, row expand, inline save confirmation (check icon fades in), toast in/out.
- Data updates: changed values flash `--blue-50` background for 600ms.
- No entrance animations on lists or tables.

## Reusable recipes

| Name | Spec |
|---|---|
| `rise-in` | opacity 0→1, translateY 16px→0, `--dur-story` (Loud) / `--dur-panel` (Focused), `--ease-out` |
| `pop` | scale 0.8→1 + opacity, `--dur-ui`, spring |
| `draw-line` | stroke-dashoffset length→0, 600ms `--ease-in-out` |
| `count-up` | 0→value over 900ms `--ease-out`, tabular numerals, final value exact |
| `panel-swap` | out: opacity→0 + scale 0.98, 200ms `--ease-in`; in: `rise-in` 400ms |
| `ring-pulse` | box-shadow ring expands 0→12px and fades once, 700ms |
| `lift` | hover translateY(-4px) + shadow step, `--dur-ui` |
| `flash-update` | background `--blue-50` → transparent, 600ms |

## Implementation

- React: Framer Motion (`whileInView`, `viewport={{ once: true, amount: 0.4 }}`), shared variants exported from one `motion.ts` file using the token values.
- Plain HTML: CSS transitions/keyframes driven by an IntersectionObserver that adds `.is-visible`.
- Keep all timing constants in one place so the whole app can be tuned together.
