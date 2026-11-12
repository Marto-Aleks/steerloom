# Hosted pilot: Supabase and Render

Status: Supabase account testing is implemented locally at
`http://127.0.0.1:5173/?hosted=1`: Google PKCE sign-in, email/password
registration and confirmation, sign-out, workspace creation/listing and accepting
existing invitations. The local app and its accounts remain separate.
The production HTTP server and encrypted persistent sessions are implemented and
deployed at `https://steerloom.app`; see [launch setup](launch.md). Invitation
sending, admin screens, password recovery and migration tooling remain pending.
Do not publish Vite as the hosted service.

Supabase + Render foundation code is in `server/hosted/`, with a tested Supabase
workspace/RLS migration in `supabase/migrations/`. Account roles and the local
account comparison are summarised in [authentication](authentication.md).

## Test account setup locally

Set `STEERLOOM_SUPABASE_URL` and `STEERLOOM_SUPABASE_PUBLISHABLE_KEY` in
`.env.local` (the `NEXT_PUBLIC_*` names from Supabase's Next.js example are not
read). Restart `npm run dev` after changing them. The default account-test origin is
`http://127.0.0.1:5173`; use that hostname consistently. An optional
`STEERLOOM_AUTH_ORIGIN` can select another HTTP loopback origin for development.
`STEERLOOM_SUPABASE_PROXY` overrides the `HTTPS_PROXY`/`HTTP_PROXY` fallback.

In Supabase Authentication → URL Configuration → Redirect URLs, allow exactly:
`http://127.0.0.1:5173/api/hosted/auth/callback`. This app callback is different
from the Supabase `/auth/v1/callback` registered in Google Cloud. Both are needed.
Apply all three migrations below to enable open registration. No email allowlist is required.

Open `http://127.0.0.1:5173/?hosted=1` (or the hosted-account link on local sign-in),
then sign in with Google or register with email/password. Confirm email links in
the same browser within ten minutes; if confirmation completes but the browser
binding expires or differs, sign in with the confirmed email/password afterward.
Every verified, active account can create its own workspace; signed-in invitees
can also accept their matching pending invitation. Existing workspace names load on subsequent visits.

Supabase access/refresh tokens remain in server memory, behind an opaque HttpOnly
SameSite=Strict cookie separate from the local session. Sessions last at most
eight hours and refresh access tokens as needed. Restarting the dev server clears
these test sessions and pending PKCE flows; sign in again. This is not production
session persistence. In production the sessions are kept encrypted on the
persistent disk. If that file cannot be read (a changed
`STEERLOOM_CREDENTIAL_KEY`, a damaged file), the server starts with no sessions,
moves the file to `sessions.enc.unreadable` and logs it: everyone signs in
again. Changing the credential key also makes every saved board connection and
AI key unreadable, so those must be connected again. This step saves account/workspace records in Supabase; it
does not migrate local accounts or upload imported board rows. Select **Open
workspace** to use the existing dashboard, Jira/Trello setup, overview and agent
UI with that workspace's connections. Dashboard settings and encrypted
credentials added through this workspace are stored in Supabase; only
allowlisted connection metadata is returned to the browser. Local connection
credentials are not inherited or migrated.

Workspace service requests allow up to 30 seconds for slow network/proxy
connections. Network and response failures show a safe retry message; writes are
not automatically retried, to avoid duplicating a change already saved upstream.
Dashboard saves accept Supabase's empty success responses, including HTTP 201
for `return=minimal`, so selecting a board continues into report setup after
the dashboard is saved.

Apply `supabase/migrations/202610160002_workspace_connections.sql` once after the
first migration. Add `STEERLOOM_SUPABASE_SECRET_KEY=sb_secret_...` on the server.
The persistent 32-byte (64-hex) encryption key is read from `STEERLOOM_CREDENTIAL_KEY`;
keep it backed up and stable. The API key is only used server-side for restricted
credential RPCs, after verifying the user and current workspace membership;
these RPCs also recheck membership in the database. Browser JWTs cannot call them.
Owners/admins connect boards and edit dashboards; members can read shared boards
and use the analysis agent. Each provider callback, read, mutation and token
refresh checks workspace membership. Provider access remains read-only. Connections added
here share read access with workspace members; this is disclosed in the form.

Jira Cloud requires the operator's Atlassian client settings plus an additional
registered callback `http://127.0.0.1:5173/api/hosted/atlassian/callback`.
Local Jira's existing callback stays unchanged. Transactions bind the user session,
workspace, browser, site and project, and recheck membership on callback/refresh.
Token refresh uses compare-and-swap storage so disconnected/replaced credentials
are not overwritten. Data Center uses the existing credentials form. Hosted
Trello uses OAuth 2.0 approval as described in [launch setup](launch.md), without
inheriting machine credentials.

## Intended experience

Anyone opens the app, signs in with Google or verifies their email, names their
own workspace, and connects their boards. No operator approval or invitation is
required. Creating a workspace adds only its creator as owner; it does not grant
access to any existing workspace. Team invitations remain optional, and users
can create their own workspace even when they belong to another team.

Owners manage membership and connections. Admins manage dashboards/connections
and invite members. Members view shared dashboards. Connecting a board shares
read access through that connection with workspace members; the connection UI
must explain this before authorization. The last owner cannot remove or demote
themself. Revocation is checked against the database, not a cached JWT role.

## 1. Create the Supabase project

Use a project dedicated to Steerloom, with a region appropriate for the pilot.
Keep the database password and secret keys out of chat and source control.
The project URL and publishable key are sufficient for the initial server auth
adapter; it deliberately uses each user's JWT so database RLS stays effective.

Apply `supabase/migrations/202610150001_hosted_workspaces.sql` as the database
owner to a new project using the Supabase SQL Editor or migration tooling. This
migration is not intended to be pasted repeatedly; use tracked migrations.
It creates the workspace schema, membership roles, invitation functions, and
private tables for pilot access, disabled accounts, and encrypted credentials.
No local accounts, imported board rows, or company data are uploaded.

Configure Authentication:

1. Enable email/password, email confirmation, and a minimum 12-character password.
2. Disable anonymous sign-in. Enable Google using the hosted project's Google
   credentials and the Supabase callback shown in its provider settings.
   The existing local Google callback is a different integration; preserve it.
3. Apply `202610160002_workspace_connections.sql`, then
   `202610160003_open_registration.sql` from `supabase/migrations/`. The third
   migration removes the approval requirement for signup and workspace creation.
   An existing **Before User Created** hook can stay enabled: its updated function
   allows registration without an invitation. Enable new-user signups in Supabase
   and test both Google and password registration.
4. Set the production Site URL and explicitly allow the app's auth callback URL
   (see [production URLs](launch.md#5-register-the-production-urls)), plus the
   recovery callback once password recovery is implemented. Avoid wildcard
   production redirects. Add separate exact development callbacks as needed.
5. Configure a production SMTP service for verification, invitations and recovery.
6. Review identity linking. Supabase automatically links verified identities
   with matching email addresses, unlike our current explicit local linking.
   Manual linking to a different email requires its provider setting and UI.

For an existing installation, run only the new
`supabase/migrations/202610160003_open_registration.sql` in the SQL Editor as the
database owner. Paste the file's contents, not its path. Existing workspaces and
memberships are preserved. The legacy private `pilot_access` table is retained
but no longer controls registration or workspace creation. Verified email and
disabled-account checks still apply. Google OAuth audience restrictions are
separate: make the Google app available to external users before public launch.

Invitations expire after seven days. Acceptance requires the authenticated,
confirmed email to match the invitation. Replays, revoked invitations and
expired invitations fail. An invitation is workspace membership approval, not
an email-delivery system; the pending server/UI work must deliver the link.

## 2. Local hosted configuration

Add these server-only variables to `.env.local` when the project exists:

```dotenv
STEERLOOM_PUBLIC_ORIGIN=https://your-final-app-host
STEERLOOM_SUPABASE_URL=https://your-project.supabase.co
STEERLOOM_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
STEERLOOM_CREDENTIAL_KEY=your_64_character_random_hex_value
```

Generate the encryption key locally with:

```bash
openssl rand -hex 32
```

Keep the key stable, backed up separately, and in Render's secret environment
configuration in production. Losing it makes stored connector credentials
unreadable. Never prefix it with `VITE_`. The Supabase URL/key also enable the separate loopback account-test screen.
They do not enable public hosting or replace local login. The persistent encryption
key also encrypts hosted connection credentials; the public origin configures the production server.

## 3. Hosted application server

The production Node entry point is `server/hosted/main.ts`, built using
`npm run build:hosted` and started with `npm start`. It serves the built app,
Supabase auth, selected-workspace APIs and provider callbacks. Secure cookies,
explicit HTTPS origin checks and encrypted disk sessions are implemented. The
Render blueprint uses exactly one instance with a persistent disk. Workspaces,
provider credentials and dashboards remain in Supabase. See [launch setup](launch.md).

Remaining work before broad rollout: validate real Google/Jira/Trello grants on
the production URL, configure email delivery and implement password recovery.
Invitation delivery/admin UI and migration from local accounts are separate
follow-ups. Do not use Vite as the production server or scale this session store
to multiple processes. CSV parsing and calculations remain in the browser;
imported rows and conversations are not persisted.

The server uses a Supabase secret API key for credential RPCs restricted to the
service_role database role. Never expose it to browser code or expose the private
schema through PostgREST. Other metadata/dashboard requests use caller JWTs/RLS.

## 4. Migrate existing accounts

Keep the local installation intact and back it up before migration. Do not
match an existing username or a typed email to a hosted identity automatically.
Require proof of the old account plus a verified hosted identity. Map the old
workspace to the new workspace ID, validate dashboard settings, decrypt and
re-encrypt each connection using the new workspace/connection context. Existing
Google subject IDs also require mapping to the verified Supabase identity.
Local password hashes and local session cookies do not become Supabase logins;
users establish a hosted password or use Google. Do not migrate imported rows.
Prepare a dry-run report before writing a migration; reruns must not duplicate
workspaces or connections.

## 5. Configure Render

Follow [launch setup](launch.md) to create the Render service from `render.yaml`.
Build with `npm ci --include=dev && npm run build:hosted`, start with `npm start`,
and use `/healthz`. Set the explicit HTTPS origin and exact provider callbacks.
The persistent disk stores encrypted sessions only, not workspace data or the
local `.flowlens` account store. Keep the encryption key stable and backed up.

The production connector accepts only public HTTPS Jira endpoints on port 443
and blocks private address ranges at connection time. Private company Jira needs
a separate network design; a colleague's browser VPN is insufficient. Jira Cloud
and Trello use server-side OAuth, with encrypted tokens stored in Supabase.

## Release checks

Run `npm run lint`, `npm test`, `npm run build`. The database test suite executes the
migration in an in-memory PostgreSQL (PGlite) with mock Supabase auth roles and
fictional data; it does not contact Supabase or upload local data. Also test against
the real Supabase project before release: signup hook activation, Google/email
linking, confirmation/recovery email delivery, cross-workspace authorization,
invitation replay/expiry, disabled accounts, credential rotation, provider
callbacks, restarts, and backup restore. A deployed health check alone is not
acceptance for the hosted pilot.

References: [Supabase signup hooks](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook),
[identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking),
[server-side authentication](https://supabase.com/docs/guides/auth/server-side/creating-a-client),
[Render web services](https://render.com/docs/web-services).
