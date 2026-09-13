# hapi-gh-merge-guard — teemo (Windows) has no bash, so it cannot run
# hapi-pr-merge-gate.sh. It therefore must not be able to merge at all.
#
# Fail closed: block `gh pr merge` outright and redirect to a host that can run
# the full gate (oos-linux / proxmox). See docs/operator/AGENTS.md
# "Merging: the pre-merge gate". Origin: 2026-09-13 tiann/hapi#1842.

function gh {
    if ($args.Count -ge 2 -and $args[0] -eq 'pr' -and $args[1] -eq 'merge') {
        Write-Host ""
        Write-Host "REFUSE: gh pr merge is blocked on teemo." -ForegroundColor Red
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
    & "C:\Program Files\GitHub CLI\gh.exe" @args
}
