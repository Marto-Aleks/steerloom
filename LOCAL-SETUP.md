# Run Steerloom locally

This package runs the existing Steerloom local workspace on your computer. It
does not connect your local account to a hosted Steerloom account. Your Jira
token (Data Center personal access token or Jira Cloud API token) is encrypted
in `.flowlens/` beside the application. Jira responses
and imported board rows are used for reports and are not saved as workspace
records. Only use company data if your organization's policy permits this setup.

## macOS and Linux: one command

Open <https://steerloom.app/?hosted=1&page=local> (no account needed), copy
the command shown there and paste it into Terminal. It looks like:

```sh
curl -fsSL "https://steerloom.app/api/hosted/install.sh?t=…" | sh
```

The copied command also reads your Mac's proxy setting, because Terminal does
not follow it on its own; on computers without a proxy it adds nothing. The
command is personal and works for 30 minutes. It installs into
`~/steerloom` (set `STEERLOOM_DIR` to choose another folder), adds Node.js 22
just for Steerloom when yours is missing or older (downloaded from nodejs.org
and checked against its published checksum), unpacks the ready-to-run app and
opens it in its own window. Nothing is installed from npm. No admin rights are
needed, and you can close Terminal afterwards.

Opening Steerloom from its app icon signs you in: the first start creates your
workspace on this computer, with no username or password to choose. The icon
uses a secret only your computer account can read, so other programs and other
people on the computer still see a sign-in page. On a computer shared under one
login, create separate accounts from the sign-in page instead.

Next time, open **Steerloom** from Launchpad or Spotlight on macOS (it is in
`~/Applications`), or from your applications menu on Linux. It runs quietly in
the background; stop it with `~/steerloom/stop-steerloom`. Running the command
again updates Steerloom and keeps your local data.

## Windows: one command

Open <https://steerloom.app/?hosted=1&page=local> (no account needed), choose
**Windows 10 / 11** and copy the command. Open Start, type PowerShell and press Enter,
then paste it and press Enter. It looks like:

```powershell
irm "https://steerloom.app/api/hosted/install.ps1?t=…" | iex
```

It works in Windows PowerShell 5.1 (built into Windows 10 and 11) and
PowerShell 7, needs no admin rights and is also valid for 30 minutes. It
installs into `%USERPROFILE%\steerloom` (set `$env:STEERLOOM_DIR` to choose
another folder), adds Node.js 22 just for Steerloom when yours is missing or
older (checksum-verified), unpacks the app with Windows' built-in `tar`, adds
**Steerloom** to the Start menu and the desktop, and opens it in a Microsoft
Edge app window. Next time, open it from the Start menu or the desktop. Stop it
with `%USERPROFILE%\steerloom\stop-steerloom.cmd`. Running the command again
updates Steerloom and keeps your local data.

On managed computers, a company proxy, antivirus or download policy can block
nodejs.org or the Steerloom download. If the command stops with an error, ask
IT to allow those sites or use the steps below.

## Step by step (if you prefer)

The download is the ready-to-run app: a small server (`server.mjs`) and the
built web app. It needs Node.js 22 or newer and nothing else. Install Node.js
for your operating system, save `steerloom-local.tar.gz` to Downloads, and open
Terminal (macOS) or PowerShell (Windows) in that folder.

On macOS:

```sh
tar -xzf steerloom-local.tar.gz
cd steerloom-local
node server.mjs --open
```

On Windows PowerShell:

```powershell
tar -xzf .\steerloom-local.tar.gz
cd .\steerloom-local
node server.mjs --open
```

Then open `http://127.0.0.1:5173/` and create your local account. Choose
**Connect Jira** and paste a Jira project link. For Jira Data Center, enter your
personal access token. For Jira Cloud (`*.atlassian.net`), enter your Atlassian
account email and an API token created at
[id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
Steerloom only reads from Jira. You can also connect Trello or try the fictional
demo without connecting Jira.

Some companies put Jira Data Center behind an API gateway that needs its own
key, separate from your personal access token: the token says who you are, the
key lets the request through the gateway. Ask the team that runs Jira access at
your company for it. If the gateway turns Steerloom away, Steerloom says so and
opens the **API gateway key** field for you.

Steerloom uses your computer's own proxy settings (macOS network settings or
Windows Internet Settings) when `HTTPS_PROXY` is not set, so it reaches sites
outside your company network the same way your browser does. Company Jira only
needs the VPN or office network. Automatic proxy files (PAC) are not followed:
if your company uses only a PAC file, set `HTTPS_PROXY` in `.env.local`.

If you started it by hand, keep that window open while you use Steerloom; on
later visits run `node server.mjs --open` from this folder again and stop it with
Ctrl+C. Port 5173 is used by default; set `STEERLOOM_PORT` in `.env.local` to
change it (Google and Atlassian sign-in expect 5173). Keep `.flowlens/` and its
encryption key together, private, and backed up according to your organization's
rules. Do not upload `.flowlens/` or `.env.local` to a repository or support ticket.

The local app does not require an AI service. If your organization approves one,
configure the optional AI endpoint locally using `.env.example` as a guide. AI
requests can send a minimized report snapshot and selected Jira evidence to that
endpoint; leave it unconfigured if this is not permitted.
