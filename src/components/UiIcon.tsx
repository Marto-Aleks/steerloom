import type { LucideIcon, LucideProps } from 'lucide-react'

/**
 * The one way to draw a UI icon: Lucide, 1.75 stroke, round caps, currentColor.
 * 20px in buttons, nav and menus; 16px inline. Decorative by default; the
 * surrounding control or text carries the meaning.
 */
export function UiIcon({
  icon: Icon,
  size = 20,
  ...props
}: { icon: LucideIcon; size?: number } & Omit<LucideProps, 'ref' | 'size'>) {
  return (
    <Icon
      size={size}
      strokeWidth={1.75}
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  )
}
