# Concept → icon map

One concept, one icon, everywhere. Add new rows when a new concept appears; never pick a different icon for an existing concept.

Lucide names are given for UI icons; sprite ids for spot icons.

## Status
| Concept | Spot (tone) | UI (Lucide) |
|---|---|---|
| At risk | `spot-at-risk` (risk) | `alarm-clock` |
| Bottleneck | `spot-bottleneck` (warn) | `funnel` |
| Aging work | `spot-aging` (warn) | `hourglass` |
| Rework | `spot-rework` (info) | `rotate-cw` |
| On track / done | `spot-on-track` (ok) | `circle-check` |
| Needs a look (data checks, warning) | `spot-attention` (warn) | `triangle-alert` |
| Blocked / error | `spot-blocked` (risk) | `circle-x` |

## Metrics & features
| Concept | Spot (tone) | UI (Lucide) |
|---|---|---|
| Forecast | `spot-forecast` (info) | `calendar` |
| Throughput | `spot-throughput` (info) | `chart-column` |
| Cycle time | `spot-cycle-time` (info) | `timer` |
| Usual limit (P85) | `spot-usual-limit` (info) | `gauge` |
| Briefing / reports | `spot-briefing` (info) | `file-text` |
| Board / flow | `spot-board` (info) | `kanban` |
| AI assistant | `spot-assistant` (info) | `message-square-text` |
| Team | `spot-team` (info) | `users` |
| Install / download | `spot-download` (info) | `download` |

## Trust & infrastructure
| Concept | Spot (tone) | UI (Lucide) |
|---|---|---|
| Read-only | `spot-read-only` (ink) | `lock` |
| Shows its working / calculation | `spot-shows-working` (ink) | `receipt` |
| Runs anywhere / self-host / your computer | `spot-runs-anywhere` (ink) | `server` |
| Cloud / hosted | `spot-cloud` (ink) | `cloud` |
| Enterprise API | `spot-plug` (ink) | `plug` |
| Data stays inside / security | `spot-secure` (ink) | `shield-check` |

## Common UI actions
| Action | Lucide |
|---|---|
| Settings | `settings` |
| Connect / integration | `plug` |
| Export / download | `download` |
| Share | `share-2` |
| Filter | `sliders-horizontal` (not `funnel`, which means Bottleneck) |
| Search | `search` |
| Info / how calculated | `info` |
| Close | `x` |
| Next / link arrow | `arrow-right` |
| More | `ellipsis` |
| Refresh / sync | `refresh-cw` (not `rotate-cw`, which means Rework) |
| Team | `users` |
| Notification | `bell` |
| Workspace (home tab) | `layout-grid` |
| Back | `arrow-left` |
| Opens in a new tab | `external-link` |
| Disclosure / select | `chevron-down` (rotates 180° when open); collapsed section `chevron-right` |
| Selected / step done | `check` |
| Success / saved | `circle-check` |
| Warning | `triangle-alert` |
| Error | `circle-x` |
| Progress step to do / current | `circle` / `circle-dot` |
| Trend up / down / flat | `arrow-up` / `arrow-down` / `move-right` |
| Minimize | `minus` |
| Add | `plus` |
| Light / dark appearance | `sun` / `moon` |
| Play / pause | `play` / `pause` |
| Replay animation | `rotate-ccw` (counter-clockwise; `rotate-cw` stays Rework) |

Note the deliberate exclusions: the funnel and rotate icons are reserved for their status meanings, so generic actions use different icons to avoid confusion.

In code: UI icons go through `UiIcon` (`src/components/UiIcon.tsx`); spot icons through `SpotIcon` (`src/components/SpotIcon.tsx`, registry in `src/components/spot-icons.ts`, sprite in `src/assets/spot-icons.svg`). Dev gallery: `/?review=icons`.

Lucide renames icons occasionally; if a name doesn't exist in the installed version, pick the closest current equivalent and update this table.
