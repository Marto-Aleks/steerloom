# Providers, proxies and AI

How Steerloom connects to Jira Data Center, Jira Cloud and Trello, how network
proxies apply, and how the optional AI endpoint is configured. Production
callback registration and hosting constraints are in [launch setup](launch.md).

Every account or workspace connects its own boards from the workspace UI; Jira
and Trello connections are never configured in environment files, discovered
from the machine, or shared between accounts. OAuth tokens are exchanged by the
server; manually entered credentials are sent to the same-origin server.
Credentials are encrypted in the local store or Supabase workspace store and
never returned in API responses. The browser does not persist them. Steerloom
verifies access before saving any connection, and provider access is read-only.

## Connecting a board

Select **Connect Jira** and paste a normal Jira site, project, board or ticket
link in **Jira link**. Links on `*.atlassian.net` select Jira Cloud (Connect
with Atlassian where the installation has an Atlassian app, otherwise an
account email and API token); other hosts select Data Center and require a
personal access token. Automatic detection currently relies on the hostname.

Steerloom extracts the installation root, removes page/query details, and fills
the project key when identifiable. Project links supply the project key without
an extra field; site-only links request it when needed. The resolved address is
shown before connecting. Unknown Data Center installation paths are preserved
rather than guessed. Board discovery, loading and agent checks stay scoped to
that connection's project.

Connection progress and errors appear beside the connection button. Redirect,
DNS, refusal, and timeout failures explain the relevant connection problem
without logging upstream responses or credentials.

### Board link shortcuts

- A Jira board link carries its board selection through Data Center connection
  or Cloud authorization.
- A Trello board link is optional; its short link is matched against the
  authenticated user's accessible boards.
- Matching links open workflow setup directly. With no board link, a single
  accessible board opens directly; multiple boards show the board picker. An
  unavailable linked board leaves the picker open rather than choosing another.

## Jira Data Center

Data Center uses a personal access token; setup defaults to the link and
personal token. The connection name and an optional gateway key (for
organizations requiring one) live together in **Connection settings
(optional)**. The gateway key is encrypted with that user's connection and is
not inherited from another account or returned in session responses. Google
sign-in authenticates Steerloom; Jira authorization remains a separate explicit
connection.

Jira access is project-scoped, GET-only, field-allowlisted, and result-limited.

On the hosted site, a pasted Data Center (or Azure DevOps Server) link is
checked before credentials are asked for: the server resolves the address and,
only if it is public, makes one request to its root, without credentials. An
address that is private, unknown on the internet, or silent is reported as
inside the company network; the form then offers the local version instead of
the token fields, with "Try connecting from here anyway" for slow public
servers. Cloud addresses and local installs are never checked. The first-run
choice also carries one line for company boards that only open on a VPN.

On the hosted server, Data Center connections require public HTTPS on port 443;
see [hosted connection limits](launch.md#6-verify-before-sharing). The local
development connector still supports company-network access.

## Jira Cloud

Jira Cloud connects in one of two ways, chosen by the installation:

- **Connect with Atlassian (OAuth)** when the installation has an Atlassian
  OAuth app configured (hosted, or an operator-configured local server). This is
  then the only Cloud path; the server rejects Cloud tokens.
- **Account email + API token** on local installs without an Atlassian app
  (the downloaded package). No administrator setup is needed.

### Email and API token (local installs)

After pasting a `*.atlassian.net` link, the form asks for **Atlassian account
email** and **API token**, with a link to
[id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
Select **Connect and find boards**. Before saving, the local server validates
the input (HTTPS `*.atlassian.net` or `*.jira.com` site on the default port, a
valid email, a token of up to 512 characters without whitespace) and proves
read access by listing the project's boards.

Requests go straight to the site (`https://<site>.atlassian.net/rest/...`, not
`api.atlassian.com`) with `Authorization: Basic base64(email:token)`. They use
the same Cloud v3 search/pagination, changelog and Atlassian Document Format
handling as OAuth connections, and only GET requests. The email and token are
encrypted with the user's connection in `.flowlens/` and never appear in the
browser after submission, session responses, URLs or logs. The token has the
Jira permissions of the account that created it; Steerloom only reads. A
rejected token (401) asks the user to check the email and token and reconnect.

### Connect with Atlassian (OAuth)

Users sign into Steerloom, paste a project link, select **Connect with
Atlassian**, approve read-only access to that site, and choose a board after
returning. OAuth users never copy a token. A site-only link requests the
project key when it cannot be inferred. Jira Cloud OAuth is implemented with
automated coverage, but its live connection test remains pending.

### Operator setup (local accounts)

The operator configures one distributable OAuth 2.0 (3LO) app in the
[Atlassian developer console](https://developer.atlassian.com/console/myapps/).
Ordinary users do not create apps or edit environment files. In the app:

1. Enable OAuth 2.0 authorization with the local callback
   `http://127.0.0.1:5173/api/auth/atlassian/callback`.
2. Add these read scopes under the Jira platform / Jira Software APIs:
   `read:jira-work`, `read:board-scope:jira-software`,
   `read:board-scope.admin:jira-software`, `read:project:jira`,
   `read:issue-details:jira`. Request `offline_access` for rotating refresh
   tokens. The board configuration scope contains `admin` in its name but is
   read-only. No Jira write scopes are requested.
3. Set `STEERLOOM_ATLASSIAN_CLIENT_ID`, `STEERLOOM_ATLASSIAN_CLIENT_SECRET`, and
   `STEERLOOM_ATLASSIAN_REDIRECT_URI` in the server's `.env.local`, then
   restart.
4. Enable app sharing/distribution as appropriate before inviting other users.
   An organization's Atlassian app access policies can still require admin
   approval.

Supabase workspaces use the same app with the additional callback
`/api/hosted/atlassian/callback`; see
[Jira Cloud configuration](launch.md#1-finish-jira-cloud-configuration). If both
integrations are used, the client registration must cover both callbacks.

Google credentials cannot be reused for Atlassian. Without Atlassian operator
configuration, local installs offer the email and API token form instead; the
hosted Cloud form explains the setup requirement and disables the
authorization button. Preview uses another port and needs its own registered
callback configuration if used for OAuth.

### How Cloud authorization is protected

The callback binds single-use state to the signed-in user, initiating session,
requested site/project, and a ten-minute HttpOnly SameSite=Lax cookie. It checks
accessible resources against the exact pasted site and required read scopes.
Signing out during authorization cancels the connection. Tokens never enter
browser code, URLs, or session responses. Access and rotating refresh tokens are
encrypted within the user's existing connection store. Concurrent refreshes
share one request; reconnecting the same site/project preserves its connection
ID and saved dashboards. Revoked access asks the user to reconnect.

OAuth Cloud requests use `api.atlassian.com/ex/jira/{cloudId}`. Only GET operations
read Jira data; POST is used solely for OAuth token exchange and refresh.
Enhanced board/search endpoints use token pagination, and issue changelogs are
loaded completely before calculating metrics. Requests allowlist fields and fail
explicitly on repeated pagination, missing history pages, more than 5,000 board
items, or more than 20,000 changelog entries per issue. Imported rows still
remain transient; Cloud and Data Center use the same browser calculations. Cloud
descriptions/comments are converted from Atlassian Document Format to bounded
plain text, excluding document attributes.

Reference: https://developer.atlassian.com/cloud/jira/software/oauth-2-3lo-apps/

## Trello

Trello uses the same link-first layout as Jira, with its connection name under
optional settings. After connecting, select boards and configure the lists to
measure.

- **Local accounts** use the manual API key/read-only token form, with
  credentials from the [Trello developer portal](https://trello.com/apps/admin).
- **Supabase workspaces** select **Connect with Trello**, optionally paste a
  board link, and approve read access in Trello. Users do not need an API key or
  personal token. This is a confidential OAuth 2.0 client with PKCE and
  read-only board/member scopes. Existing manually connected Trello boards keep
  working. The operator configures one confidential OAuth client for an app that
  **doesn't use Power-Up capabilities** once for the app; see
  [Trello setup](launch.md#2-finish-trello-configuration). Power-Up clients
  require workspace-scoped authorization and are not supported by this
  standalone connection flow.

If hosted Trello approval fails, the return message identifies whether the
browser session was lost, Trello refused access, or the authorization exchange,
board read, or connection save failed, without including provider errors or
credentials. Lost or expired attempts (for example after a deployment) return to
Steerloom with this message instead of an error page.

### History limits

The connector loads up to 5,000 cards and 20,000 relevant actions. It fails
explicitly at the event limit rather than silently reporting truncated history.
Cards without a verified creation/list-history chain are excluded with a visible
warning. Archived completions remain in history; archived cards do not count as
active WIP. Card moves between boards can make history incomplete. List names
and positions are not used to invent transition timestamps.

Trello supports current WIP, cycle-time trends, and throughput. Period-end WIP
comparisons are unavailable because archive/restore history is not collected.

## Azure DevOps (Azure Boards), preview

Select **Connect Azure DevOps** and paste any Azure DevOps link: an
organisation, project, team board, backlog or work item link. Steerloom reads
the organisation (or Azure DevOps Server collection), the project and, from a
board or backlog link, the team; a board link opens that team's board setup
directly. Organisation-only links ask for the project name.

Connections use a personal access token with **Work Items (Read)** and
**Project and Team (Read)**. The form links to the organisation's token page.
The token is sent as Basic auth with an empty user name, encrypted with the
connection like other credentials, and never returned to the browser. A
rejected token (Azure DevOps answers with a sign-in page, not an error)
clears the token field and asks the user to check its expiry and scopes.

**Boards are teams.** Each team's requirement backlog board (Stories, Product
Backlog Items or Requirements, depending on the process) is one board. Items are
the backlog's work item types under the team's area paths (WIQL), up to 5,000;
above 2,000 only items changed in the last 12 months are loaded, as for Jira.

**Stages are board columns.** Column history comes from the bulk reporting
revisions feed (one paged stream per project, filtered to the team's items) and
the board's own Kanban column field. A split column becomes two statuses
(Doing, Done) in one stage, so waiting inside a column stays visible. Where an
item has no column value, or the value disagrees with its state, the state
places it through the board's state mappings. Columns the board marks as in
progress are suggested as the measured stages.

**Removed work** (state category Removed) is counted with the board's final
column and marked as cancelled, so it never counts as delivered and never
leaves an unmapped status.

Reads use GET, except WIQL queries, which Azure DevOps accepts only as POST and
which change nothing. Cloud organisations (`dev.azure.com`,
`*.visualstudio.com`) work from the hosted site; Azure DevOps Server inside a
company network needs the local version. API version 6.0 is used, supported by
Azure DevOps Services and Server 2020 and later.

Not yet included: AI item lookups (`#1234`, comments, links) and the team
overview panel. Live verification against a real organisation is pending; the
flow has been verified against a local stand-in of the API.

## GitHub (pull requests)

Optional and local app only for now: company GitHub servers are usually only
reachable inside the company network. An owner or admin opens **Workspace
settings → GitHub**, enters the address (`https://github.com` or the company's
GitHub Enterprise Server), a token and up to 10 repositories (`owner/name` or
pasted links), and Steerloom checks them together before saving: the token,
that it can see each repository, and how many of each repository's pull
requests from the last year name an item key. An entry that is not
`owner/name` is named in the error. A blank token keeps the saved one for the
same address.

Use a **fine-grained personal access token** with read-only access to **Pull
requests** and **Metadata**, limited to the team's repositories. In an
organization that approves tokens, the token sees no repositories until an
owner approves it; Steerloom then says the repository is not visible.

Steerloom calls GitHub's GraphQL API (`api.github.com/graphql`, or
`<server>/api/graphql` on Enterprise Server). GraphQL takes every request as a
POST; Steerloom only sends four fixed read queries and no write operation
exists. Per pull request it reads the title and branch to find item keys, the
ready, review, approval, merge and close times, and the author and reviewer
logins only to tell a review from the author's own reply, and the number of
comments (never their text). Per branch it reads the name, to find item keys
(not kept), and the date of its last commit (no code, no commit messages);
only branches with a commit in the last year count. A fine-grained token
needs Contents: read for branches; without it pull requests still load. The browser receives
the keys, times and link, never titles, code or people. Every dashboard reads
the connection's repositories (a request cannot name others); up to 1,000
recently updated pull requests per repository
are read, going back over the report period, and at least a year, so quiet pull
requests on long-running items are still found.

**Read-only governance.** The client refuses to send any document other than
its four fixed read queries, so no write can leave Steerloom whatever the
token allows. When the token is checked, GitHub's reply headers say what it is:

- **Fine-grained tokens** are limited by their own permissions (Pull requests:
  read, Metadata: read).
- **Classic tokens** cannot be read-only for private repositories: `repo` is
  the only scope that reads them, and it also writes. Steerloom accepts a
  classic token only when its scopes are `repo` (and what `repo` brings with
  it) and it has an expiry date; anything broader, or a token that never
  expires, is refused with the reason.

The GitHub card shows the token type and its expiry date, and warns once it
has expired. Revoke a test token on GitHub when the test is done.

## Figma (design files)

Optional, local app only, and in progress: today Steerloom connects and checks
the files; the briefing does not use them yet. An owner or admin opens
**Workspace settings → Figma** and pastes a personal access token; Steerloom
checks it once (`GET /v1/me`) before saving it encrypted. A blank token keeps
the saved one.

Create the token in Figma under **Settings → Security → Personal access
tokens** with only these read scopes: `current_user:read`,
`file_content:read`, `file_metadata:read`, `file_versions:read`,
`file_dev_resources:read` and `folders:read`. Leave every write scope,
comments, variables, library, sandbox and webhook scopes unticked.

Each dashboard names up to 10 design files under report settings → **More
options → Designs from**, as pasted links (a branch link counts as its main
file). Steerloom reads each file's name (`GET /v1/files/<key>/meta`) so a wrong
link shows before saving. It only sends GET requests to `api.figma.com`.

## Loading boards

Reads that a provider throttles or briefly fails (429, 502, 503, 504) are
retried up to three times, honouring `Retry-After`. Board history is streamed
to the browser as newline-delimited JSON and gzip-compressed per line when the
browser accepts it. The server keeps the last twenty loaded boards in memory
for ten minutes (payloads only, never credentials): opening the same board
again, or another person opening it, costs no provider requests; `?fresh=1`
(the Refresh action) bypasses the copy, and disconnecting forgets the
connection's boards.

## Network proxies

Copy `.env.example` to `.env.local` if you do not already have one, and restart
Vite after changing it. Proxy routing is installation-wide; account credential
isolation is unchanged. TLS verification stays enabled for every proxy.

| Variable                    | Applies to                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `HTTPS_PROXY`               | Outbound connector requests (Jira API requests use this installation proxy).                    |
| `FLOWLENS_TRELLO_PROXY`     | Trello only. Unset reuses the installation's Jira proxy; `direct` bypasses it. Jira unaffected. |
| `STEERLOOM_ATLASSIAN_PROXY` | Atlassian OAuth requests only; otherwise the installation `HTTPS_PROXY`/`HTTP_PROXY` is used.   |
| `STEERLOOM_GOOGLE_PROXY`    | Google token and signing-key requests only; see [authentication](authentication.md).            |
| `STEERLOOM_SUPABASE_PROXY`  | Supabase requests; overrides the `HTTPS_PROXY`/`HTTP_PROXY` fallback.                           |
| `FLOWLENS_AI_PROXY`         | Requests to the AI provider only (local installs).                                              |
| `NO_PROXY`                  | Addresses reached directly: Jira, Azure DevOps Server and AI endpoints, e.g. `*.example.com`.   |

Started from its app icon, the local app uses the computer's own proxy and its
exceptions, as the browser does, when no proxy is set here. A company Jira
listed in those exceptions is reached directly. When the proxy answers for Jira
with a web page, the error says so: add the Jira address to `NO_PROXY`.
When the computer has no proxy at all and the company network still answers
with a web page, the company usually expects its own proxy tool on each
computer (it signs in to the company proxy and listens locally): the error
asks the person to have IT install it, or to use the company VPN.

A Trello DNS error means the local server could not reach Trello before
validating your token. Check your internet/VPN connection and DNS settings. If
your network requires a proxy, set
`FLOWLENS_TRELLO_PROXY=http://your-approved-proxy:port` and restart
`npm run dev`. Use `direct` only when your network permits direct access.

## AI key

Steerloom AI is optional. Each workspace brings its own key: an owner or admin
opens **AI assistant** on the workspace page and connects one of:

| Provider         | What to enter                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| Anthropic        | API key from the Anthropic Console; model defaults to `claude-sonnet-5-5`.                          |
| OpenAI           | API key from the OpenAI platform and a model name.                                                  |
| Company endpoint | The gateway's base address (OpenAI- or Anthropic-style, Azure, OpenRouter) and key; model optional. |

Steerloom sends one small test request before saving. For a company
endpoint it first works out how the gateway wants to be called, trying only
the address that was typed: three API styles (OpenAI `…/chat/completions`,
Anthropic `…/messages`, Gemini `…/models/<model>:generateContent` under a
versioned base such as `…/v1beta` or a gateway's `…/api/google/v1`), the key
in `Authorization: Bearer`, `api-key`, `x-api-key`,
`Ocp-Apim-Subscription-Key` or `x-goog-api-key`, and an `api-version` when an
OpenAI-style gateway answers "not found". The address steers the order:
Google or Gemini in it tries Gemini first (then Gemini's own
OpenAI-compatible `…/openai/chat/completions`), Anthropic or Claude tries
Anthropic first. It stops at the first combination that answers, at most
twelve tries, and stores it with the key. When nothing works, the message says
whether the key or the address was refused, with the gateway's own reason.
Azure addresses (`…/openai/deployments/<name>` or Azure AI hostnames) start
with `api-key`.

**Company model farms.** Gateways that wrap several clouds behind their own
route prefixes (for example `…/api/providers/gcp/azure/openai` or
`…/api/providers/gcp/openai/v1`) are kept exactly as typed. An Azure-style
base ending in `…/openai` plus a model name becomes
`…/openai/deployments/<model>/chat/completions?api-version=…`, tried first
when the route says "azure". Model names are passed as given, including
provider prefixes such as `anthropic/claude-sonnet-5-5`. Many such gateways
block the model list: then the chat check, not the list, decides whether the
key is accepted, and an empty model field asks for the model name instead of
calling the key wrong.

**Paste an example request.** Under the endpoint field, the Company form
takes the `curl` example a company AI team hands out. Steerloom reads the
address, the key header, the API style and the model from it (never the key's
value), fills the fields, and saves with those exact settings, no guessing.
Examples in a style Steerloom does not speak (OpenAI Responses API, AWS
Bedrock, Vertex AI) are named as such so the person can ask for another.

The installed app also trusts the certificates the computer trusts, so company
networks that inspect HTTPS do not break AI or Jira requests (Node 22.15+). The key is encrypted
on the server (local `.flowlens/` store or Supabase `steerloom_private`) and is
never returned to the browser; members only see the provider and model. Usage
is billed to the key's account. Consumer subscriptions such as ChatGPT Plus or
Claude Pro cannot be connected; providers only allow API keys for other apps.

Hosted workspaces only reach public HTTPS endpoints, and there is no shared
fallback key, so the operator never pays for other workspaces. Apply
`supabase/migrations/202610210004_workspace_ai.sql` before using it.

### Local fallback from the environment

A local install without a workspace key can still use an endpoint configured
in `.env.local` on the machine running the server:

```dotenv
FLOWLENS_AI_ENDPOINT=https://models.example.invalid/v1/chat/completions
FLOWLENS_AI_MODEL=<approved-model-name>
FLOWLENS_AI_API_KEY=<local-api-key>
```

Bearer authentication is the default. Optional proxy, custom header, prefix,
and approved CA (`FLOWLENS_AI_CA_FILE`) settings are available in
`.env.example`; TLS verification is never disabled. `FLOWLENS_AI_PROXY` also
applies to workspace keys on a local install. See
[Steerloom AI](using-steerloom.md#steerloom-ai) for what the agent can access.
