#requires -Version 5.1
<#
.SYNOPSIS
  hapi-pet-install-runner: one-shot install/upgrade for a Windows HAPI runner
  joining an EXISTING hub. Does not install or manage a hub on this machine —
  this is the Windows counterpart of install-hapi-pet.sh --runner-only (#339).

.DESCRIPTION
  Fetches the sealed fleet-channel single-exe binary (hapi-windows-x64.exe,
  same hapi-fleet GH channel as the Linux pet installer), verifies it runs,
  swaps it into place, ensures Node.js + the Claude Code CLI are present
  BEFORE launching anything (a detached process's environment is a snapshot
  at creation time — installing Claude afterward would leave an already-
  running runner reporting it as not_found forever, exactly like the bug
  fixed in #339 on Linux), then starts the runner pointed at -HubUrl with
  -Token as CLI_API_TOKEN.

  Safe to re-run: an already-running local runner (tracked via runner.pid)
  is stopped before the binary is swapped and the runner relaunched.

  Does NOT install/manage a hub on this machine, and does NOT set up
  persistence across reboot/logoff (no Windows Service / Scheduled Task) —
  the runner here matches the Linux nohup tier, not --with-systemd. Both are
  real follow-up work, not attempted in this first pass; track in #339.

  Confirmed live against a real Windows 11 box (2026-11-20): if you run this
  OVER SSH (not from a real logged-in console/RDP session), the launched
  runner dies silently a short time after the SSH session that started it
  closes, with a clean log and no error — Win32-OpenSSH tears down the whole
  job object its session spawned, which kills Start-Process children too,
  -WindowStyle Hidden and redirected output notwithstanding. Run this from
  an actual interactive session on the box (or script the persistence work
  above first) if it needs to survive your SSH connection ending.

.PARAMETER HubUrl
  URL of the existing hub to join (same value as that hub's HAPI_API_URL).
  Also settable via $env:HAPI_HUB_URL. With neither, and running in a real
  console, you are prompted.

.PARAMETER Token
  CLI_API_TOKEN from that hub's own settings.json/terminal output. Also
  settable via $env:HAPI_RUNNER_TOKEN. Never written back to the console.

.EXAMPLE
  .\install-hapi-pet-runner.ps1 -HubUrl https://your-hub.example.ts.net -Token <CLI_API_TOKEN>

.EXAMPLE
  $env:HAPI_HUB_URL = "https://your-hub.example.ts.net"
  $env:HAPI_RUNNER_TOKEN = "<CLI_API_TOKEN>"
  .\install-hapi-pet-runner.ps1
#>
[CmdletBinding()]
param(
    [string]$HubUrl = $env:HAPI_HUB_URL,
    [string]$Token = $env:HAPI_RUNNER_TOKEN,
    [string]$InstallDir = $(if ($env:HAPI_INSTALL_DIR) { $env:HAPI_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.hapi\bin' }),
    [string]$HapiHome = $(if ($env:HAPI_HOME) { $env:HAPI_HOME } else { Join-Path $env:USERPROFILE '.hapi' }),
    [string]$Workspace = $(if ($env:HAPI_WORKSPACE) { $env:HAPI_WORKSPACE } else { Join-Path $env:USERPROFILE '.hapi-workspace' }),
    [string]$ArtifactUrl = $env:HAPI_ARTIFACT_URL,
    [string]$ReleasesRepo = $(if ($env:HAPI_RELEASES_REPO) { $env:HAPI_RELEASES_REPO } else { 'heavygee/hapi' }),
    [string]$FleetChannelTag = $(if ($env:HAPI_FLEET_GH_CHANNEL_TAG) { $env:HAPI_FLEET_GH_CHANNEL_TAG } else { 'hapi-fleet' })
)

$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message) { Write-Host "==> $Message" }
function Fail([string]$Message) { Write-Error "ERROR: $Message"; exit 1 }

function Test-InteractiveConsole {
    try {
        return [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
    } catch {
        return $false
    }
}

function Test-TokenLooksSane([string]$T) {
    if ([string]::IsNullOrEmpty($T)) { return $false }
    if ($T.Length -lt 16) { return $false }
    return ($T -match '^[A-Za-z0-9_-]+$')
}

# --- 0. Collect HubUrl/Token: prompt only when nothing was supplied and a
#     real console is attached. No prompt + nothing supplied (unattended,
#     piped, CI) fails fast with clear usage instead of hanging. ---
if ([string]::IsNullOrEmpty($HubUrl) -or [string]::IsNullOrEmpty($Token)) {
    if (Test-InteractiveConsole) {
        if ([string]::IsNullOrEmpty($HubUrl)) {
            $HubUrl = Read-Host -Prompt 'Hub URL (e.g. https://your-hub.example.ts.net)'
        }
        if ([string]::IsNullOrEmpty($Token)) {
            $Token = Read-Host -Prompt "CLI_API_TOKEN (from that hub's settings.json/terminal output)"
        }
    }
}

if ($HubUrl -notmatch '^https?://') {
    Fail "need a hub URL (-HubUrl https://... or `$env:HAPI_HUB_URL) — got: '$HubUrl'"
}
if (-not (Test-TokenLooksSane $Token)) {
    Fail "need a CLI_API_TOKEN (-Token ... or `$env:HAPI_RUNNER_TOKEN) that looks like a real token — got $($Token.Length) chars"
}
Write-Log "Mode: runner-only, joining $HubUrl"

# --- 1. Fetch + sanity-check the new binary BEFORE touching anything running.
#     Mirrors install-hapi-pet.sh step 3: a bad URL/corrupt download fails
#     here with any previous install still fully untouched and running. ---
if ([string]::IsNullOrEmpty($ArtifactUrl)) {
    $ArtifactUrl = "https://github.com/$ReleasesRepo/releases/download/$FleetChannelTag/hapi-windows-x64.exe"
}
Write-Log "Artifact source: $ArtifactUrl"
$tmpBin = Join-Path $env:TEMP ("hapi-pet-install-" + [guid]::NewGuid().ToString('N') + '.exe')
try {
    Invoke-WebRequest -Uri $ArtifactUrl -OutFile $tmpBin -UseBasicParsing -TimeoutSec 120
} catch {
    Fail "download from $ArtifactUrl failed: $($_.Exception.Message)"
}
& $tmpBin --version | Out-Null
if ($LASTEXITCODE -ne 0) {
    Remove-Item -Force $tmpBin -ErrorAction SilentlyContinue
    Fail "fetched file at $tmpBin does not run (--version failed) — corrupt download or wrong architecture, nothing has been touched"
}
Write-Log "New binary fetched and verified runnable."

# --- 2. Confirm the target hub is actually reachable before stopping
#     anything local. ---
try {
    $null = Invoke-WebRequest -Uri ($HubUrl.TrimEnd('/') + '/health') -UseBasicParsing -TimeoutSec 10
} catch {
    Remove-Item -Force $tmpBin -ErrorAction SilentlyContinue
    Fail "cannot reach $($HubUrl.TrimEnd('/'))/health — check the URL and that the hub is actually up before joining it as a runner"
}
Write-Log "Target hub reachable: $HubUrl"

# --- 3. Stop an already-running LOCAL runner from a previous install, if
#     any (upgrade path; no-op on fresh install). Only reached after step 1's
#     new binary is confirmed good. ---
$runnerPidFile = Join-Path $HapiHome 'runner.pid'
if (Test-Path $runnerPidFile) {
    $oldPid = Get-Content $runnerPidFile -ErrorAction SilentlyContinue
    if ($oldPid) {
        $oldProc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
        if ($oldProc -and $oldProc.ProcessName -match '^hapi') {
            Write-Log "Found running runner (pid=$oldPid), stopping for upgrade."
            Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
            $oldProc.WaitForExit(15000) | Out-Null
        }
    }
}

# --- 4. Install to a user-writable location + persist PATH (both the
#     current process AND future sessions — the Windows equivalent of the
#     bash installer's .bashrc edit). ---
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$hapiExe = Join-Path $InstallDir 'hapi.exe'
Move-Item -Force $tmpBin $hapiExe
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $InstallDir })) {
    Write-Log "Adding $InstallDir to the User PATH"
    [Environment]::SetEnvironmentVariable('PATH', "$InstallDir;$userPath", 'User')
}
if (-not ($env:PATH -split ';' | Where-Object { $_ -eq $InstallDir })) {
    $env:PATH = "$InstallDir;$env:PATH"
}
Write-Log "hapi installed at $hapiExe"

# --- 5. Node.js + Claude Code CLI — BEFORE launching the runner below.
#     A process launched via Start-Process inherits this script's current
#     environment as a snapshot at creation time; installing Claude into
#     PATH *after* the runner starts would leave it reporting Claude as
#     not_found forever despite this script printing success (#339, found
#     live on the Linux side first, same root cause applies here).
#
#     Unlike the Linux installer's nvm fallback, this does NOT attempt to
#     auto-install Node.js — Windows has no single blessed unattended path
#     as uniform as nvm (winget vs the nodejs.org MSI vs an existing
#     corporate image are all real, different choices). Fail clearly instead
#     and let the person pick; Claude auth is already a deliberate manual
#     step in the Linux installer for the same reason.
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Fail "npm not found. Install Node.js first (e.g. 'winget install OpenJS.NodeJS.LTS'), open a new terminal, then re-run this script."
    }
    Write-Log "Installing Claude Code CLI"
    npm install -g '@anthropic-ai/claude-code'
    if ($LASTEXITCODE -ne 0) {
        Fail "Claude Code CLI install failed (npm exit $LASTEXITCODE) — see output above"
    }
}

# --- 6. Launch. Detached background process for this session — the
#     Windows counterpart of the Linux nohup tier, not a Windows Service /
#     Scheduled Task. Does not survive logoff/reboot; that's real follow-up
#     work (#339), not attempted here. ---
New-Item -ItemType Directory -Force -Path (Join-Path $HapiHome 'logs') | Out-Null
New-Item -ItemType Directory -Force -Path $Workspace | Out-Null
$env:HAPI_API_URL = $HubUrl
$env:CLI_API_TOKEN = $Token
$stdout = Join-Path $HapiHome 'logs\runner.out.log'
$stderr = Join-Path $HapiHome 'logs\runner.err.log'
$proc = Start-Process -FilePath $hapiExe `
    -ArgumentList @('runner', 'start-sync', '--workspace-root', $Workspace) `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
Start-Sleep -Seconds 3
if ($proc.HasExited) {
    Fail "runner exited immediately — check $stdout / $stderr (common cause: bad token — it is not validated against the hub until the runner actually tries to connect)"
}
Set-Content -Path $runnerPidFile -Value $proc.Id
Write-Log "Runner started (pid=$($proc.Id)), joined $HubUrl, restricted to $Workspace."
Write-Log "Check that hub's Machines list to confirm this box registered."
Write-Log 'Claude Code authentication is still a deliberate one-time step — see docs/guide/pet-install.md for the setup-token flow.'
