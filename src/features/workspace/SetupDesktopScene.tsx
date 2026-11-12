import {
  Check,
  ChevronDown,
  CornerDownLeft,
  Download,
  FileArchive,
  Folder,
  Globe,
  MousePointer2,
  Search,
  SquareTerminal,
} from 'lucide-react'
import { SpotIcon } from '../../components/SpotIcon'
import { UiIcon } from '../../components/UiIcon'

export function SetupDesktopScene({
  stage,
  phase,
  platform,
  commands,
  reducedMotion,
  playing,
}: {
  stage: number
  phase: number
  platform: 'mac' | 'windows'
  commands: string[]
  reducedMotion: boolean
  playing: boolean
}) {
  const prompt = platform === 'mac' ? '%' : 'PS>'
  // The ready-to-run package: unpack, then start. No install step.
  const transcript = [
    ...commands.map((command) => `${prompt} ${command}`),
    'Steerloom is running at http://127.0.0.1:5173/',
  ].join('\n')
  return (
    <div
      className={`desktop-scene desktop-scene--${stage}`}
      data-playing={playing}
      aria-label="Illustrated setup demonstration, not a live desktop"
    >
      <div className="desktop-scene__menubar" aria-hidden="true">
        <span>
          {platform === 'mac'
            ? '●  Finder   File   Edit   View'
            : '⊞  Steerloom setup'}
        </span>
        <span>10:24</span>
      </div>
      <div
        className="desktop-window"
        key={`${stage}-${stage === 0 && phase >= 35}`}
      >
        <div className="desktop-window__title">
          <span>
            {stage === 0
              ? phase < 35
                ? 'nodejs.org/en/download'
                : 'Install Node.js'
              : stage === 1
                ? platform === 'mac'
                  ? 'Spotlight'
                  : 'Windows Search'
                : stage === 2
                  ? platform === 'mac'
                    ? 'Terminal — steerloom-local'
                    : 'PowerShell — steerloom-local'
                  : '127.0.0.1:5173'}
          </span>
        </div>
        {stage === 0 ? (
          phase < 35 ? (
            <div className="desktop-node">
              <span className="desktop-node__logo">⬡ Node.js</span>
              <h3>A small first installation.</h3>
              <p>Node.js runs Steerloom on your computer.</p>
              <div className="desktop-node__select">
                <span>Operating system</span>
                <strong className="desktop-node__os">
                  {platform === 'mac' ? 'macOS' : 'Windows'}{' '}
                  <UiIcon icon={ChevronDown} size={12} />
                </strong>
              </div>
              <span className="desktop-node__download">
                Download installer <UiIcon icon={Download} size={12} />
              </span>
              <small>Illustration. Use the Node.js link in step 1.</small>
              <span className="desktop-pointer" aria-hidden="true">
                <UiIcon icon={MousePointer2} size={24} />
              </span>
            </div>
          ) : (
            <div className="desktop-installer">
              <SpotIcon name="download" size={48} />
              <h3>Follow the installer’s prompts</h3>
              <p>Once Node.js is installed, download the Steerloom package.</p>
              <div className="desktop-file">
                <span aria-hidden="true">
                  <UiIcon icon={FileArchive} size={24} />
                </span>
                <span>
                  <strong>steerloom-local.tar.gz</strong>
                  <small>Save in Downloads</small>
                </span>
                <UiIcon icon={Download} size={16} />
              </div>
              <small>Installer screens vary by operating system.</small>
            </div>
          )
        ) : stage === 1 ? (
          <div className="desktop-search">
            <div className="desktop-search__field">
              <UiIcon icon={Search} />
              <strong>
                {(platform === 'mac' ? 'Terminal' : 'PowerShell').slice(
                  0,
                  reducedMotion
                    ? undefined
                    : Math.max(1, Math.floor(phase / 4)),
                )}
              </strong>
              <span className={playing ? 'setup-demo__cursor' : ''}>▌</span>
            </div>
            <small>Best match</small>
            <div className="desktop-search__result">
              <span aria-hidden="true">
                <UiIcon icon={SquareTerminal} />
              </span>
              <span>
                <strong>
                  {platform === 'mac' ? 'Terminal' : 'PowerShell'}
                </strong>
                <small>Application</small>
              </span>
              <UiIcon icon={CornerDownLeft} size={16} />
            </div>
            <p>
              {platform === 'mac' ? 'Press Return' : 'Press Enter'} to open.
            </p>
          </div>
        ) : stage === 2 ? (
          <div className="desktop-terminal">
            <pre aria-hidden="true">
              {transcript.slice(
                0,
                reducedMotion
                  ? undefined
                  : Math.floor((phase / 62) * transcript.length),
              )}
              <span className={playing ? 'setup-demo__cursor' : ''}>▌</span>
            </pre>
            <small>
              Sped-up example. Unpacking and starting take a few seconds.
            </small>
          </div>
        ) : (
          <div className="desktop-workspace">
            <div className="desktop-workspace__brand">
              Steerloom <span>Local</span>
            </div>
            <h3>Your first delivery conversation starts here.</h3>
            <p>Create a local account, then choose your source.</p>
            <div className="desktop-workspace__sources">
              {(['board', 'report'] as const).map((kind) => (
                <div key={kind}>
                  <SpotIcon
                    name={kind === 'board' ? 'board' : 'briefing'}
                    size={40}
                  />
                  <strong>
                    {kind === 'board' ? 'Connect Jira' : 'Try sample data'}
                  </strong>
                </div>
              ))}
            </div>
            <span className="desktop-workspace__ready">
              <UiIcon icon={Check} size={12} /> Runs on your computer, opens in
              your browser
            </span>
          </div>
        )}
      </div>
      <div className="desktop-scene__dock" aria-hidden="true">
        <span>
          <UiIcon icon={Folder} size={14} />
        </span>
        <span>
          <UiIcon icon={Search} size={14} />
        </span>
        <span>
          <UiIcon icon={SquareTerminal} size={14} />
        </span>
        <span>
          <UiIcon icon={Globe} size={14} />
        </span>
      </div>
    </div>
  )
}
