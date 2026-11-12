import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Lock,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react'
import { SpotIcon } from '../../components/SpotIcon'
import { UiIcon } from '../../components/UiIcon'
import { readJsonBody } from '../../lib/progress'
import { LocalFlow } from './local/LocalFlow'
import { SendToComputer } from './SendToComputer'
import { SetupDesktopScene } from './SetupDesktopScene'

export function ConnectionIllustration({ mode }: { mode: 'hosted' | 'local' }) {
  const local = mode === 'local'
  return (
    <span className="connection-story">
      <svg
        viewBox="0 0 440 170"
        role="img"
        aria-label={
          local
            ? 'Your company board connects to Steerloom running on your computer. Reports open in your browser.'
            : 'Your boards connect to a hosted Steerloom workspace. Your briefing opens in any browser.'
        }
      >
        <rect
          className="connection-story__boundary"
          x="8"
          y="12"
          width="424"
          height="146"
          rx="20"
        />
        <path className="connection-story__line" d="M106 84H176M264 84H334" />
        <circle className="connection-story__packet" r="4" cx="130" cy="84" />
        <circle
          className="connection-story__packet connection-story__packet--second"
          r="4"
          cx="290"
          cy="84"
        />
        <SpotIcon name="board" size={64} x={35} y={52} />
        <SpotIcon
          name={local ? 'runs-anywhere' : 'cloud'}
          size={64}
          x={188}
          y={52}
        />
        <SpotIcon name="briefing" size={64} x={341} y={52} />
        <text x="67" y="136">
          {local ? 'Company board' : 'Your boards'}
        </text>
        <text x="220" y="136">
          {local ? 'Your computer' : 'Steerloom online'}
        </text>
        <text x="373" y="136">
          {local ? 'Your reports' : 'Your briefing'}
        </text>
      </svg>
      <span className="connection-story__caption">
        {local
          ? 'Analysis runs on your computer. No board data is sent to the hosted workspace.'
          : 'A private workspace online. Open it from any browser.'}
      </span>
    </span>
  )
}

/* The walkthrough has four illustrated scenes of 70 ticks (100 ms each).
 * Scenes 1 and 2 (find the command window, run the commands) belong to the
 * same setup step, so three steps are shown to the reader. */
const SCENE_TICKS = 70
const END = SCENE_TICKS * 4 - 1
const stepStart = [0, SCENE_TICKS, SCENE_TICKS * 3]
const sceneToStep = [0, 1, 1, 2]

function downloadHref(productionHosted: boolean) {
  return productionHosted ? '/api/hosted/download/local' : '#local-title'
}

type InstallPlatform = 'unix' | 'windows'

const installCopy: Record<
  InstallPlatform,
  {
    label: string
    lead: string
    placeholder: string
    next: string
  }
> = {
  unix: {
    label: 'macOS / Linux',
    lead: 'Open Terminal (Command + Space, type Terminal), paste this and press Return. It sets everything up and opens Steerloom in its own window.',
    placeholder:
      'curl -fsSL "https://steerloom.app/api/hosted/install.sh?t=…" | sh',
    next: 'open Steerloom from Launchpad or Spotlight (on Linux, from your applications menu)',
  },
  windows: {
    label: 'Windows 10 / 11',
    lead: 'Open Start, type PowerShell and press Enter. Paste this and press Enter. It sets everything up and opens Steerloom in its own window.',
    placeholder: 'irm "https://steerloom.app/api/hosted/install.ps1?t=…" | iex',
    next: 'open Steerloom from the Start menu or your desktop',
  },
}

function defaultInstallPlatform(): InstallPlatform {
  return typeof navigator !== 'undefined' &&
    navigator.userAgent?.includes('Windows')
    ? 'windows'
    : 'unix'
}

/**
 * One command for macOS, Linux (sh) and Windows (PowerShell): installs
 * Node.js if needed, downloads the prebuilt app, adds a Steerloom icon
 * (Applications, applications menu, Start menu and desktop) and opens it. The command
 * carries a 30-minute link; no account is needed.
 */
function OneCommandInstall({
  productionHosted,
}: {
  productionHosted: boolean
}) {
  const [platform, setPlatform] = useState(defaultInstallPlatform)
  const [commands, setCommands] = useState<Record<InstallPlatform, string>>({
    unix: '',
    windows: '',
  })
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!productionHosted) return
    const controller = new AbortController()
    fetch('/api/hosted/download/install-command', {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = await readJsonBody<{
          command?: string
          windowsCommand?: string
          error?: string
        }>(response)
        if (!response.ok || !value.command)
          throw new Error(
            value.error ??
              'We couldn’t create your install command. Reload the page to try again.',
          )
        setCommands({
          unix: value.command,
          windows: value.windowsCommand ?? '',
        })
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : 'We couldn’t load your install command. Reload the page to try again.',
          )
      })
    return () => controller.abort()
  }, [productionHosted])
  const copy = installCopy[platform]
  const command = commands[platform]
  return (
    <section
      className="lp-install lp-glass"
      id="local-steps"
      aria-labelledby="local-install-title"
    >
      <div className="lp-install__head">
        <div className="lp-seg" role="group" aria-label="Install on">
          {(['unix', 'windows'] as const).map((os) => (
            <button
              key={os}
              type="button"
              aria-pressed={platform === os}
              onClick={() => {
                setPlatform(os)
                setCopied(false)
              }}
            >
              {installCopy[os].label}
            </button>
          ))}
        </div>
      </div>
      <span className="lp-install__blob" aria-hidden="true" />
      <h2 id="local-install-title">Install with one command</h2>
      <p className="lp-install__lead">{copy.lead}</p>
      <div className="lp-install__command">
        <code>{command || copy.placeholder}</code>
        <button
          type="button"
          className="lp-btn lp-btn--primary"
          disabled={!command}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(command)
              .then(() => setCopied(true))
              .catch(() => undefined)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {error && <p className="lp-install__note">{error}</p>}
      <ul className="lp-install__facts">
        {[
          'Installs into a Steerloom folder in your home folder',
          'Adds a Steerloom icon you can open like any app',
          'Adds Node.js just for Steerloom if yours is missing or old',
          'No admin rights needed',
          'The command works for 30 minutes',
        ].map((fact) => (
          <li key={fact}>
            <UiIcon icon={Check} size={16} />
            {fact}
          </li>
        ))}
      </ul>
      <p className="lp-install__note">
        Next time, {copy.next}. Running the command again updates Steerloom and
        keeps your data.
        {productionHosted && (
          <>
            {' '}
            By installing, you agree to the <a href="/terms.html">Terms</a>.
          </>
        )}
      </p>
      {productionHosted && <KeepPosted />}
    </section>
  )
}

/**
 * Optional: an address to hear about updates or help shape Steerloom. No
 * account is needed for the local version, so this is the only way to know
 * who is trying it. Sent as feedback, never required.
 */
function KeepPosted() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setState('sending')
    setError('')
    fetch('/api/hosted/feedback', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        kind: 'idea',
        message: 'Keep me posted about the local version.',
        email: email.trim(),
        page: `${window.location.pathname}${window.location.search}`,
      }),
    })
      .then(async (response) => {
        const value = await readJsonBody<{ error?: string }>(response)
        if (!response.ok)
          throw new Error(value.error ?? 'That didn’t send. Try again.')
        setState('sent')
      })
      .catch((caught: unknown) => {
        setState('idle')
        setError(
          caught instanceof Error
            ? caught.message
            : 'That didn’t send. Try again.',
        )
      })
  }
  if (state === 'sent')
    return (
      <p className="lp-keep__done" role="status">
        <UiIcon icon={Check} size={16} />
        Thanks. We’ll write when there’s something worth knowing.
      </p>
    )
  return (
    <form className="lp-keep" onSubmit={submit}>
      <label htmlFor="lp-keep-email">
        Want to hear about updates, or help shape Steerloom? Leave your email.
        Optional.
      </label>
      <div className="lp-keep__row">
        <input
          id="lp-keep-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button
          type="submit"
          className="lp-btn lp-btn--quiet"
          disabled={state === 'sending'}
        >
          {state === 'sending' ? 'Sending…' : 'Keep me posted'}
        </button>
      </div>
      {error && <p className="lp-install__note">{error}</p>}
    </form>
  )
}

function SetupSteps({ productionHosted }: { productionHosted: boolean }) {
  const [platform, setPlatform] = useState<'mac' | 'windows'>('mac')
  const [playRequested, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [copied, setCopied] = useState('')
  const [reducedMotion] = useState(
    () =>
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  const mac = platform === 'mac'
  const playing = playRequested && progress < END
  const shell = mac ? 'Terminal' : 'PowerShell'
  const enter = mac ? 'Return' : 'Enter'
  const commands = mac
    ? [
        'cd ~/Downloads',
        'tar -xzf steerloom-local.tar.gz',
        'cd steerloom-local',
        'node server.mjs --open',
      ]
    : [
        'cd "$HOME\\Downloads"',
        'tar -xzf .\\steerloom-local.tar.gz',
        'cd .\\steerloom-local',
        'node server.mjs --open',
      ]
  const steps = [
    {
      title: 'Install Node.js and download',
      body: (
        <>
          Install{' '}
          <a
            href="https://nodejs.org/en/download"
            target="_blank"
            rel="noreferrer"
          >
            Node.js 22 or newer
          </a>{' '}
          with the {mac ? 'macOS' : 'Windows'} installer. Download the{' '}
          <a
            href={downloadHref(productionHosted)}
            download={productionHosted || undefined}
          >
            Steerloom package
          </a>{' '}
          and save it in Downloads, then unpack it.
        </>
      ),
      commands: commands.slice(0, 2),
    },
    {
      title: 'Start Steerloom',
      body: mac
        ? 'Press Command + Space, type Terminal and press Return. Paste one command at a time and let each finish.'
        : 'Open Start, type PowerShell and press Enter. Paste one command at a time and let each finish.',
      commands: commands.slice(2),
    },
    {
      title: 'Open your workspace',
      body: 'Steerloom opens at the address below. Create a local account, then try the fictional sample report or connect your Jira with a read-only token. Keep the command window open while you work.',
      commands: ['http://127.0.0.1:5173/'],
    },
  ]
  const scene = Math.min(3, Math.floor(progress / SCENE_TICKS))
  const stepIndex = sceneToStep[scene] ?? 0
  const current = steps[stepIndex] ?? steps[0]!
  const screen = [
    'Install Node.js & download Steerloom',
    mac ? 'Spotlight search' : 'Windows search',
    shell,
    'Your browser',
  ][scene]
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setProgress((value) => Math.min(value + 1, END))
    }, 100)
    return () => window.clearInterval(timer)
  }, [playing])
  function seek(value: number) {
    setProgress(value)
    setPlaying(false)
  }
  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(`Copied: ${command}`)
    } catch {
      setCopied('Select the command and copy it using your keyboard.')
    }
  }
  let commandNumber = 0
  return (
    <section
      className="lp-setup"
      id="local-manual-steps"
      aria-labelledby="local-steps-title"
    >
      <div className="lp-section-head">
        <div>
          <h2 id="local-steps-title">Running in about five minutes</h2>
          <p className="lp-section-head__lead">
            Three steps, copied one command at a time. Nothing in this
            demonstration runs on your computer.
          </p>
        </div>
        <div className="lp-seg" role="group" aria-label="Operating system">
          {(['mac', 'windows'] as const).map((os) => (
            <button
              key={os}
              type="button"
              aria-pressed={platform === os}
              onClick={() => {
                setPlatform(os)
                seek(0)
                setCopied('')
              }}
            >
              {os === 'mac' ? 'macOS' : 'Windows'}
            </button>
          ))}
        </div>
      </div>
      <ol className="lp-steps">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="lp-step"
            data-active={stepIndex === index}
          >
            <div className="lp-step__head">
              <span className="lp-step__number" aria-hidden="true">
                {index + 1}
              </span>
              <h3>{step.title}</h3>
            </div>
            <p>{step.body}</p>
            <div className="lp-code">
              {step.commands.map((command) => {
                const isAddress = command.startsWith('http')
                const number = isAddress ? null : ++commandNumber
                return (
                  <div key={command} className="lp-code__line">
                    <code>{command}</code>
                    <button
                      type="button"
                      onClick={() => void copy(command)}
                      aria-label={
                        number === null
                          ? 'Copy the local address'
                          : `Copy command ${number}`
                      }
                    >
                      Copy
                    </button>
                  </div>
                )
              })}
            </div>
            <button
              type="button"
              className="lp-step__watch"
              aria-label={`Watch step ${index + 1}: ${step.title}`}
              aria-current={stepIndex === index ? 'step' : undefined}
              onClick={() => seek(stepStart[index] ?? 0)}
            >
              <UiIcon icon={Play} size={16} /> Watch this step
            </button>
          </li>
        ))}
      </ol>
      <p className="lp-setup__status" role="status">
        {copied}
      </p>
      <div className="lp-player lp-glass">
        <div className="lp-player__chrome">
          <span>{screen}</span>
          <span>Illustrated demonstration</span>
        </div>
        <div className="lp-player__screen">
          <SetupDesktopScene
            stage={scene}
            phase={progress % SCENE_TICKS}
            platform={platform}
            commands={commands}
            reducedMotion={reducedMotion}
            playing={playing}
          />
        </div>
        <div className="lp-player__controls">
          <button
            className="lp-player__play"
            type="button"
            aria-label={
              playing
                ? 'Pause walkthrough'
                : progress === END
                  ? 'Replay walkthrough'
                  : 'Play walkthrough'
            }
            onClick={() => {
              if (progress === END) setProgress(0)
              setPlaying(!playing)
            }}
          >
            <UiIcon
              icon={playing ? Pause : progress === END ? RotateCcw : Play}
            />
          </button>
          <label className="lp-player__timeline">
            <span className="sr-only">Walkthrough position</span>
            <input
              type="range"
              min="0"
              max={END}
              value={progress}
              aria-valuetext={`Step ${stepIndex + 1}: ${current.title}`}
              onChange={(event) => seek(Number(event.target.value))}
            />
          </label>
          <span className="lp-player__time">
            {Math.round(progress / 10)} / {Math.round(END / 10)}s
          </span>
          <span className="lp-player__caption">
            Step {stepIndex + 1} of 3 · {current.title}
          </span>
        </div>
      </div>
      <p className="lp-setup__help">
        On a managed work computer? Ask IT to help with the first installation.
        To return another day, open the Steerloom folder in {shell}, run{' '}
        <code>node server.mjs --open</code> again and press {enter}.
      </p>
    </section>
  )
}

export function LocalSetupPage({
  productionHosted,
  onBack,
  backLabel = 'Back to your workspaces',
}: {
  productionHosted: boolean
  onBack: () => void
  backLabel?: string
}) {
  return (
    <div className="lp">
      <div className="lp-top">
        <button className="lp-top__back" type="button" onClick={onBack}>
          <UiIcon icon={ArrowLeft} /> {backLabel}
        </button>
        <nav className="lp-top__nav" aria-label="Local workspace page">
          <a href="#local-steps">Set up</a>
          <a href="#local-how">How it works</a>
        </nav>
      </div>
      {/* First on a phone: nobody installs there, so the next step is to
          send the page to a computer. */}
      <SendToComputer />
      <section className="lp-hero" aria-labelledby="local-title">
        <ul className="lp-hero__facts" aria-label="At a glance">
          <li className="lp-hero__badge">
            <UiIcon icon={Lock} size={16} />
            Read-only
          </li>
          <li>macOS, Linux &amp; Windows</li>
          <li>Jira, Trello, Azure DevOps &amp; GitHub</li>
          <li>No telemetry</li>
        </ul>
        <h1 id="local-title">
          Your board data stays inside.{' '}
          <span className="lp-gradient-text">The briefing comes out.</span>
        </h1>
        <p className="lp-hero__lead">
          Run Steerloom on a computer that can already reach your company’s
          board. Every metric is calculated on that machine, and board data
          never reaches Steerloom’s hosted service. Connect GitHub there too:
          the briefing shows where each item’s pull request stands, and your
          token stays on that computer.{' '}
          <a href="#local-how">See how it works</a>
        </p>
      </section>
      <OneCommandInstall productionHosted={productionHosted} />
      <details className="lp-manual">
        <summary>
          <UiIcon
            icon={ChevronRight}
            size={16}
            className="lp-manual__chevron"
          />
          Prefer to install step by step?
        </summary>
        <SetupSteps productionHosted={productionHosted} />
      </details>
      <LocalFlow />
      <section className="lp-closing" aria-labelledby="local-closing">
        <div>
          <h2 id="local-closing">Ready when your team is</h2>
          <p>
            Local accounts are separate from your hosted account, and nothing
            syncs between them. Optional AI only uses an endpoint your
            organisation approves. Check your company’s policy before connecting
            company data.
          </p>
        </div>
        <div className="lp-closing__actions">
          <a
            className="lp-btn"
            href={productionHosted ? '/api/hosted/download/local' : '/'}
            download={productionHosted || undefined}
          >
            {productionHosted
              ? 'Download steerloom-local.tar.gz'
              : 'Open local workspace'}
          </a>
          <button
            type="button"
            className="lp-btn lp-btn--quiet"
            onClick={onBack}
          >
            {backLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
