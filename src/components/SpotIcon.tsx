import type { CSSProperties } from 'react'
import sprite from '../assets/spot-icons.svg?raw'
import { SPOT_ICONS, type SpotName } from './spot-icons'

export type SpotIconSize = 24 | 32 | 40 | 44 | 48 | 56 | 64

export interface SpotIconProps {
  /** Sprite id without "spot-", e.g. "at-risk". */
  name: SpotName
  /** 24 in compact panel headers, 40–44 signal cards, 48 tiles and feature
   * points, 64 empty states. */
  size?: SpotIconSize
  /** "soft" = Quiet screens: tinted tile, status-coloured glyph, no shadow. */
  variant?: 'solid' | 'soft'
  /** Gives the icon a name (role="img"); without it the icon is decorative. */
  label?: string
  /** Pops the tile in once (Loud/Focused screens only). */
  animate?: boolean
  className?: string
  style?: CSSProperties
  /** Position when drawn inside another SVG. */
  x?: number | string
  y?: number | string
}

/**
 * A Steerloom spot icon: status/brand gradient tile with a white glyph,
 * drawn from the sprite that `SpotIconSprite` puts on the page once.
 */
export function SpotIcon({
  name,
  size = 48,
  variant = 'solid',
  label,
  animate = false,
  className,
  style,
  x,
  y,
}: SpotIconProps) {
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const)
  const classes = [
    'spot-icon',
    `spot-icon--${variant}`,
    animate ? 'spot-icon--pop' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (variant === 'soft') {
    const { tone, glyph: Glyph } = SPOT_ICONS[name]
    return (
      <span
        className={classes}
        data-tone={tone}
        data-spot={name}
        style={{ '--spot-size': `${size}px`, ...style } as CSSProperties}
        {...a11y}
      >
        <Glyph
          size={Math.round(size * 0.5625)}
          strokeWidth={2}
          aria-hidden="true"
          focusable="false"
        />
      </span>
    )
  }

  return (
    <svg
      className={classes}
      data-spot={name}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      x={x}
      y={y}
      focusable="false"
      style={style}
      {...a11y}
    >
      <use href={`#spot-${name}`} />
    </svg>
  )
}

/**
 * The spot-icon sprite, inlined once per page at the app root. It stays in
 * the layout at 0×0: `display: none` would stop its gradients rendering.
 */
export function SpotIconSprite() {
  return (
    <div
      className="spot-icon-sprite"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: sprite }}
    />
  )
}
