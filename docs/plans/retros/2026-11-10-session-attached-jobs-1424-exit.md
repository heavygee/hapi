# Exit reflection: session-attached-jobs (PR #1424)

> Canon: [`feature-work-lifecycle.md` § Exit reflection](../../tooling/feature-work-lifecycle.md#exit-reflection-gate-a--knowledge-cleanup)

## Shipped as

- PR(s): tiann/hapi#1424 (squash `ee73f3a84814`, 2026-11-10T00:37:03Z) — session jobs + #1489 wake + `--progress until`
- Absorber: n/a
- Session: `/sessions/6e70f97b-24c6-49bd-907f-98ce9bfc8b8f`

## Non-code residue

- Dogfood postmortem: `docs/plans/2026-11-08-session-job-wrong-affordance-postmortem.md` — alive-only + `sleep N` → stripes/frozen remaining; tip preventions + soup thin layer `driver/session-job-progress-until`
- Estate merge gate blocked on optional `mention-response` (workflow `ref: dev`); operator merged via `/usr/bin/gh` after dogfood window — known false alarm class
- `@tiann` in review comments triggers Codex Mention Response — do not use for "maintainer call" on this repo until workflow tracks `main`
- Fork-only residency fade (`driver/session-row-residency-fade`) stayed out of #1424; documented in `docs/plans/2026-11-09-fork-divergence-on-hot-upstream-files.md`
- `cold-review-clean` label can short-circuit tip-match; Ready YES must cite tip-matched bot body, not the September label alone

## Promote?

- [x] `lifecycle / tooling doc` — gate or Meta note: optional non-required check-run failures (e.g. `mention-response`) should not block dogfooded elapsed merges when GitHub `mergeStateStatus=CLEAN` — or fix upstream workflow `ref: dev`→`main`
- [ ] optional second: High-signal index one-liner on "no `@tiann` in review threads until mention-response checks out `main`"

## Open questions / landmines

- Upstream `codex-mention-response.yml` still hardcodes `ref: dev` — any `@tiann` on a tip will red-check again
- Soup still needs drop of absorbed #1424 layers + remat (Meta wave); residency-fade layer may still be pending compose
