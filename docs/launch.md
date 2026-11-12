# Launch Steerloom

The code is deployed on Render and served through Cloudflare at
https://steerloom.app (`www` redirects there; the `onrender.com` host is rejected). Hosted Google sign-in
works. Trello authorization works on the hosted site. Jira
Cloud still needs a real connection test. Production provider callbacks and email
delivery must be verified before public availability. Users create their own
workspaces; no pilot approval is needed.

## 1. Finish Jira Cloud configuration

Open [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/)
and select the Steerloom OAuth 2.0 integration.

1. Under **Permissions**, configure the Jira APIs with these read scopes:
   `read:jira-work`, `read:board-scope:jira-software`,
   `read:board-scope.admin:jira-software`, `read:project:jira`,
   `read:issue-details:jira`. Despite the `admin` wording, the board-scope.admin
   permission requested here reads board configuration; no write scopes are used.
2. The server also requests `offline_access` to refresh access automatically.
3. Under **Authorization**, configure the callback exactly as
   `http://127.0.0.1:5173/api/hosted/atlassian/callback` while testing locally.
4. Under **Distribution**, enable sharing for other users. Users still need
   access to their own Jira site, and their organization's app policy applies.
5. Store the client ID/secret as `STEERLOOM_ATLASSIAN_CLIENT_ID` and
   `STEERLOOM_ATLASSIAN_CLIENT_SECRET` in `.env.local`; save the file.

Use the Supabase workspace at `http://127.0.0.1:5173/?hosted=1`, choose Jira,
paste a Cloud project/board link and click **Connect with Atlassian**. Approve
the same site. A successful callback opens the board selector or linked board.
The local-account connector uses a different callback; if both integrations are
used, their client registrations must cover their respective callback URLs.

## 2. Finish Trello configuration

Open [Trello apps administration](https://trello.com/apps/admin). Create/select
the Steerloom app, choosing **My app doesn't use Power-Up capabilities** when
creating it, then open **OAuth 2.0**. A Power-Up client expects a workspace resource
and can produce `invalid_target` with this standalone integration's flow.

1. Choose a **confidential** client (Steerloom has a server).
2. Enable `read:board:trello` and `read:member:trello`. Do not enable write scopes.
   `offline_access` is requested by the server, not selected in the scope table.
3. Add `http://127.0.0.1:5173/api/hosted/trello/callback` as a callback URL.
4. Save the OAuth client credentials in `.env.local`:

   ```dotenv
   STEERLOOM_TRELLO_CLIENT_ID=your_oauth_client_id
   STEERLOOM_TRELLO_CLIENT_SECRET=your_oauth_client_secret
   ```

These are OAuth 2.0 credentials, not the legacy Trello API key and token. Open a
Supabase workspace, select Trello, optionally paste a board link, and click
**Connect with Trello**. Approve read access and select a board. Provider tokens
are exchanged server-side and never returned in browser JSON. If a grant expires
or is revoked, reconnect. Existing manual connections remain readable.

## 3. Prepare the hosting repository

Render needs a repository it can access. A company-internal Git server may not
be reachable or supported by Render's source integration. Use an authorized
repository on a supported Git provider, or a separately prepared Docker image.
Do not publish company code without authorization. Do not upload `.env.local`,
`.flowlens/`, imported rows, credentials or session files. No push is performed
by these instructions.

## 4. Create the Render service

`npm run build:hosted` also creates `dist/downloads/steerloom-local.tar.gz`, the
package linked from the post-sign-in local setup choice. Set
`STEERLOOM_PACKAGE_DENYLIST` to a comma-separated list of terms (internal hosts,
instances, tool names) that must never be published; the package build fails if
any file contains one. Render and CI builds require it, so add it both as a
Render environment variable and as a GitHub Actions repository secret. See
[local setup](../LOCAL-SETUP.md).

`npm run build:hosted` builds both the browser app and `dist-server/main.js`;
`npm start` runs the production server. It requires the explicit HTTPS
`STEERLOOM_PUBLIC_ORIGIN`, Supabase URL/keys, the stable credential key and
`STEERLOOM_SESSION_FILE` on a persistent disk. Only hosted APIs and allowlisted
built assets are served. Local account APIs, source files and environment files
are unavailable. The landing URL opens hosted signup.

`render.yaml` describes a **paid** 0.5 CPU / 512 MB Node service in Frankfurt and a 1 GB persistent disk.
Review Render's current cost before creating it. It uses one process/instance;
the disk means brief deployment downtime and prevents horizontal scaling.

In Render, connect the repository and use its Blueprint, or create a Web Service:

| Setting      | Value                                          |
| ------------ | ---------------------------------------------- |
| Build        | `npm ci --include=dev && npm run build:hosted` |
| Start        | `npm start`                                    |
| Health check | `/healthz`                                     |
| Disk mount   | `/var/data/steerloom`                          |
| Instances    | `1`                                            |

Set the environment variables listed in `render.yaml`. Use the existing
`STEERLOOM_CREDENTIAL_KEY` so saved connection credentials remain decryptable.
Set `STEERLOOM_PUBLIC_ORIGIN` to the exact HTTPS service address with no path.
Set `STEERLOOM_SESSION_FILE=/var/data/steerloom/sessions.enc`. Behind Cloudflare, set
`STEERLOOM_CLIENT_IP_HEADER=cf-connecting-ip` so sign-in rate limits apply per
client instead of to every user at once. Also set `STEERLOOM_EDGE_SECRET` to a
long random value and add a Cloudflare Transform Rule (Rules → Transform Rules →
Modify Request Header, all incoming requests) that sets the `x-steerloom-edge`
header to the same value. The address header is then trusted only on requests
that came through Cloudflare; without the secret the server logs a warning and
trusts it from anyone. Production reads
the service's environment; it does not load your workstation's `.env.local`.
Do not copy corporate proxy settings by default. The server binds to Render's
`PORT` on `0.0.0.0`. The blueprint disables automatic deploys.

Supabase stores accounts, workspace membership, dashboards and encrypted board
credentials. Production sessions use Secure, HttpOnly cookies. The disk stores
only hashed session-cookie IDs plus encrypted Supabase tokens, with an
eight-hour absolute expiry; it contains no imported board rows or
conversations. Logout and refreshed tokens are persisted atomically. Do not run
a cluster or multiple Node workers against this file: shared durable sessions
and distributed refresh locking are required before horizontal scaling. Session
corruption/key mismatch fails startup rather than silently restoring
unauthenticated or stale sessions. Pending OAuth attempts are kept in memory,
not persisted, and must be restarted if interrupted by deployment. Development
(`?hosted=1`) sessions remain in memory, separate from local accounts.

Hosted Trello and Jira Cloud authorization bind approval to the browser,
initiating session and selected workspace; rotating tokens stay encrypted on the
server and refresh uses compare-and-swap.

## 5. Register the production URLs

Replace `https://YOUR-HOST` below with the public domain (currently
`https://steerloom.app`). Each provider must list this production callback in
addition to the `127.0.0.1` development callback.

| Where                                   | URL                                               |
| --------------------------------------- | ------------------------------------------------- |
| Supabase Authentication → Site URL      | `https://YOUR-HOST`                               |
| Supabase Authentication → Redirect URLs | `https://YOUR-HOST/api/hosted/auth/callback`      |
| Atlassian OAuth callback                | `https://YOUR-HOST/api/hosted/atlassian/callback` |
| Trello OAuth callback                   | `https://YOUR-HOST/api/hosted/trello/callback`    |

Google Cloud's OAuth callback remains the Supabase project callback displayed
in Supabase's Google provider settings. Confirm the Google app's audience is
external and its publishing settings allow the intended users. Enable new-user
signup and email confirmation in Supabase, and configure production SMTP for
email signup. Password recovery is not implemented in Steerloom yet.

## 6. Verify before sharing

Sign in with a second Google account, create a separate workspace and confirm
that the first user's boards are absent. Test both Jira Cloud and Trello with
authorized test boards, including denial/revocation/reconnect. Check that the
selected board opens and metric calculations finish. Restart the service and
verify an unexpired session still works, then sign out and verify it remains
signed out after another restart. The automated suite uses only fictional data.

Hosted Data Center connections require public HTTPS on port 443. The production
server blocks private/loopback/link-local destinations, including DNS results
that change to private addresses: DNS results are checked at socket creation,
and redirects are not followed. Private company Jira needs a separate network
design; hosting does not inherit the user's VPN. Optional AI requires a reachable
operator-configured endpoint; the Render template does not enable one.

## 7. Share with testers

- **Demo link, no account:** `https://steerloom.app/?demo=1` opens the sample
  dashboard from fictional data computed in the browser. The AI buttons invite
  people to create an account. The landing page links to it as "See the live demo".
- **Feedback:** every hosted page has a **Feedback** pill (bottom left). Notes
  are emailed through Resend when `STEERLOOM_RESEND_API_KEY` (a sending-only
  key from resend.com/api-keys, on the verified steerloom.app domain) and
  `STEERLOOM_FEEDBACK_TO` are set on Render. Without them, each note is
  written to the service log as a `[feedback]` line. Signed-in testers' account
  email is attached as reply-to; visitors may type one. Limit: 12 notes per
  address per hour.
- **Usage counts:** `https://steerloom.app/?hosted=1&page=usage` shows how many
  people reached each step (signed in, workspace, board connected, briefing
  opened, AI question, feedback) plus landing visits, demo opens, film plays
  and local installs started. Only emails in `STEERLOOM_ADMIN_EMAILS` (or
  `STEERLOOM_FEEDBACK_TO`) can open it. Steps only: no board data, names or
  emails; people are one-way codes. Stored in `usage.json` beside the session
  file on the persistent disk; daily counts are kept for 90 days.
- **Password reset:** "Forgot your password? Reset it" on the sign-in card.
  Supabase sends the email with its "Reset password" template through the
  same SMTP setup; the link returns to the existing callback URL.
- **Install as an app:** Chrome and Edge show **Install app** (beside
  Feedback, and in the address bar). It adds a Dock or taskbar icon and opens
  Steerloom in its own window. Safari: File → Add to Dock.

References: [Atlassian OAuth/distribution](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/),
[Trello client configuration](https://developer.atlassian.com/cloud/trello/guides/rest-api/oauth-2-client-configuration/),
[Trello confidential OAuth](https://developer.atlassian.com/cloud/trello/guides/rest-api/oauth-2-confidential-client-usage/),
[Render web services](https://render.com/docs/web-services),
[Render persistent disks](https://render.com/docs/disks).
