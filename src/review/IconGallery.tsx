import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDot,
  CircleX,
  CornerDownLeft,
  Download,
  Ellipsis,
  ExternalLink,
  FileArchive,
  FileText,
  Folder,
  Globe,
  Info,
  LayoutGrid,
  Lock,
  MessageSquareText,
  Minus,
  Moon,
  MousePointer2,
  MoveRight,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  SquareTerminal,
  Sun,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react'
import { SpotIcon, type SpotIconSize } from '../components/SpotIcon'
import { SPOT_ICONS, type SpotName } from '../components/spot-icons'
import { UiIcon } from '../components/UiIcon'
import { Wordmark } from '../components/Wordmark'
import './review.css'

/** Every UI icon the app draws, with the one meaning it carries. */
const UI_ICONS: ReadonlyArray<{ icon: LucideIcon; name: string; use: string }> =
  [
    { icon: LayoutGrid, name: 'layout-grid', use: 'Workspace tab' },
    { icon: FileText, name: 'file-text', use: 'Briefing (Dashboard tab)' },
    { icon: Moon, name: 'moon', use: 'Switch to dark' },
    { icon: Sun, name: 'sun', use: 'Switch to light' },
    { icon: Ellipsis, name: 'ellipsis', use: 'More (report options)' },
    { icon: MessageSquareText, name: 'message-square-text', use: 'AI chat' },
    { icon: Minus, name: 'minus', use: 'Minimize' },
    { icon: X, name: 'x', use: 'Close' },
    { icon: Plus, name: 'plus', use: 'Add (connect another board)' },
    { icon: Lock, name: 'lock', use: 'Read-only' },
    { icon: ArrowRight, name: 'arrow-right', use: 'Next / go' },
    { icon: ArrowLeft, name: 'arrow-left', use: 'Back' },
    { icon: ExternalLink, name: 'external-link', use: 'Opens in a new tab' },
    { icon: ChevronDown, name: 'chevron-down', use: 'Disclosure, select' },
    { icon: ChevronRight, name: 'chevron-right', use: 'Collapsed section' },
    { icon: Check, name: 'check', use: 'Selected / step done' },
    { icon: CircleCheck, name: 'circle-check', use: 'Success, saved' },
    { icon: TriangleAlert, name: 'triangle-alert', use: 'Warning' },
    { icon: CircleX, name: 'circle-x', use: 'Error' },
    { icon: Info, name: 'info', use: 'Info' },
    { icon: Circle, name: 'circle', use: 'Progress: to do' },
    { icon: CircleDot, name: 'circle-dot', use: 'Progress: current' },
    { icon: ArrowUp, name: 'arrow-up', use: 'Trend up' },
    { icon: ArrowDown, name: 'arrow-down', use: 'Trend down' },
    { icon: MoveRight, name: 'move-right', use: 'Trend flat' },
    { icon: Play, name: 'play', use: 'Play walkthrough' },
    { icon: Pause, name: 'pause', use: 'Pause walkthrough' },
    { icon: RotateCcw, name: 'rotate-ccw', use: 'Replay animation' },
    { icon: Download, name: 'download', use: 'Download (setup demo)' },
    { icon: Search, name: 'search', use: 'Search (setup demo)' },
    { icon: SquareTerminal, name: 'square-terminal', use: 'Terminal (demo)' },
    { icon: CornerDownLeft, name: 'corner-down-left', use: 'Return (demo)' },
    { icon: FileArchive, name: 'file-archive', use: 'Package (demo)' },
    { icon: Folder, name: 'folder', use: 'Files (demo dock)' },
    { icon: Globe, name: 'globe', use: 'Browser (demo dock)' },
    { icon: MousePointer2, name: 'mouse-pointer-2', use: 'Pointer (demo)' },
  ]

const SPOT_NAMES = Object.keys(SPOT_ICONS) as SpotName[]
const SOLID_SIZES: SpotIconSize[] = [32, 40, 48, 64]
const BACKGROUNDS = [
  { id: 'light', label: 'Light' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'dark', label: 'Dark' },
] as const

/**
 * Development-only icon gallery (`/?review=icons`): every UI icon and every
 * spot icon at each size, on light, gradient and dark backgrounds, so drift
 * is easy to see.
 */
export function IconGallery() {
  return (
    <main className="review-index icon-gallery" id="main-content">
      <header className="review-index__head">
        <Wordmark />
        <h1>Steerloom icon gallery</h1>
        <p>
          Two families only. UI icons: Lucide, 1.75 stroke, currentColor, 20px
          in controls and 16px inline. Spot icons: gradient tiles whose colour
          carries the meaning; the soft variant is for Quiet screens.{' '}
          <a href="/?review">All screens</a>
        </p>
      </header>

      {BACKGROUNDS.map((background) => (
        <section
          key={background.id}
          className="icon-gallery__panel"
          data-background={background.id}
          aria-labelledby={`icons-${background.id}`}
        >
          <h2 id={`icons-${background.id}`}>{background.label}</h2>

          <h3>UI icons · 20px and 16px</h3>
          <ul className="icon-gallery__ui">
            {UI_ICONS.map(({ icon, name, use }) => (
              <li key={name}>
                <span className="icon-gallery__ui-sizes">
                  <UiIcon icon={icon} />
                  <UiIcon icon={icon} size={16} />
                </span>
                <code>{name}</code>
                <span>{use}</span>
              </li>
            ))}
          </ul>

          <h3>Spot icons · solid 32 / 40 / 48 / 64 and soft 32</h3>
          <ul className="icon-gallery__spots">
            {SPOT_NAMES.map((name) => (
              <li key={name}>
                <span className="icon-gallery__spot-sizes">
                  {SOLID_SIZES.map((size) => (
                    <SpotIcon key={size} name={name} size={size} />
                  ))}
                  <SpotIcon name={name} size={32} variant="soft" />
                </span>
                <code>spot-{name}</code>
                <span>
                  {SPOT_ICONS[name].concept} · {SPOT_ICONS[name].tone}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
