# Accounts, sign-in and sessions

Steerloom has two separate account systems that share the same browser app:

- **Local accounts** on your own machine, stored in `.flowlens/`. Each local
  account owns its own workspace.
- **Supabase accounts** with shared team workspaces, used by the hosted service
  and testable locally at `http://127.0.0.1:5173/?hosted=1`. Setup is in
  [hosted pilot](hosted-pilot.md); production in [launch setup](launch.md).

Local accounts and credentials stay separate from Supabase accounts; choosing
local after hosted sign-in does not synchronize data, and local accounts are not
migrated.

## Local accounts

The welcome screen offers Google sign-in and username/password registration.
Passwords need at least 12 characters. Each local account owns its own
workspace. Local accounts have no team invitation or password recovery flow.

First-time Google sign-in creates a separate account and then asks for a
workspace name. To use Google with an existing password account, sign in with
that password first and choose **Link Google to this account** in the workspace.
Subsequent Google sign-ins open the linked workspace. Linking must be explicit:
matching email addresses never merge accounts, and a Google identity already
linked elsewhere cannot be transferred through this flow. Password sign-in
remains available.

## Google sign-in (optional local setup)

Google sign-in uses server-side OpenID Connect authorization code exchange with
PKCE, browser-bound single-use state, nonce, and signature/issuer/audience/expiry
validation. Google login does not connect Jira, Trello, Gmail, or Drive and does
not grant membership of another user's workspace.

1. In Google Cloud / Google Auth Platform, configure the app name as Steerloom
   and configure the consent audience. While testing an External app, add your
   test users as required by Google's console.
2. Create an OAuth client of type **Web application**. Add exactly
   `http://127.0.0.1:5173/api/auth/google/callback` as an authorized redirect
   URI. Hosting is not needed for local development. Do not mix localhost and
   127.0.0.1.
3. Add `STEERLOOM_GOOGLE_CLIENT_ID`, `STEERLOOM_GOOGLE_CLIENT_SECRET`, and
   `STEERLOOM_GOOGLE_REDIRECT_URI` to `.env.local` (see `.env.example`). Keep
   the secret out of chat, Git, browser variables, and screenshots. Restart
   Vite.
4. Open `http://127.0.0.1:5173/` and select **Sign in with Google**. First-time
   Google users name a new isolated workspace. Returning users retain their
   dashboards and connections. The development port is fixed; if occupied, stop
   the existing instance instead of silently switching ports.

Normal Google sign-in does not force an account chooser and requests only
`openid email`, the information Steerloom actually uses. Explicit account
linking still shows the chooser. Google controls consent, passkeys, security
checks, and notification emails; Steerloom cannot suppress those.

Only Google subject ID and verified email are stored with the local account.
OAuth access/ID tokens are transient on the server and are never persisted or
sent to browser code. The browser receives an HttpOnly Strict application
session and a separate ten-minute HttpOnly Lax login transaction cookie. Logout
ends Steerloom's session, not the Google session. Cancelled/expired attempts
show a recoverable generic error, without displaying provider responses or
tokens.

This implementation remains loopback-only; it does not expose the installation
publicly. The hosted service uses Supabase's Google provider with its own
callback instead; see [hosted pilot](hosted-pilot.md#1-create-the-supabase-project).
Google sign-in itself requires Google network access. If the local Node process
needs an approved network proxy, set `STEERLOOM_GOOGLE_PROXY=http://localhost:3128`
(or your approved proxy URL) and restart Vite. This proxy applies only to Google
token/signing-key requests; TLS verification stays enabled. The demo and
password login remain available without Google network access.

Google setup reference:
https://developers.google.com/identity/protocols/oauth2/web-server

## Local sessions

Sessions use HttpOnly, SameSite=Strict cookies with an eight-hour absolute
lifetime and survive local server restarts. There is no automatic lifetime
extension. Always use the same browser profile and hostname (`127.0.0.1` or
`localhost`) to reuse the application session.

`.flowlens/sessions.json` stores SHA-256 hashes of random session cookies with
user IDs and expiry times, using an atomic owner-only file. It never stores raw
session cookies, Google tokens, or imported board data. Logout and session
rotation revoke the old session; the store rereads revocations across server
instances. Corrupt or expired records fail closed.

OAuth attempts in progress, including pending Google login attempts, expire on
server restart and must be restarted.

## Supabase accounts and workspaces

Anyone with a verified, active Supabase account (Google sign-in or confirmed
email) can register without approval and create their own workspace. Disabled
accounts remain blocked. New workspaces contain only their creator, and existing
workspaces stay isolated by membership. Optional invitations grant access to a
specific team workspace; users with an invitation or an existing membership can
still create their own workspace.

Email sign-up sends a confirmation link through the project's Supabase email
settings; configure custom SMTP (the built-in sender only reaches members of
the Supabase organisation and allows a few emails per hour). Signing up again
with an already registered address sends nothing, by Supabase design, so the
sign-in card offers **Didn't get the confirmation email? Send it again**. It
gives the same answer for every address, so it cannot reveal who has an
account, and sends at most three links per address every 15 minutes.

Owners/admins manage connections/dashboards; members view shared boards and can
ask the analysis agent. Each provider callback, read, mutation and token refresh
checks workspace membership. Roles, invitations, configuration and migrations
are described in [hosted pilot](hosted-pilot.md). Production session storage is
described in [launch setup](launch.md#4-create-the-render-service).

Password recovery, invitation sending/admin screens, and local-account migration
remain unfinished.
