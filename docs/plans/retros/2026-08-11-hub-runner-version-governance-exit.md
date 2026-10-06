# Exit reflection: hub-runner-version-governance (PR #1108)

> Gate A' after Meta 🔧 ping 2026-08-11 (merged squash `1cd4d1137`).

## Shipped as

- PR(s): [tiann/hapi#1108](https://github.com/tiann/hapi/pull/1108) — fleet runner version governance (capability skew banner, soft-fail Cursor reopen, supervised Restart)
- Absorber (if superseded): n/a (Tiann-trimmed thin tip; fat upgrade/handoff path kept only as `backup/hub-runner-version-governance-fat`)
- Session: `7d55ed21-8a9f-4309-b4f8-30069df36b4b`

## Non-code residue

- Tiann trim (2026-08-02): keep soft-fail + caps ads + skew banner; drop auto-upgrade / hub-artifact / `cli/src/upgrade/*` from the PR tip — fat history is backup-only, not soup.
- Sticky metadata was a real ship bug: `{...stored,...incoming}` never cleared omitted runner ads; omit-means-clear on runner registration + always-boolean `supervisedRestart` closed the Major before merge.
- Meta chip lag: hourly classify left ⚠️ after tip was already three-dim ✅ — live `hapi-pr-emoji-batch` is truth mid-window; do not treat stale um as unfinished PR work.
- Remat of tip `99568368f` was correctly skipped after merge — upstream squash is the absorb path; Meta remats once wave-clear (hub quiet was still 75 at Gate A).
- Nested non-canonical wt `hub-runner-version-skew-worktrees/0729-afd5` (`hapi-0729-afd5`) was leftover fat-era junk under this feature path — delete with the parent wt.
- Supervised Restart still depends on hosts actually setting `HAPI_RUNNER_SUPERVISED=1` (docs now do); unsupervised laptop runners must stay Restart-disabled.

## Promote?

Pick one primary (and optional second):

- [x] `lifecycle / tooling doc` — path + one-line change
  - `docs/tooling/feature-work-lifecycle.md` / Meta watcher notes: after a green tip mid-hour, stale `externalRefs` ⚠️ is expected until next `hapi-meta-daily`; peers should cite live classify, not sit looking "lazy" on a stale chip.
- [ ] `none` — no durable follow-up
- [ ] `High-signal index` — one row for `docs/operator/AGENTS.md` (paste proposed row)
- [ ] `tooling issue` — title + why (file or link)

## Open questions / landmines

- Generation skew at same semver still fires the banner after soup remats bump `targetGeneration` until fleet re-syncs — not a ghost, not fixed by this PR's trim.
- Fat upgrade path (`backup/hub-runner-version-governance-fat`) is not upstream; do not re-soup it without a new Tiann-scoped PR.

## Skip

- n/a
