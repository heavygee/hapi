# Exit reflection: a2a-p3-notify-ingest (PR #1467)

> Canon: [`feature-work-lifecycle.md` § Exit reflection](../../tooling/feature-work-lifecycle.md#exit-reflection-gate-a--knowledge-cleanup)

## Shipped as

- PR(s): [#1467](https://github.com/tiann/hapi/pull/1467) (squash `ad12eeb5d`) — A2A P3 `AGENT_NOTIFY_SUMMARY` → work-graph `work_ad` ingest (+ A0 substrate)
- Absorber: n/a
- Session: `/sessions/e4d152f3-9df1-4b52-99a6-0418dcd4b818` (Peer #1465)

## Non-code residue

- Opened PR early before Claude→FIX→Sol→FIX; HAPI Bot woke on uncooked tip (draft + full court press recovered). Correct order is press-then-open.
- Sol Pass 2b residual Major: HTTP Zod alone is not enough — untrusted notify must validate at **store insert** (`WorkGraphEventCreateSchema`).
- Post-undraft bot Minors chased UTF-8 / JSON-escape payload budgets; clamp escaped bytes before elevation or silent-drop returns.
- Never added a driver-soup layer (upstream-only PR) — Gate A soup drop was N/A.
- `claudeRemote` 5s CI timeout flaked twice on tip; third re-run green (unrelated to P3).

## Promote?

- [x] `none` — press-order + store-boundary lessons already in lifecycle / this retro; no new High-signal row

## Open questions / landmines

- Hono unknown-length body overflow may still return 400 vs 413 (Sol nonblocking; zero rows written).
- Work-graph `project` column / indexed list still deferred to #1374 / P4.

## Skip

- n/a (reflection written)
