# Exit reflection: queued-outcome-unknown-dismiss (PR #1840)

> Canon: [`feature-work-lifecycle.md` § Exit reflection](../../tooling/feature-work-lifecycle.md#exit-reflection-gate-a--knowledge-cleanup)

## Shipped as

- PR(s): [#1840](https://github.com/tiann/hapi/pull/1840) → squash `092a2259c` (Fixes [#1839](https://github.com/tiann/hapi/issues/1839))
- Absorber (if superseded): n/a
- Session: Peer #1839 queued indeterminate dismiss (`4d6e4f81…`)

## Non-code residue

- Product bar was small (X always dismisses; Edit never prefills on `busy`); tip grew via HAPI Bot Minors on `queueDismissed` lifecycle (merge/refetch/reconnect/requeue).
- Auto-B size miss (~153 product delta) is **not** “wait @tiann” — `low-impact` is **our** promote; Meta “no label” means not promoted yet.
- Operator-directed Lane B: label + squash merge once CLEAN; quiet merge (no estate lane comment).
- No soup layer for this work (upstream-only worktree).
- Fork PR-event CI lockfile drift vs tip push green — used `--skip-fork-stage` after local cold + tip CI green.

## Promote?

- [x] `none` — no durable follow-up (lane/promote lesson already in merge-lanes plan + AGENTS)
- [ ] `High-signal index`
- [ ] `lifecycle / tooling doc`
- [ ] `tooling issue`

## Open questions / landmines

- Bot thrash pattern on client-only holds: expect 4–6 Minor rounds if you introduce a new client flag that must survive SSE gaps; budget or full-court before open if that cost matters.
- Remat / Quest VR dogfood of the fix is wave/tooling-owned — not this peer.

## Skip

n/a
