# Exit reflection: flaky-quarantine (#275)

## Shipped as

- PR(s): heavygee/hapi#275 (merged 2026-11-09T13:43:48Z by heavygee)
- Absorber (if superseded): n/a
- Session: this session (664b3170)

## Non-code residue

- Registry entries for issues #273/#274 expired 2026-10-29 while #275 sat open — both issues are still OPEN with zero activity since 2026-10-15. The mechanism is now live but doing nothing (0 active entries); owner still needs to fix/rewrite/delete those tests or do a deliberate renewal.
- Went through 6 rebase rounds on `.github/workflows/test.yml` — same conflict every time (main appends e2e spec filenames to the line this PR's gate step replaces). Resolution pattern is now well-worn: keep the longest e2e list + the gate block with its `GH_TOKEN`/`GITHUB_TOKEN` env.
- Spawned a peer (08a01d63) to assess upstream (tiann/hapi) utility — verdict: the quarantine *mechanism* is cleanly separable and worth offering upstream (scripts/tooling/flaky-quarantine*.{mjs,test.sh} + lib/ have zero fork-specific logic already); not yet actioned.

## Promote?

- [x] `tooling issue` — title: "Upstream-portable flaky-test quarantine (split from heavygee/hapi#275)"; why: peer assessment (session 08a01d63) confirmed the core mechanism (signature+location matched quarantine registry, hard expiry, renewal-with-reason) has no fork-specific logic in the generic files, and solves a problem any CI-heavy repo has. Not yet filed — operator hasn't decided whether to pursue it.

## Open questions / landmines

- **GitHub Actions on this fork was disabled for 32 days (2026-10-08 → 2026-11-09), root cause unrelated to billing/plan/account settings**: it was the one-time per-fork "I understand my workflows, go ahead and enable them" consent flag on the repo's main `/actions` tab (distinct from Settings → Actions → General, which looked fine the whole time and gave zero signal). Operator found and re-enabled it directly. Worth a dedicated tooling-issue/doc note since every future fork-of-fork or long-dormant fork could hit this same silent trap, and `#243`/`#301`'s entire paper trail chased the wrong layer (billing) for a month.
- Discovered (independently verified) that `scripts/tooling/hapi-pr-merge-gate.sh:71` reads only the `check-runs` API, never the `status` API — so the estate's own local-CI bridge (`hapi-local-ci.sh`, posts via Statuses API) can never satisfy the merge gate even when it posts a genuine green. Not patched; operator merged manually once Actions came back for real. If the bridge stays in regular use, the gate should read both surfaces.
- Pre-push hook (`scripts/tooling/git-hooks/pre-push`) hit the same false-positive twice this round (stale pre-rebase remote SHA diffed against new rebased HEAD spuriously includes unrelated `docs/operator/` changes from the gap) — same bug PR #300 fixes, which has also now merged, so this should be resolved going forward.

## Skip

n/a — real findings above.
