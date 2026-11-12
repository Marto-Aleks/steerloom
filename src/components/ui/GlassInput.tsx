import type { ComponentProps, SelectHTMLAttributes } from 'react'

export function GlassInput({
  className = '',
  ...props
}: ComponentProps<'input'>) {
  // React 19 passes ref through as a prop.
  return <input className={`glass-input ${className}`.trim()} {...props} />
}

export function GlassSelect({
  children,
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`glass-input glass-select ${className}`.trim()}
      {...props}
    >
      {children}
    </select>
  )
}
