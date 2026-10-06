# hapi-cursor-auth-audit.ps1 — Windows fleet Cursor auth coherence (sha12 only).
# Invoked by scripts/tooling/hapi-cursor-auth-audit.sh over SSH on Teemo.
$ErrorActionPreference = 'Stop'

function Get-EnvKey([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $t = $line.Trim()
        if ($t -like 'CURSOR_API_KEY=*' -and -not $t.StartsWith('#')) {
            return $t.Substring(15)
        }
    }
    return $null
}

function Get-Sha12([string]$Key) {
    if (-not $Key) { return $null }
    $bytes = [Text.Encoding]::UTF8.GetBytes($Key)
    $hash = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
    return ([BitConverter]::ToString($hash).Replace('-', '').Substring(0, 12)).ToLower()
}

function Add-Row([System.Collections.Generic.List[object]]$Rows, [string]$Check, [string]$Sha, [string]$Status) {
    $Rows.Add([ordered]@{ check = $Check; sha12 = $(if ($Sha) { $Sha } else { '-' }); status = $Status }) | Out-Null
}

$userHome = $env:USERPROFILE.TrimEnd()
$rows = [System.Collections.Generic.List[object]]::new()

$cursorEnvPath = Join-Path $userHome '.hapi\cursor.env'
$cursorKey = Get-EnvKey $cursorEnvPath
$canonical = Get-Sha12 $cursorKey

$authPath = Join-Path $userHome '.config\cursor\auth.json'
$authKey = $null
if (Test-Path -LiteralPath $authPath) {
    try {
        $auth = Get-Content -LiteralPath $authPath -Raw | ConvertFrom-Json
        $authKey = $auth.apiKey
    } catch {
        $authKey = $null
    }
}
$authSha = Get-Sha12 $authKey

Add-Row $rows 'auth.json' $authSha $(if (-not $authSha) { 'missing' } elseif ($authSha -eq $canonical) { 'MATCH' } else { 'DIFFERENT' })
Add-Row $rows 'cursor.env' (Get-Sha12 $cursorKey) $(if (-not $cursorKey) { 'missing' } elseif ((Get-Sha12 $cursorKey) -eq $canonical) { 'MATCH' } else { 'DIFFERENT' })

$apiKeyEnvPath = Join-Path $userHome '.config\cursor\api-key.env'
$apiSha = Get-Sha12 (Get-EnvKey $apiKeyEnvPath)
if ($apiSha) {
    Add-Row $rows 'api-key.env' $apiSha $(if ($apiSha -eq $canonical) { 'MATCH' } else { 'DIFFERENT' })
} else {
    Add-Row $rows 'api-key.env' $null 'missing'
}

$bunProcs = @(Get-Process bun -ErrorAction SilentlyContinue)
if ($bunProcs.Count -gt 0) {
    $runnerSha = $null
    foreach ($proc in $bunProcs) {
        try {
            $envBlock = (Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.Id)").CommandLine
            if ($envBlock -match 'runner') {
                $runnerSha = $canonical
                break
            }
        } catch { }
    }
    if ($runnerSha) {
        Add-Row $rows 'runner(bun)' $runnerSha 'MATCH'
    } else {
        Add-Row $rows 'runner(bun)' $null 'running_no_runner_match'
    }
} else {
    Add-Row $rows 'runner(bun)' $null 'inactive'
}

$pinPath = Join-Path $userHome '.hapi\pin-cursor-auth.ps1'
Add-Row $rows 'pin-script' $null $(if (Test-Path -LiteralPath $pinPath) { 'present' } else { 'missing' })

$drift = $false
foreach ($row in $rows) {
    if ($row.status -eq 'DIFFERENT') { $drift = $true }
}

$payload = [ordered]@{
    canonical_sha12 = $canonical
    rows            = $rows
    drift           = $drift
}
$payload | ConvertTo-Json -Compress -Depth 4
