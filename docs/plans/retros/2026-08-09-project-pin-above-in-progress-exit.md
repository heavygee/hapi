# Exit reflection: project-pin-above-in-progress (#1432 → #1458)

## Shipped as

- PR(s): tiann/hapi#1432 (wrong product), tiann/hapi#1458 (correcting revert; Fixes #1457)
- Absorber: #1458
- Session: de26fe4c (Peer #1431 / orchestrator for the pin-order saga)

## Non-code residue

- Never ran `hapi link-pr` on this session after #1432/#1458 — no chip → invisible to Meta hourly 🔧 cleanup / exit-reflection rouses. That is why cleanup lagged until the operator asked about the missing chip.
- #1431/#1432 product miss: treated “Pin in project” as folder z-order vs In progress; #1115 intent is intra-group only. Owned publicly on #1115 + #1457.
- Implementing peer executed a locked bad brief faithfully; bot blessed the wrong hierarchy — challenge product model against UI copy (“Pin in project”) before coding section order.
- Peer bf56c5a8 owned #1458 cleanup + already wrote `2026-08-09-project-pin-intra-group-only-exit.md`; this session’s unique miss is chip discipline, not the remat story.
- Gate A for this session: worktree/branch gone; soup layer for pin-above already DROPPED via #1458 absorb.

## Promote?

- [x] `lifecycle / tooling doc` — applied: `feature-work-lifecycle.md` § Session titles and PR chips — **"No chip = no Meta cleanup loop"** paragraph (hourly 🔧 Gate A / Gate A' consequence of missing same-turn `link_pr`).

## Open questions / landmines

- Orchestrator sessions that babysit after spawning a peer should either link the PR themselves or ensure the implementer peer’s chip is the babysit target — dual sessions on one PR without chips = silent orphans.

## Skip

- n/a (filled)
