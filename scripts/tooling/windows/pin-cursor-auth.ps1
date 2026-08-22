# Sync CURSOR_API_KEY from auth.json into ~/.hapi/cursor.env (preserve other keys).
# Windows twin of pin-cursor-auth.sh — run before runner start or from audit/sync.
$ErrorActionPreference = 'Stop'
$userHome = $env:USERPROFILE.TrimEnd()
$hapiHome = Join-Path $userHome '.hapi'
$cursorEnvPath = Join-Path $hapiHome 'cursor.env'
$authPath = Join-Path $userHome '.config\cursor\auth.json'
$apiKeyEnvPath = Join-Path $userHome '.config\cursor\api-key.env'

if (-not (Test-Path -LiteralPath $authPath)) {
    Write-Error "missing auth.json at $authPath"
    exit 1
}

$auth = Get-Content -LiteralPath $authPath -Raw | ConvertFrom-Json
$key = [string]$auth.apiKey
if (-not $key.StartsWith('crsr_')) {
    Write-Error 'auth.json apiKey invalid'
    exit 1
}

New-Item -ItemType Directory -Force -Path (Split-Path $apiKeyEnvPath) | Out-Null
@(
    '# Derived from ~/.config/cursor/auth.json — pin-cursor-auth.ps1. Do not hand-edit.'
    "CURSOR_API_KEY=$key"
) | Set-Content -LiteralPath $apiKeyEnvPath -Encoding utf8

$lines = @()
if (Test-Path -LiteralPath $cursorEnvPath) {
    $lines = @(Get-Content -LiteralPath $cursorEnvPath)
}
$filtered = @($lines | Where-Object {
    $t = $_.Trim()
    -not ($t -like 'CURSOR_API_KEY=*' -or $t -like '#CURSOR_API_KEY=*')
})
$filtered += "CURSOR_API_KEY=$key"
$filtered | Set-Content -LiteralPath $cursorEnvPath -Encoding utf8
