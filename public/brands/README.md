# Provider icons

Unmodified SVG logomarks downloaded from the official [Atlassian Design logo library](https://atlassian.design/foundations/logos) on 2026-10-13:

- `jira.svg`: `jira/SVG/Jira_icon.svg` from https://atlassian.design/assets/700bfde52eb7/logos/jira_app.zip
- `trello.svg`: `trello/svg/Trello_icon.svg` from https://atlassian.design/assets/700bfde52eb7/logos/trello_app.zip

- `azure-devops.svg`: the Azure DevOps service icon from Microsoft's [Azure Architecture Icons](https://learn.microsoft.com/azure/architecture/icons/) (18×18 geometry and gradient), added 2026-10-24.

- `ai-claude.svg`, `ai-openai.svg`, `ai-gemini.svg`, `ai-grok.svg`: AI service marks from [LobeHub Icons](https://github.com/lobehub/lobe-icons) (`@lobehub/icons-static-svg` 1.99.0, MIT; files `claude-color`, `openai`, `gemini-color`, `grok`), added 2026-10-25 with fixed 24px size. They identify the AI services a workspace can connect its own key for.

- `github.svg`: the GitHub mark (`mark-github`) from [Primer Octicons](https://github.com/primer/octicons) (MIT), added 2026-11-04 for the workspace's GitHub connection.

- `figma.svg`: the Figma logomark (five shapes in the brand colors) as published in Figma's [brand guidelines](https://www.figma.com/using-the-figma-brand/), added 2026-11-04 for the workspace's Figma connection.

These marks identify supported integrations. The Jira and Trello marks belong to Atlassian and remain subject to its [trademark guidelines](https://www.atlassian.com/legal/trademark); the Claude, OpenAI, Gemini and Grok marks belong to Anthropic, OpenAI, Google and xAI; the GitHub mark belongs to GitHub and remains subject to its [logo guidelines](https://github.com/logos); the Figma mark belongs to Figma and remains subject to its brand guidelines; the Azure DevOps icon belongs to Microsoft and is used under the [Azure Architecture Icons terms](https://learn.microsoft.com/azure/architecture/icons/#icon-terms). The app's source license does not grant rights to these marks.

## Steerloom identity

The mark (introduced 2026-11-08) is two stacks of tickets on a board: one
ticket has moved from the left stack to the top of the right stack, in the
cyan → blue → violet brand gradient, with a fading trail back to where it came
from. It is drawn on an 84 × 66 grid (tickets 38 × 18, fully rounded, 8 apart
across and 6 apart down).

- `steerloom-mark.svg`: the mark for light surfaces: navy tickets, gradient moved ticket and trail.
- `steerloom-mark-dark.svg`: the same geometry for dark surfaces: light tickets, brighter gradient.
- `steerloom-white.svg`: white version for coloured or photographic backgrounds; resting tickets at 55 % opacity.
- `steerloom-favicon.svg`: the mark without its trail on a navy rounded tile, for the browser tab.
- `../icons/`: the app icons (192, 512, maskable 512, Apple touch, and the Windows `.ico` used by the installer) are the navy tile with the mark; the trail is drawn from 32 px up and left out below that.
- `../social/steerloom-share-2.png`: the link preview card. Use a new file name when it changes, because sites cache previews by URL.

In the app, use the `SteerloomMark` component instead of these files: it follows
the theme through the `--brand-mark-*` tokens and has a white tone for filled
buttons. The name next to it is Sora semibold with −0.04 em tracking, in the
theme's primary text color. Drop the trail below about 16 px of mark height.
Keep the mark's aspect ratio and clear space; its SVG background stays
transparent.

## Google sign-in button

`google-signin.png` is Google's unmodified pre-approved light pill sign-in button,
served locally from https://developers.google.com/static/identity/images/branding_guideline_sample_lt_rd_lg.png
(downloaded 2026-10-15). Google retains its brand rights; follow
https://developers.google.com/identity/branding-guidelines when changing this asset.
