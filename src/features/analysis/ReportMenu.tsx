import { useEffect, useId, useRef, useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'

export interface ReportMenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
}

/** One quiet "More" (ellipsis) button holding the report's secondary actions. */
export function ReportMenu({ items }: { items: ReportMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
        setOpen(false)
        buttonRef.current?.focus()
        return
      }
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    rootRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus()
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div className="report-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="report-menu__button"
        aria-label="Report options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <UiIcon icon={Ellipsis} />
      </button>
      {open && (
        <div className="report-menu__list" role="menu" id={menuId}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
