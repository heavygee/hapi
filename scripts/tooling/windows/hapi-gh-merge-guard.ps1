# hapi-gh-merge-guard — teemo (Windows) has no bash, so it cannot run
# hapi-pr-merge-gate.sh. It therefore must not merge HAPI work at all.
#
# SCOPE: HAPI repos only. Other projects pass straight through — they have their
# own concerns and must not inherit this gate.
# Origin: 2026-09-13 tiann/hapi#1842. See docs/operator/AGENTS.md.

$script:HapiMergeGateRepos = @('tiann/hapi', 'heavygee/hapi')

function gh {
    if ($args.Count -ge 2 -and $args[0] -eq 'pr' -and $args[1] -eq 'merge') {
        $repo = ''
        for ($i = 0; $i -lt $args.Count - 1; $i++) {
            if ($args[$i] -eq '--repo') { $repo = $args[$i + 1]; break }
        }
        if (-not $repo) {
            $repo = (& "C:\Program Files\GitHub CLI\gh.exe" repo view --json nameWithOwner -q .nameWithOwner 2>$null)
        }
        if ($script:HapiMergeGateRepos -contains $repo) {
            Write-Host ""
            Write-Host "REFUSE: gh pr merge on $repo is blocked on teemo." -ForegroundColor Red
            Write-Host ""
            Write-Host "teemo has no bash, so the mandatory pre-merge gate"
            Write-Host "(hapi-pr-merge-gate.sh) cannot run here. Merging without it is"
            Write-Host "how tiann/hapi#1842 got merged over the maintainer's review."
            Write-Host ""
            Write-Host "Do the merge from oos-linux or proxmox, where the gate runs."
            Write-Host "Upstream merges also need operator lane B authorisation."
            Write-Host ""
            exit 2
        }
    }
    & "C:\Program Files\GitHub CLI\gh.exe" @args
}
