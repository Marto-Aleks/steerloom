import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { UiIcon } from '../../../components/UiIcon'
import { track } from '../../../lib/usage/track'

/*
 * The film in a modal player. Opens from the film card, plays with sound
 * (the click is the gesture), captions available from the native controls,
 * closes on Escape, the close button or a click outside. Focus stays inside
 * while it is open and returns to the opener afterwards. The video element
 * only exists while the player is open, so nothing loads before then.
 */

const BASE = import.meta.env.BASE_URL
export const FILM_MP4 = `${BASE}video/loomy-film-6.mp4`
export const FILM_CAPTIONS = `${BASE}video/loomy-film-6.vtt`
/** The 9:16 cut for phones held upright; its captions are burned in. */
export const FILM_VERTICAL_MP4 = `${BASE}video/loomy-film-6-vertical.mp4`

/** Phones held upright get the vertical cut, which fills the screen. */
function wantsVerticalFilm(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(max-width: 640px) and (orientation: portrait)')
      .matches === true
  )
}

const FOCUSABLE =
  'button, [href], video, input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function FilmPlayer({
  opener,
  onClose,
}: {
  /** The element that opened the player; null while closed. */
  opener: HTMLElement | null
  onClose: () => void
}) {
  const open = opener !== null
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!opener) return
    track('film_played')
    closeRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const items = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ]
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      opener.focus()
    }
  }, [opener, onClose])

  if (!open) return null
  const vertical = wantsVerticalFilm()
  return (
    <div
      className="film-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className={`film-modal__dialog${vertical ? ' film-modal__dialog--vertical' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Steerloom, the film"
      >
        <button
          ref={closeRef}
          type="button"
          className="film-modal__close"
          onClick={onClose}
          aria-label="Close the film"
        >
          <UiIcon icon={X} size={20} />
        </button>
        <video
          className="film-modal__video"
          controls
          autoPlay
          playsInline
          preload="auto"
          onEnded={onClose}
        >
          <source
            src={vertical ? FILM_VERTICAL_MP4 : FILM_MP4}
            type="video/mp4"
          />
          {!vertical && (
            <track
              kind="captions"
              srcLang="en"
              label="English"
              src={FILM_CAPTIONS}
            />
          )}
        </video>
      </div>
    </div>
  )
}
