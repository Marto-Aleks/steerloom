import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Part of the macOS/Linux install command: on a Mac whose network settings
 * use a proxy (common on company laptops, where the web is only reachable
 * through it), adds curl's -x with that proxy; elsewhere it adds nothing.
 * Terminal does not follow the system proxy on its own.
 */
export const SYSTEM_PROXY_FLAG =
  '$(scutil --proxy 2>/dev/null | awk \'/HTTPSEnable : 1/{e=1}/HTTPSProxy :/{h=$3}/HTTPSPort :/{p=$3}END{if(e&&h)printf "-x http://%s:%s",h,p}\')'

/** The one command shown on the Steerloom page for macOS and Linux. */
export function unixInstallCommand(
  origin: string,
  token: string,
  update = false,
): string {
  return `curl -fsSL ${SYSTEM_PROXY_FLAG} "${origin}/api/hosted/install.sh?t=${token}${update ? '&u=1' : ''}" | sh`
}

/** How long a copied install command keeps working. */
export const INSTALL_LINK_MINUTES = 30

/**
 * Short-lived install links let anyone paste one command into a terminal,
 * with no account, without leaving the package at a permanent public
 * address. Links are
 * stateless HMACs over their expiry; a server restart invalidates them.
 */
export function installLinks(
  secret: Buffer = randomBytes(32),
  now: () => number = Date.now,
) {
  const sign = (expires: number) =>
    createHmac('sha256', secret)
      .update(`steerloom-install:${expires}`)
      .digest('base64url')
  return {
    issue(): { token: string; expiresAt: number } {
      const expires = now() + INSTALL_LINK_MINUTES * 60_000
      return { token: `${expires}.${sign(expires)}`, expiresAt: expires }
    },
    valid(token: string | null): boolean {
      const match = /^(\d{13})\.([\w-]{43})$/.exec(token ?? '')
      if (!match) return false
      const expires = Number(match[1])
      if (!(expires > now())) return false
      const expected = Buffer.from(sign(expires))
      const given = Buffer.from(match[2]!)
      return (
        expected.length === given.length && timingSafeEqual(expected, given)
      )
    },
  }
}

/**
 * POSIX shell installer for macOS and Linux. Everything runs inside main() so
 * the shell has read the whole script before any command can consume the
 * piped input, and child processes get /dev/null as stdin.
 */
export function installScript(archiveUrl: string): string {
  if (!/^https?:\/\/[^\s'"]+$/.test(archiveUrl))
    throw new Error('Invalid archive address.')
  return `#!/bin/sh
# Steerloom local installer for macOS and Linux.
# Installs into ~/steerloom (override with STEERLOOM_DIR). No admin rights needed.
set -eu

ARCHIVE_URL='${archiveUrl}'
NODE_MAJOR=22

say() { printf '\\n\\033[1m%s\\033[0m\\n' "$*"; }
fail() { printf '\\n\\033[31m%s\\033[0m\\n' "$*" >&2; exit 1; }

node_ok() {
  command -v node >/dev/null 2>&1 &&
    [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" -ge "$NODE_MAJOR" ] 2>/dev/null
}

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

install_node() {
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  case "$os" in darwin|linux) ;; *) fail "This installer supports macOS and Linux. On Windows, follow the step-by-step guide." ;; esac
  case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64) arch=x64 ;;
    *) fail "Unsupported processor: $(uname -m)" ;;
  esac
  base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  say "Installing Node.js $NODE_MAJOR into $DIR/node (only for Steerloom)..."
  sums=$(curl -fsSL "$base/SHASUMS256.txt") || fail "Could not reach nodejs.org."
  file=$(printf '%s\\n' "$sums" | awk -v want="-$os-$arch.tar.gz" 'substr($2, length($2) - length(want) + 1) == want && $2 ~ /^node-v/ {print $2; exit}')
  [ -n "$file" ] || fail "No Node.js download found for $os-$arch."
  expected=$(printf '%s\\n' "$sums" | awk -v f="$file" '$2 == f {print $1}')
  curl -fsSL "$base/$file" -o "$DIR/node.tar.gz" || fail "Node.js download failed."
  [ "$(sha256 "$DIR/node.tar.gz")" = "$expected" ] || fail "Node.js download did not match its checksum."
  # Only Steerloom's own Node.js folder is replaced, never another "node".
  # An empty folder, or one left by an install that stopped halfway, is ours.
  if [ -e "$DIR/node" ] && [ ! -x "$DIR/node/bin/node" ] && [ ! -e "$DIR/node/.steerloom" ] &&
    [ -n "$(ls -A "$DIR/node" 2>/dev/null)" ]; then
    rm -f "$DIR/node.tar.gz"
    fail "$DIR/node exists and is not Steerloom's Node.js. Move it, or set STEERLOOM_DIR to another folder."
  fi
  rm -rf "$DIR/node" && mkdir -p "$DIR/node" && : >"$DIR/node/.steerloom"
  tar -xzf "$DIR/node.tar.gz" -C "$DIR/node" --strip-components 1
  rm -f "$DIR/node.tar.gz"
}

# Replaces the app files and keeps the person's data: .flowlens/ (accounts,
# encrypted connections, dashboards) and .env.local (their own settings).
replace_app() {
  APP="$DIR/steerloom-local"
  mkdir -p "$APP"
  for entry in "$APP"/* "$APP"/.[!.]*; do
    [ -e "$entry" ] || continue
    case "\${entry##*/}" in .flowlens|.env.local) ;; *) rm -rf "$entry" ;; esac
  done
  cp -R "$1/steerloom-local/." "$APP/"
}

write_launchers() {
  NODE_BIN=$(command -v node)
  cat >"$DIR/start-steerloom" <<START
#!/bin/sh
# Starts Steerloom in the background (if it is not running yet) and opens it.
cd "$APP" || exit 1
"$NODE_BIN" "$APP/server.mjs" --open >>"$DIR/steerloom.log" 2>&1 </dev/null &
START
  cat >"$DIR/stop-steerloom" <<STOP
#!/bin/sh
if pkill -f "$APP/server.mjs" 2>/dev/null; then echo "Steerloom stopped."; else echo "Steerloom was not running."; fi
STOP
  chmod +x "$DIR/start-steerloom" "$DIR/stop-steerloom"

  if [ "$(uname -s)" = Darwin ]; then
    BUNDLE="$HOME/Applications/Steerloom.app"
    rm -rf "$BUNDLE"
    mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
    cat >"$BUNDLE/Contents/MacOS/Steerloom" <<LAUNCH
#!/bin/sh
exec "$DIR/start-steerloom"
LAUNCH
    chmod +x "$BUNDLE/Contents/MacOS/Steerloom"
    sips -s format icns "$APP/dist/icons/steerloom-512.png" --out "$BUNDLE/Contents/Resources/Steerloom.icns" >/dev/null 2>&1 || true
    cat >"$BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Steerloom</string>
  <key>CFBundleDisplayName</key><string>Steerloom</string>
  <key>CFBundleIdentifier</key><string>app.steerloom.local</string>
  <key>CFBundleExecutable</key><string>Steerloom</string>
  <key>CFBundleIconFile</key><string>Steerloom</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
    touch "$BUNDLE"
    LAUNCHER="Open Steerloom from Launchpad or Spotlight (it is in ~/Applications)."
  else
    mkdir -p "$HOME/.local/share/applications"
    cat >"$HOME/.local/share/applications/steerloom.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Steerloom
Comment=Delivery flow briefings from your boards
Exec="$DIR/start-steerloom"
Icon=$APP/dist/icons/steerloom-512.png
Terminal=false
Categories=Office;ProjectManagement;
DESKTOP
    LAUNCHER="Open Steerloom from your applications menu."
  fi
}

# Terminal does not follow the computer's proxy settings; the browser does.
# On a Mac with a system proxy, use it for every download here.
use_system_proxy() {
  [ -n "\${HTTPS_PROXY:-}\${https_proxy:-}" ] && return 0
  command -v scutil >/dev/null 2>&1 || return 0
  P=$(scutil --proxy | awk '/HTTPSEnable : 1/{e=1} /HTTPSProxy :/{h=$3} /HTTPSPort :/{p=$3} END{if(e&&h)printf "http://%s:%s",h,p}')
  [ -n "$P" ] || return 0
  HTTPS_PROXY=$P; HTTP_PROXY=$P; https_proxy=$P; http_proxy=$P
  export HTTPS_PROXY HTTP_PROXY https_proxy http_proxy
  say "Using your computer's proxy ($P)"
}

main() {
  use_system_proxy
  DIR="\${STEERLOOM_DIR:-$HOME/steerloom}"
  mkdir -p "$DIR"
  if [ -x "$DIR/node/bin/node" ]; then PATH="$DIR/node/bin:$PATH"; export PATH; fi
  if ! node_ok; then
    install_node
    PATH="$DIR/node/bin:$PATH"; export PATH
  fi
  say "Using Node.js $(node --version)"

  say "Downloading Steerloom..."
  TMP=$(mktemp -d)
  curl -fsSL "$ARCHIVE_URL" -o "$TMP/steerloom-local.tar.gz" ||
    fail "Download failed. The command is valid for 30 minutes; copy a fresh one from the Steerloom page."
  tar -xzf "$TMP/steerloom-local.tar.gz" -C "$TMP" || fail "The download could not be unpacked."
  [ -f "$TMP/steerloom-local/server.mjs" ] || fail "The download is incomplete. Copy a fresh command and try again."

  # Stop a running copy before replacing its files: this version, or the
  # development server earlier installers started with npm run dev.
  pkill -f "$DIR/steerloom-local/server.mjs" 2>/dev/null || true
  pkill -f "$DIR/steerloom-local/node_modules/.bin/vite" 2>/dev/null || true
  replace_app "$TMP"
  rm -rf "$TMP"
  write_launchers

  if [ "\${STEERLOOM_NO_START:-}" = 1 ]; then say "Installed. $LAUNCHER"; return 0; fi
  "$DIR/start-steerloom"
  say "Steerloom is opening at http://127.0.0.1:5173/"
  printf '%s\\nYou can close this window. To stop Steerloom: %s/stop-steerloom\\n' "$LAUNCHER" "$DIR"
}

main "$@"
`
}

/**
 * Windows PowerShell installer (Windows PowerShell 5.1 and PowerShell 7), run
 * with `irm ... | iex`. Because iex runs inside the person's own window,
 * failures are reported and the function returns instead of calling exit,
 * which would close that window before the message can be read.
 */
export function installPowerShellScript(archiveUrl: string): string {
  if (!/^https?:\/\/[A-Za-z0-9._~:/?#[\]@!&()*+,;=%-]+$/.test(archiveUrl))
    throw new Error('Invalid archive address.')
  return String.raw`# Steerloom local installer for Windows (PowerShell 5.1 or 7).
# Installs into $HOME\steerloom (override with $env:STEERLOOM_DIR). No admin rights needed.

$SteerloomArchiveUrl = '${archiveUrl}'

function Write-SteerloomStep([string]$Message) {
  Write-Host ''
  Write-Host $Message -ForegroundColor Cyan
}

# Native programs report failure through exit codes, not PowerShell errors.
# Their warnings on stderr must not stop the install either.
function Invoke-SteerloomNative([string]$What, [scriptblock]$Command) {
  $global:LASTEXITCODE = 0
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Command } finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

# Windows 10 and 11 ship bsdtar. Call it by full path so another tar on PATH
# (for example Git for Windows) cannot misread C:\ paths.
function Get-SteerloomTar {
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path -LiteralPath $tar) { return $tar }
  if (Get-Command tar.exe -ErrorAction SilentlyContinue) { return 'tar.exe' }
  throw 'This installer needs Windows 10 (version 1803) or newer, which includes tar.'
}

function Get-SteerloomNodeMajor {
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { return 0 }
  try { $version = (& node.exe --version 2>$null | Out-String).Trim() } catch { return 0 }
  if ($version -match '^v(\d+)\.') { return [int]$Matches[1] }
  return 0
}

function Install-SteerloomNode([string]$Dir, [int]$Major) {
  $machine = $env:PROCESSOR_ARCHITEW6432
  if (-not $machine) { $machine = $env:PROCESSOR_ARCHITECTURE }
  switch ($machine) {
    'AMD64' { $arch = 'x64' }
    'ARM64' { $arch = 'arm64' }
    default { throw "Unsupported processor: $machine" }
  }
  $base = "https://nodejs.org/dist/latest-v$Major.x"
  Write-SteerloomStep "Installing Node.js $Major into $Dir\node (only for Steerloom)..."
  try { $content = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt").Content }
  catch { throw "Could not reach nodejs.org ($($_.Exception.Message)). Check your internet connection or proxy settings." }
  if ($content -is [byte[]]) { $content = [Text.Encoding]::ASCII.GetString($content) }
  $file = $null
  $expected = $null
  foreach ($line in ([string]$content -split '\r?\n')) {
    if ($line -match ('^([0-9a-f]{64})\s+(node-v[0-9.]+-win-' + $arch + '\.zip)$')) {
      $expected = $Matches[1]
      $file = $Matches[2]
      break
    }
  }
  if (-not $file) { throw "No Node.js download found for win-$arch." }
  $zip = Join-Path $Dir 'node.zip'
  try { Invoke-WebRequest -UseBasicParsing -Uri "$base/$file" -OutFile $zip }
  catch { throw "Node.js download failed ($($_.Exception.Message)). Check your internet connection or proxy settings." }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    Remove-Item -LiteralPath $zip -Force
    throw 'Node.js download did not match its checksum.'
  }
  $target = Join-Path $Dir 'node'
  # Only Steerloom's own Node.js folder is replaced, never another "node".
  # An empty folder, or one left by an install that stopped halfway, is ours.
  if ((Test-Path -LiteralPath $target) -and
      -not (Test-Path -LiteralPath (Join-Path $target 'node.exe')) -and
      -not (Test-Path -LiteralPath (Join-Path $target '.steerloom')) -and
      (Get-ChildItem -LiteralPath $target -Force | Select-Object -First 1)) {
    Remove-Item -LiteralPath $zip -Force
    throw "$target exists and is not Steerloom's Node.js. Move it, or set STEERLOOM_DIR to another folder."
  }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  New-Item -ItemType File -Force -Path (Join-Path $target '.steerloom') | Out-Null
  # bsdtar reads zip files and strips the top folder much faster than Expand-Archive.
  $tar = Get-SteerloomTar
  Invoke-SteerloomNative 'Unpacking Node.js' { & $tar -xf $zip -C $target --strip-components 1 }
  Remove-Item -LiteralPath $zip -Force
}

function Install-Steerloom {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $nodeMajor = 22
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch { }
  # Let company proxies that use Windows sign-in through (PowerShell 5.1).
  try { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch { }
  try {
    $dir = $env:STEERLOOM_DIR
    if (-not $dir) { $dir = Join-Path $HOME 'steerloom' }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $nodeDir = Join-Path $dir 'node'
    if (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe')) { $env:Path = "$nodeDir;$env:Path" }
    if ((Get-SteerloomNodeMajor) -lt $nodeMajor) {
      Install-SteerloomNode $dir $nodeMajor
      $env:Path = "$nodeDir;$env:Path"
    }
    Write-SteerloomStep "Using Node.js $(& node.exe --version)"

    Write-SteerloomStep 'Downloading Steerloom...'
    $temp = Join-Path ([IO.Path]::GetTempPath()) ('steerloom-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $temp | Out-Null
    $archive = Join-Path $temp 'steerloom-local.tar.gz'
    try { Invoke-WebRequest -UseBasicParsing -Uri $SteerloomArchiveUrl -OutFile $archive }
    catch { throw "Download failed ($($_.Exception.Message)). The command is valid for 30 minutes; copy a fresh one from the Steerloom page." }
    $tar = Get-SteerloomTar
    Invoke-SteerloomNative 'Unpacking Steerloom' { & $tar -xzf $archive -C $temp }
    if (-not (Test-Path -LiteralPath (Join-Path $temp 'steerloom-local\server.mjs'))) {
      throw 'The download is incomplete. Copy a fresh command and try again.'
    }

    # Stop a running copy (this version, or the development server earlier
    # installers started) so its files can be replaced.
    $app = Join-Path $dir 'steerloom-local'
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($app) } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    # Replace the app files; keep the person's data (.flowlens) and settings (.env.local).
    New-Item -ItemType Directory -Force -Path $app | Out-Null
    Get-ChildItem -LiteralPath $app -Force | Where-Object { $_.Name -ne '.flowlens' -and $_.Name -ne '.env.local' } |
      Remove-Item -Recurse -Force
    Copy-Item -Path (Join-Path $temp 'steerloom-local\*') -Destination $app -Recurse -Force
    Remove-Item -LiteralPath $temp -Recurse -Force

    $nodeExe = (Get-Command node.exe).Source
    $server = Join-Path $app 'server.mjs'
    $log = Join-Path $dir 'steerloom.log'

    # The launcher: starts Steerloom without a console window and opens it.
    $vbs = Join-Path $dir 'steerloom.vbs'
    $q = [char]34
    Set-Content -LiteralPath $vbs -Encoding Ascii -Value @(
      'Set shell = CreateObject("WScript.Shell")',
      ('shell.CurrentDirectory = ' + $q + $app + $q),
      ('shell.Run "cmd /c " & Chr(34) & Chr(34) & ' + $q + $nodeExe + $q + ' & Chr(34) & " " & Chr(34) & ' + $q + $server + $q + ' & Chr(34) & " --open >> " & Chr(34) & ' + $q + $log + $q + ' & Chr(34) & " 2>&1" & Chr(34), 0, False')
    )
    $start = Join-Path $dir 'start-steerloom.cmd'
    Set-Content -LiteralPath $start -Encoding Ascii -Value @(
      '@echo off',
      'start "" wscript.exe "%~dp0steerloom.vbs"'
    )
    $stop = Join-Path $dir 'stop-steerloom.cmd'
    Set-Content -LiteralPath $stop -Encoding Ascii -Value @(
      '@echo off',
      ('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter ' + [char]39 + 'Name = ' + [char]39 + [char]39 + 'node.exe' + [char]39 + [char]39 + [char]39 + ' | Where-Object { $_.CommandLine -like ' + [char]39 + '*steerloom-local\server.mjs*' + [char]39 + ' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"'),
      'echo Steerloom stopped.'
    )

    # Start menu and desktop shortcuts with the Steerloom icon.
    $icon = Join-Path $app 'dist\icons\steerloom.ico'
    $shell = New-Object -ComObject WScript.Shell
    $places = @(
      (Join-Path ([Environment]::GetFolderPath('Programs')) 'Steerloom.lnk'),
      (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Steerloom.lnk')
    )
    foreach ($place in $places) {
      try {
        $link = $shell.CreateShortcut($place)
        $link.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
        $link.Arguments = $q + $vbs + $q
        $link.WorkingDirectory = $dir
        $link.IconLocation = $icon
        $link.Description = 'Steerloom'
        $link.Save()
      } catch { }
    }

    if ($env:STEERLOOM_NO_START -eq '1') {
      Write-SteerloomStep 'Installed. Open Steerloom from the Start menu or your desktop.'
      return
    }
    & wscript.exe $vbs
    Write-SteerloomStep 'Steerloom is opening at http://127.0.0.1:5173/'
    Write-Host 'Open it next time from the Start menu or your desktop. You can close this window.'
    Write-Host ('To stop Steerloom: ' + $stop)
  } catch {
    Write-Host ''
    Write-Host $_.Exception.Message -ForegroundColor Red
  }
}

Install-Steerloom
`
}

/**
 * Served instead of the installer when the link has expired or was forged.
 * It does not call exit: under `irm | iex` that would close the window.
 */
export const EXPIRED_POWERSHELL_SCRIPT =
  "Write-Host 'This Steerloom install command has expired. Copy a fresh one from the Steerloom page.' -ForegroundColor Red\n"
