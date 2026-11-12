import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { UiIcon } from '../UiIcon'
import { GlassButton } from './GlassButton'

interface GlassModalProps {
  children: ReactNode
  className?: string
  description?: string
  open: boolean
  title: string
  onClose: () => void
}

export function GlassModal({
  children,
  className = '',
  description,
  open,
  title,
  onClose,
}: GlassModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className={`glass-modal ${className}`.trim()}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={() => {
        if (open) onClose()
      }}
    >
      <div className="glass-modal__surface">
        <header className="glass-modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <GlassButton
            variant="icon"
            size="compact"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <UiIcon icon={X} />
          </GlassButton>
        </header>
        <div className="glass-modal__body">{children}</div>
      </div>
    </dialog>
  )
}
