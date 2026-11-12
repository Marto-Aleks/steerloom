# Product pages, local package and identity

The public landing page, the local setup page, the downloadable local package,
the design preview route, and the Steerloom visual identity.

## Landing page and sign-in

Signed-out visitors to the hosted site (`/?hosted=1`) see a short product page
(`src/features/workspace/landing/LandingPage.tsx`) in the same light glass
style as the signed-in app: the headline revealed word by word, a pain-led
subhead and audience line, then the film card
(`VideoShowcase.tsx`, see below), then one showcase
(`src/features/workspace/landing/CapabilityShowcase.tsx`) that cycles through
three animated stories: work piling up in a stage, noise collapsing into three
findings, and a forecast settling on its date. Below it, the page alternates
light, dark and saturated sections:

- **Metrics bento** (`MetricsBento.tsx`): six tiles with a big example number
  that counts up, a one-line definition and a mini animation; the forecast tile
  is twice the size and shows a 50–95% finish window, so the single "85% by"
  date stays with the showcase. "How it's calculated" flips a tile to its formula.
- **Assistant** (`AssistantSection.tsx`): a short pitch beside a product
  window ("Briefing · Mobile team"): a muted mini board and the docked
  assistant. A question types in, the answer streams, and each evidence chip
  lights up its source on the board (Review column glow, then API-212 with a
  dashed connector). The model pill then flips from Claude to OpenAI for a
  forecast question. The model choice is named once in text and once in the
  pill; "See enterprise setup" explains the company-endpoint option in place.
- **Trust band** (`TrustSection.tsx`): full-width light blue-to-lavender band
  with three glass cards and animated line icons (lock, receipt, cloud/server
  switch).
- **Closing call to action** (`ClosingCta.tsx`): the most saturated block, a
  "Connect my board" button and a briefing card peeking up from the bottom.

**The film** (`HeroFilm.tsx`, `FilmPlayer.tsx`): the hero carries a small
tilted film card: a product window showing a poster frame from the film
(`public/video/loomy-poster-3.jpg`), a play button, and two labels overlapping
its edges. A soft thread ribbon draws in once behind the card. Clicking the
card opens the film in a modal player with sound and captions, closed by
Escape, the close button or a click outside; focus returns to the card. The
hero's layout (two-column or centred) is selectable via `?hero=a|b`.

The film itself ("Loomy", about 81 seconds) follows a delivery lead, drawn as
a small blue dot character called Loomy, through a week in a team working with
agentic AI: faster code,
work piling up in review, hours of digging, then the real Steerloom screens
(recorded from the local demo with Playwright) and a genuine Steerloom AI
answer. It is produced outside this repository, in the
claude-code-video-toolkit project `projects/steerloom-film` (branch
`steerloom`), which renders `public/video/loomy-film-3.mp4`, the `.vtt`
captions and the poster. The voiceover never speaks numbers; the only figures
on screen are the demo board's, under a "Demo data" note.

Sections reveal once when scrolled into view (`reveal.ts`). Every example
number is illustrative, never real data; the forecast copy matches the product
(10,000 simulations over the last 8 weeks).

The showcase advances every 6 seconds; the line beside the active tab fills as
its timer, hovering the card or focusing inside pauses it, and clicking a tab
restarts it. It only starts once on screen. Every timing lives in the `TIMING`
object at the top of `CapabilityShowcase.tsx`. With reduced motion the tabs do
not advance on their own and panels show their finished state with a fade.
On phones the tabs become a row of pills above the card.

Pages are chosen with `?page=`:

| URL                      | Shows                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `/?hosted=1`             | Landing page (signed out) or your workspaces (signed in)                                                                   |
| `/?hosted=1&page=signin` | Sign-in card                                                                                                               |
| `/?hosted=1&page=signup` | Sign-in card in create-account mode                                                                                        |
| `/?hosted=1&page=local`  | Local setup page; no account needed. Linked as "Run locally" in the landing nav (hidden on phones) and the closing section |

After sign-in people go straight to their workspaces; "Run it on your own
machine" on the workspaces card opens the local setup page. A local
installation (`127.0.0.1`) never shows the landing page.

## Local setup page

The local setup page uses the same light theme as the rest of the app (it
follows the theme toggle). Its main section is a one-command install with a
macOS / Linux | Windows 10 / 11 toggle (Windows is preselected when the browser reports
Windows): the page asks `/api/hosted/download/install-command` (no account) for
short-lived commands, `curl -fsSL ".../api/hosted/install.sh?t=…" | sh` and
`irm ".../api/hosted/install.ps1?t=…" | iex` (PowerShell 5.1 and 7). The
token is a stateless HMAC valid for 30 minutes (`server/hosted/install-command.ts`)
and also authorises `/api/hosted/download/local?t=…`. No account is needed:
the command and the plain download are limited to 30 an hour per address, and
the page offers an optional "Keep me posted" email, sent as feedback. The script installs Node.js 22 into
`~/steerloom/node` when needed (checksum-verified), unpacks the package, runs
`npm ci`, writes `~/steerloom/start-steerloom` and starts the app. The
PowerShell script does the same on Windows (Node.js zip from nodejs.org checked
with `Get-FileHash`, the built-in `tar.exe`, `npm.cmd` so the execution policy
does not block npm) and writes `%USERPROFILE%\steerloom\start-steerloom.cmd`.
It reports errors without calling `exit`, because `iex` runs in the person's
own window. The step-by-step guide is in a collapsed section below. It:

- The interactive fictional report preview now lives on the landing page; it
  uses the board's chart library, palette, and deterministic sample
  calculations. The preview shows
  weekly throughput, cycle-time distribution, completed-ticket cycle times, and
  a four-week rolling cycle-time trend.
- Has a compact report preview with four keyboard-operable tabs using
  deterministic fictional history, the current theme colors, P85 reference
  lines, and purple marks for tickets above P85. Charts animate on entry and tab
  changes, with replay controls and no hover highlights or tooltips.
  Reduced-motion preferences disable chart animation.
- Keeps the hero to introductory copy and the report preview; setup links,
  downloads, and requirements appear in the setup instructions and closing
  action rather than beside the hero copy.
- Describes flow investigation, aging work, and suggested next steps in the
  agent section, with static layered-glass icons matching the workspace choices.
  Optional AI uses a configured endpoint and additional read-only checks require
  approval. Promotional interactions never call an AI endpoint.
- Includes an illustrated desktop setup walkthrough for macOS and Windows.
  Playback and seeking controls are integrated into the demonstration; the
  Node.js and Steerloom downloads are inline links in step 1. Commands remain
  available to read and copy independently of the demonstration. Decorative
  motion respects reduced-motion preferences.
- Explains what runs on the user's machine, offers operating-system specific
  setup commands, and provides a signed-in download of `steerloom-local.tar.gz`.

## Local package

`steerloom-local.tar.gz` is a source archive with the local workspace server and
browser UI, not a native desktop installer. It can run on macOS, Linux or
Windows with Node.js 22+ and npm; Windows 10 and 11 extract the archive with
the built-in `tar` command.

It is built by `npm run package:local` (also part of `npm run build:hosted`)
from an explicit allowlist; local environment files, saved accounts, and
credentials are excluded. The build also fails on terms listed in
`STEERLOOM_PACKAGE_DENYLIST`; see
[launch setup](launch.md#4-create-the-render-service).

The package includes [local setup instructions](../LOCAL-SETUP.md). Users
extract it, run `npm ci --include=dev` on their own machine, and start it with
`npm run dev` on `http://127.0.0.1:5173/`. Local accounts and credentials stay
separate from hosted accounts. The optional AI endpoint is configured on the
local machine only when approved by the user's organization.

## Design preview

To review the hosted/local choice and local product page without Google
sign-in, run `npm run dev` and open
[the local design preview](http://127.0.0.1:5173/?preview=design). The local
product page also has a direct preview URL at `/?preview=design&view=local`;
preview navigation updates browser history so the selected page survives
refresh and supports the browser Back button.

It reuses the real page components with fictional data and makes no account or
workspace API requests. The hosted button shows an explanatory placeholder;
local setup, report previews, platform switching, and animations are
interactive. This route is development-only and is excluded from production
builds.

## Steerloom identity

The Steerloom mark is two stacks of tickets on a board. One ticket has moved
from the left stack to the top of the right stack, in the cyan → blue → violet
brand gradient, and a fading trail shows where it came from: work being steered
from one place to another. Resting tickets use the theme's primary text color,
and so does the name, set in Sora semibold with tight spacing. In the app the
mark is the `SteerloomMark` component (`src/components/SteerloomMark.tsx`),
which follows the light and dark theme and has a white version for filled
buttons; it also marks every "Ask Steerloom AI" entry point. Static files are in
`public/brands/steerloom-*.svg`; their use is described in
`public/brands/README.md`.

This is a visual rebrand. Existing `FLOWLENS_*` environment variables,
`.flowlens/` installation files, theme storage, API routes, and repository URL
remain compatible. No domain or trademark availability is implied.

## Review mode (development only)

`npm run dev`, then open `http://127.0.0.1:5173/?review` for an index of every
screen without signing in. `?review=new`, `?review=connected` and
`?review=briefings` run the real app against sample answers served in the
browser (`src/review/`): demo briefings, the ⋯ menu, AI key settings and the AI
chat (canned answer, no provider call). Real board loads are refused. The code
is behind `import.meta.env.DEV`, so production builds never contain it.

## Pages for machines

Readers that run no JavaScript, including the AI assistants people now ask
"is Steerloom worth using?", used to get an empty shell. They now get:
`public/about.html` (what Steerloom is, in plain words), `public/llms.txt`
(the same for language models, with the demo and policy links),
`public/robots.txt` (everything public may be read; `/api/` may not) and
`public/sitemap.xml`. `index.html` carries the headline, the lead and those
links inside `#root` until the app mounts. The hosted server allows exactly
these files (`server/hosted/http-server.ts`). Keep the four in step with the
landing copy when it changes.
