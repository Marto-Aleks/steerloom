import {
  AlarmClock,
  Calendar,
  ChartColumn,
  CircleCheck,
  CircleX,
  Cloud,
  Download,
  FileText,
  Funnel,
  Gauge,
  Hourglass,
  Kanban,
  Lock,
  MessageSquareText,
  Plug,
  Receipt,
  RotateCw,
  Server,
  ShieldCheck,
  Timer,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react'

/** Tile colour = meaning (icon-spec §2). */
export type SpotTone = 'risk' | 'warn' | 'info' | 'ok' | 'ink'

/**
 * Every spot icon in `src/assets/spot-icons.svg`, with its tile tone and the
 * matching Lucide glyph the soft (Quiet) variant draws. Keep in sync with
 * `.claude/skills/steerloom-icons/references/icon-map.md`.
 */
export const SPOT_ICONS = {
  // Status
  'at-risk': { tone: 'risk', glyph: AlarmClock, concept: 'At risk' },
  bottleneck: { tone: 'warn', glyph: Funnel, concept: 'Bottleneck' },
  aging: { tone: 'warn', glyph: Hourglass, concept: 'Aging work' },
  rework: { tone: 'info', glyph: RotateCw, concept: 'Rework' },
  'on-track': { tone: 'ok', glyph: CircleCheck, concept: 'On track / done' },
  attention: {
    tone: 'warn',
    glyph: TriangleAlert,
    concept: 'Needs a look (data checks)',
  },
  blocked: { tone: 'risk', glyph: CircleX, concept: 'Blocked' },
  // Metrics & features
  forecast: { tone: 'info', glyph: Calendar, concept: 'Forecast' },
  throughput: { tone: 'info', glyph: ChartColumn, concept: 'Throughput' },
  'cycle-time': { tone: 'info', glyph: Timer, concept: 'Cycle time' },
  'usual-limit': { tone: 'info', glyph: Gauge, concept: 'Usual limit (P85)' },
  briefing: { tone: 'info', glyph: FileText, concept: 'Briefing' },
  board: { tone: 'info', glyph: Kanban, concept: 'Board / flow' },
  assistant: {
    tone: 'info',
    glyph: MessageSquareText,
    concept: 'AI assistant',
  },
  team: { tone: 'info', glyph: Users, concept: 'Team' },
  download: { tone: 'info', glyph: Download, concept: 'Install / download' },
  // Trust & infrastructure
  'read-only': { tone: 'ink', glyph: Lock, concept: 'Read-only' },
  'shows-working': {
    tone: 'ink',
    glyph: Receipt,
    concept: 'Shows its working',
  },
  'runs-anywhere': {
    tone: 'ink',
    glyph: Server,
    concept: 'Runs anywhere / your computer',
  },
  cloud: { tone: 'ink', glyph: Cloud, concept: 'Hosted / cloud' },
  plug: { tone: 'ink', glyph: Plug, concept: 'Enterprise API' },
  secure: { tone: 'ink', glyph: ShieldCheck, concept: 'Data stays inside' },
} as const satisfies Record<
  string,
  { tone: SpotTone; glyph: LucideIcon; concept: string }
>

export type SpotName = keyof typeof SPOT_ICONS
