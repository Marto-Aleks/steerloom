import { GlassPanel, StatusBadge } from '../../components/ui'

/*
 * GitHub runs in the local version only: company GitHub is usually inside the
 * company network, and a token for private code is best kept on the person's
 * own computer. These say so on the hosted site, where the code view would
 * otherwise be invisible, and point to the local setup page.
 */
export const LOCAL_SETUP_HREF = '/?hosted=1&page=local'

/** Under the code view on a hosted demo board. */
export function DemoCodeHint() {
  return (
    <>
      This is demo data. To see your own repositories,{' '}
      <a href={LOCAL_SETUP_HREF}>run Steerloom on your computer</a>: your GitHub
      token stays there.
    </>
  )
}

/** In hosted workspace settings, where the GitHub card would be. */
export function GithubLocalCard() {
  return (
    <GlassPanel
      id="github"
      className="home-ai"
      elevation="base"
      aria-labelledby="github-title"
    >
      <div className="home-ai__intro">
        <div className="home-ai__lead">
          <div className="home-ai__heading">
            <div>
              <h3 id="github-title" className="home-ai__title">
                GitHub
              </h3>
              <p className="metadata-copy">
                See where each item’s pull request stands, and where the board
                and the code disagree.
              </p>
            </div>
            <StatusBadge tone="neutral">Local version</StatusBadge>
          </div>
          <p className="body-copy">
            GitHub connects in the local version, so your token stays on your
            computer.{' '}
            <a href={LOCAL_SETUP_HREF}>Run Steerloom on your computer</a>
          </p>
        </div>
        {/* The same slot and mark as the local version's GitHub card. */}
        <div className="ai-marks" data-count="1" aria-hidden="true">
          <span
            className="ai-marks__disc ai-marks__mark"
            data-position="center"
          >
            <img src={`${import.meta.env.BASE_URL}brands/github.svg`} alt="" />
          </span>
        </div>
      </div>
    </GlassPanel>
  )
}
