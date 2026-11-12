# Data visualization & status

Steerloom's product is numbers, so charts must look like they belong to the landing page illustrations: soft, rounded, generous, and honest.

## Status vocabulary (identical everywhere)

| Status | Color | Icon | Meaning |
|---|---|---|---|
| At risk | `--risk-600` / `--risk-100` | clock | Likely to miss a date or already past the usual limit by a lot |
| Bottleneck | `--warn-600` / `--warn-100` | funnel | A stage collecting more work than it finishes |
| Aging | `--warn-400` | hourglass | Active item past the usual limit (P85) |
| Rework | `--blue-600` / `--blue-100` | loop arrow | Item left the flow and came back |
| On track | `--ok-600` / `--ok-100` | check | Within usual limits |

Rules: always pair color with icon or label; healthy flow is blue (not green) in board visuals, green is reserved for explicit "on track/done" verdicts.

## Metric definitions (use these exact names)

Throughput (items finished per week) · Cycle time (time in measured stages) · Usual limit (P85) · Aging work · Rework · Forecast (finish dates at 50/70/85/95% confidence from 10,000 simulations).

## Chart style

- Bars: rounded tops (radius 6px), `--blue-500`, 60–70% bar width, gentle gradient optional. Highlighted bar `--blue-600`; problem bars in warn/risk.
- Lines: 2.5px, rounded caps and joins, soft area fill at 12% opacity.
- Gridlines: horizontal only, `--line`, dashed or very light. No chart borders.
- Axis labels `--text-xs` `--ink-500`; values tabular.
- Reference lines (usual limit, today): dashed 1.5px `--ink-300` with a small label pill.
- Annotate the insight directly on the chart ("Review is holding 6 items") instead of making users read a legend.
- Tooltips: white card, `--radius-md`, `--shadow-lg`, value in display font.

## Signature visuals

- **Kanban pile-up:** columns of glossy task chips; aging chips shift blue → orange. Used for flow/bottleneck stories.
- **Forecast track:** "Today" dot → track with 50/70/85/95% markers, selected confidence highlighted with ring; date shown large ("85% likely by Nov 14"). Always state the confidence level with a date; never show a single date alone.
- **Distribution with P85:** histogram of cycle times with the 85% area shaded `--blue-100` and a dashed limit line.
- **Simulation histogram:** dots stacking into columns (Loud only for the animation; static version in the app).

## Honesty rules

- Never truncate a y-axis on bar charts.
- Show sample size or time range near every metric ("Based on 12 weeks").
- Forecasts are ranges with confidence, not promises.
- Every chart and metric can show "How this is calculated".
