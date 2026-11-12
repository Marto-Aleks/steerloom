import { useState } from 'react'
import { Check, Copy, MonitorSmartphone, Send } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'

/*
 * Steerloom installs on a computer, but most people first meet this page on
 * a phone. This card, shown only there, sends the page to themselves: the
 * phone's own share sheet (AirDrop, mail, messages, notes), or an email
 * where the browser has none, and a link to copy.
 */
const PAGE = '/?hosted=1&page=local'
const TITLE = 'Steerloom on your computer'
const TEXT = 'Install Steerloom on your computer with one command:'

function onPhone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    !!window.matchMedia?.('(pointer: coarse) and (max-width: 48rem)').matches ||
    /iPhone|iPod|Android.+Mobile/.test(navigator.userAgent ?? '')
  )
}

export function SendToComputer({ force = false }: { force?: boolean }) {
  const [phone] = useState(() => force || onPhone())
  const [copied, setCopied] = useState(false)
  if (!phone) return null
  const url = `${window.location.origin}${PAGE}`
  const canShare = typeof navigator.share === 'function'
  return (
    <section className="lp-send lp-glass" aria-labelledby="local-send-title">
      <span className="lp-send__icon" aria-hidden="true">
        <UiIcon icon={MonitorSmartphone} size={24} />
      </span>
      <div className="lp-send__copy">
        <h2 id="local-send-title">On your phone?</h2>
        <p>Steerloom installs on a computer. Send yourself this page.</p>
      </div>
      <div className="lp-send__actions">
        {canShare ? (
          <button
            type="button"
            className="lp-btn lp-btn--primary"
            onClick={() => {
              // Closing the share sheet rejects; that is not an error.
              navigator
                .share({ title: TITLE, text: TEXT, url })
                .catch(() => undefined)
            }}
          >
            <UiIcon icon={Send} size={16} /> Send to my computer
          </button>
        ) : (
          <a
            className="lp-btn lp-btn--primary"
            href={`mailto:?subject=${encodeURIComponent(TITLE)}&body=${encodeURIComponent(`${TEXT}\n${url}`)}`}
          >
            <UiIcon icon={Send} size={16} /> Email it to myself
          </a>
        )}
        <button
          type="button"
          className="lp-btn lp-btn--quiet"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(url)
              .then(() => setCopied(true))
              .catch(() => undefined)
          }}
        >
          <UiIcon icon={copied ? Check : Copy} size={16} />{' '}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </section>
  )
}
