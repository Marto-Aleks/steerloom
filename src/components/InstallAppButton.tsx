import { useEffect, useState } from 'react'
import { AppWindow } from 'lucide-react'
import { UiIcon } from './UiIcon'

/*
 * "Install app": shown only when the browser offers to install Steerloom
 * (Chrome and Edge fire beforeinstallprompt) and it is not already running
 * as an installed app. Installing gives a Dock or taskbar icon and its own
 * window. Safari users use File → Add to Dock instead.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallAppButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)

  useEffect(() => {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return
    const offer = (event: Event) => {
      event.preventDefault()
      setPrompt(event as InstallPromptEvent)
    }
    const installed = () => setPrompt(null)
    window.addEventListener('beforeinstallprompt', offer)
    window.addEventListener('appinstalled', installed)
    return () => {
      window.removeEventListener('beforeinstallprompt', offer)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])

  if (!prompt) return null
  return (
    <button
      type="button"
      className="feedback-pill"
      aria-label="Install app"
      onClick={() => {
        void prompt.prompt()
        void prompt.userChoice.finally(() => setPrompt(null))
      }}
    >
      <UiIcon icon={AppWindow} size={16} />
      <span className="feedback-pill__label">Install app</span>
    </button>
  )
}
